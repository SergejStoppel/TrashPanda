const assert = require('assert');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { scanDownloads } = require('../src/services/downloadScanner');
const { moveFiles } = require('../src/services/fileMover');

async function exists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'download-raccoon-'));
  const settings = {
    watchedFolder: tempRoot,
    oldFileDays: 30,
    skipRecentSeconds: 0
  };

  try {
    await fsp.writeFile(path.join(tempRoot, 'photo.png'), 'image');
    await fsp.writeFile(path.join(tempRoot, 'notes.pdf'), 'paper');
    await fsp.writeFile(path.join(tempRoot, 'setup.exe'), 'installer');
    await fsp.writeFile(path.join(tempRoot, 'loading.crdownload'), 'partial');
    const oldDate = new Date(Date.now() - 70 * 24 * 60 * 60 * 1000);
    await fsp.utimes(path.join(tempRoot, 'setup.exe'), oldDate, oldDate);

    const firstScan = await scanDownloads(settings);
    assert.strictEqual(firstScan.totalFiles, 3, 'scan should include only completed top-level files');
    assert.strictEqual(firstScan.categories.find((category) => category.categoryName === 'Images').fileCount, 1);
    assert.strictEqual(firstScan.categories.find((category) => category.categoryName === 'Documents').fileCount, 1);
    assert.strictEqual(firstScan.categories.find((category) => category.categoryName === 'Installers').fileCount, 1);
    assert.strictEqual(firstScan.cleanupPlan.selectedByDefaultCount, 3, 'ordinary crumbs should be smart selected');
    assert.ok(firstScan.cleanupPlan.destinationCount >= 2, 'cleanup plan should include smart destinations');
    assert.strictEqual(firstScan.trashSummary.recommendationCount, 1, 'old installer should get a toss hunch');

    const firstMove = await moveFiles({
      files: firstScan.categories.flatMap((category) => category.files),
      watchedFolder: tempRoot
    });

    assert.strictEqual(firstMove.movedCount, 3, 'expected three files to move');
    assert.strictEqual(firstMove.skippedCount, 0, 'expected no skipped moves');
    assert.ok(await exists(path.join(tempRoot, 'Raccoon Piles', 'Images', 'photo.png')));
    assert.ok(await exists(path.join(tempRoot, 'Raccoon Piles', 'Documents', 'notes.pdf')));
    assert.ok(await exists(path.join(tempRoot, 'Raccoon Piles', 'Installers', 'Old Installers', 'setup.exe')));

    await fsp.writeFile(path.join(tempRoot, 'photo.png'), 'second-image');
    const secondScan = await scanDownloads(settings);
    const secondMove = await moveFiles({
      files: secondScan.categories.flatMap((category) => category.files),
      watchedFolder: tempRoot
    });

    assert.strictEqual(secondMove.movedCount, 1, 'expected duplicate source to move');
    assert.ok(await exists(path.join(tempRoot, 'Raccoon Piles', 'Images', 'photo 2.png')));

    console.log('Download Raccoon smoke test passed.');
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
