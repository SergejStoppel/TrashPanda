const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const {
  categorizeFileName,
  createFileId,
  getDestinationFolder,
  getExtension,
  isHiddenFileName,
  isTemporaryDownload,
  makeCategoryBuckets,
  PILES_FOLDER_NAME
} = require('./fileCategorizer');
const { applyDuplicateHints, buildCleanupPlan, makePlan } = require('./cleanupPlanner');
const { buildTrashSummary, makeTrashRecommendation } = require('./trashAdvisor');

function emptyScanResult(watchedFolder) {
  return {
    scannedAt: new Date().toISOString(),
    watchedFolder,
    missing: false,
    totalFiles: 0,
    totalBytes: 0,
    oldFiles: 0,
    installerCount: 0,
    categories: makeCategoryBuckets(watchedFolder),
    cleanupPlan: {
      planName: "raccoon's tidy route",
      summary: 'raccoon found no crumbs to sort',
      selectedByDefaultCount: 0,
      reviewCount: 0,
      destinationCount: 0,
      totalBytesSelected: 0,
      rules: []
    },
    trashSummary: {
      summary: 'trashpanda has no toss hunches',
      recommendationCount: 0,
      likelyCount: 0,
      maybeCount: 0,
      reviewCount: 0,
      totalBytes: 0,
      files: []
    },
    skippedFiles: []
  };
}

function pushSkipped(result, watchedFolder, fileName, skipReason) {
  const fullPath = path.join(watchedFolder, fileName);
  result.skippedFiles.push({
    id: `${skipReason}:${fileName}`,
    fullPath,
    fileName,
    extension: getExtension(fileName),
    sizeBytes: 0,
    lastModified: null,
    categoryName: null,
    destinationFolder: null,
    selectedByDefault: false,
    skipReason
  });
}

async function scanDownloads(settings) {
  const watchedFolder = settings.watchedFolder;
  const result = emptyScanResult(watchedFolder);

  if (!watchedFolder || !fs.existsSync(watchedFolder)) {
    result.missing = true;
    return result;
  }

  const categoryMap = new Map(result.categories.map((category) => [category.categoryName, category]));
  const skipRecentMs = Number(settings.skipRecentSeconds ?? 60) * 1000;
  const oldFileMs = Number(settings.oldFileDays ?? 30) * 24 * 60 * 60 * 1000;
  const now = Date.now();

  let entries;

  try {
    entries = await fsp.readdir(watchedFolder, { withFileTypes: true });
  } catch (error) {
    result.errorMessage = error.message;
    return result;
  }

  for (const entry of entries) {
    const fileName = entry.name;

    if (fileName === PILES_FOLDER_NAME) {
      continue;
    }

    if (isHiddenFileName(fileName)) {
      pushSkipped(result, watchedFolder, fileName, 'hidden');
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (isTemporaryDownload(fileName)) {
      pushSkipped(result, watchedFolder, fileName, 'temporary-download');
      continue;
    }

    const fullPath = path.join(watchedFolder, fileName);
    let stats;

    try {
      stats = await fsp.stat(fullPath);
    } catch (error) {
      pushSkipped(result, watchedFolder, fileName, 'unavailable');
      continue;
    }

    if (!stats.isFile()) {
      continue;
    }

    if (skipRecentMs > 0 && now - stats.mtimeMs < skipRecentMs) {
      const skipped = {
        id: createFileId(fullPath, stats),
        fullPath,
        fileName,
        extension: getExtension(fileName),
      sizeBytes: stats.size,
      lastModified: stats.mtime.toISOString(),
      lastAccessed: stats.atime.toISOString(),
      categoryName: categorizeFileName(fileName).categoryName,
      destinationFolder: null,
      selectedByDefault: false,
        skipReason: 'too-recent'
      };
      result.skippedFiles.push(skipped);
      continue;
    }

    const category = categorizeFileName(fileName);
    const plan = makePlan({
      watchedFolder,
      category,
      fileName,
      stats,
      settings,
      now
    });
    const candidate = {
      id: createFileId(fullPath, stats),
      fullPath,
      fileName,
      extension: getExtension(fileName),
      sizeBytes: stats.size,
      lastModified: stats.mtime.toISOString(),
      lastAccessed: stats.atime.toISOString(),
      categoryName: category.categoryName,
      destinationFolder: plan.destinationFolder,
      destinationLabel: plan.destinationLabel,
      selectedByDefault: plan.selectedByDefault,
      smartRule: plan.smartRule,
      skipReason: null
    };

    const bucket = categoryMap.get(category.categoryName);
    bucket.files.push(candidate);
    bucket.fileCount += 1;
    bucket.totalBytes += candidate.sizeBytes;

    result.totalFiles += 1;
    result.totalBytes += candidate.sizeBytes;

    if (category.categoryName === 'Installers') {
      result.installerCount += 1;
    }

    if (now - stats.mtimeMs >= oldFileMs) {
      result.oldFiles += 1;
    }
  }

  const files = result.categories.flatMap((category) => category.files);
  applyDuplicateHints(files);

  const siblingDirs = new Set(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name.toLowerCase()));

  for (const category of result.categories) {
    for (const file of category.files) {
      try {
        const stats = await fsp.stat(file.fullPath);
        file.trashRecommendation = makeTrashRecommendation({
          file,
          stats,
          settings,
          now,
          siblingDirs
        });
      } catch {
        file.trashRecommendation = {
          recommended: false,
          confidence: 'none',
          label: 'missing crumb',
          reason: 'file moved during scan',
          signals: [],
          modifiedDays: 0,
          accessedDays: 0,
          lastAccessed: file.lastAccessed,
          accessTimeUseful: false
        };
      }
    }
  }

  for (const category of result.categories) {
    category.readyCount = category.files.filter((file) => file.selectedByDefault).length;
    category.reviewCount = category.files.length - category.readyCount;
    category.trashHintCount = category.files.filter((file) => file.trashRecommendation?.recommended).length;
    category.destinationCount = new Set(category.files.map((file) => file.destinationFolder)).size;
  }

  result.cleanupPlan = buildCleanupPlan(result);
  result.trashSummary = buildTrashSummary(files);

  return result;
}

module.exports = {
  scanDownloads
};
