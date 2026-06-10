const path = require('path');
const { getDestinationFolder } = require('./fileCategorizer');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const FRESH_REVIEW_MS = 15 * 60 * 1000;

const RECEIPT_WORDS = ['receipt', 'invoice', 'statement', 'order', 'bill', 'tax', 'w2', '1099'];
const SCREENSHOT_WORDS = ['screenshot', 'screen shot', 'screen-shot', 'snip', 'capture'];
const RECORDING_WORDS = ['recording', 'screenrec', 'screen record', 'meeting'];
const CAMERA_PATTERNS = [/^img[_-]?\d+/i, /^dsc[_-]?\d+/i, /^pxl[_-]?\d+/i, /^photo[_-]?\d+/i];

function includesWord(fileName, words) {
  const lower = fileName.toLowerCase();
  return words.some((word) => lower.includes(word));
}

function matchesAny(fileName, patterns) {
  return patterns.some((pattern) => pattern.test(fileName));
}

function destinationLabel(watchedFolder, destinationFolder) {
  const relative = path.relative(path.join(watchedFolder, 'Raccoon Piles'), destinationFolder);
  return relative || path.basename(destinationFolder);
}

function makePlan({
  watchedFolder,
  category,
  fileName,
  stats,
  settings,
  now = Date.now()
}) {
  const ageMs = now - stats.mtimeMs;
  const ageDays = ageMs / ONE_DAY_MS;
  const largeThreshold = Number(settings.largeFileThresholdBytes ?? 2147483648);
  const reviewFlags = [];
  const tags = [];
  let ruleId = `category-${category.categoryName.toLowerCase()}`;
  let ruleLabel = category.cuteLabel;
  let reason = `extension says ${category.categoryName.toLowerCase()}`;
  let destinationParts = [category.categoryName];
  let priority = 50;
  let confidence = 'steady';

  if (category.categoryName === 'Images' && includesWord(fileName, SCREENSHOT_WORDS)) {
    ruleId = 'images-screenshots';
    ruleLabel = 'screenshot nest';
    reason = 'name looks like a screenshot';
    destinationParts = ['Images', 'Screenshots'];
    priority = 20;
    confidence = 'high';
  } else if (category.categoryName === 'Images' && matchesAny(fileName, CAMERA_PATTERNS)) {
    ruleId = 'images-camera';
    ruleLabel = 'camera crumbs';
    reason = 'name looks like a camera photo';
    destinationParts = ['Images', 'Camera Photos'];
    priority = 25;
  } else if (category.categoryName === 'Documents' && includesWord(fileName, RECEIPT_WORDS)) {
    ruleId = 'docs-receipts';
    ruleLabel = 'receipt burrow';
    reason = 'name looks like a receipt or invoice';
    destinationParts = ['Documents', 'Receipts and Invoices'];
    priority = 20;
    confidence = 'high';
  } else if (category.categoryName === 'Archives' && ageDays >= 14) {
    ruleId = 'archives-old';
    ruleLabel = 'old zip snacks';
    reason = 'archive has been sitting for a while';
    destinationParts = ['Archives', 'Old Archives'];
    priority = 30;
  } else if (category.categoryName === 'Installers') {
    ruleId = ageDays >= Number(settings.oldFileDays ?? 30) ? 'installers-old' : 'installers';
    ruleLabel = ageDays >= Number(settings.oldFileDays ?? 30) ? 'old installer snacks' : 'installer snacks';
    reason = ageDays >= Number(settings.oldFileDays ?? 30) ? 'old installers are usually clutter' : 'installer belongs in one easy pile';
    destinationParts = ['Installers', ageDays >= Number(settings.oldFileDays ?? 30) ? 'Old Installers' : 'Recent Installers'];
    priority = 15;
    confidence = 'high';
  } else if (category.categoryName === 'Video' && includesWord(fileName, RECORDING_WORDS)) {
    ruleId = 'video-recordings';
    ruleLabel = 'recording crumbs';
    reason = 'name looks like a screen or meeting recording';
    destinationParts = ['Video', 'Recordings'];
    priority = 25;
  } else if (category.categoryName === 'Code') {
    ruleId = 'code-review';
    ruleLabel = 'code scraps to review';
    reason = 'code can be project material, so raccoon asks first';
    destinationParts = ['Code', 'Loose Code'];
    priority = 80;
    confidence = 'review';
    reviewFlags.push('code');
  } else if (category.categoryName === 'Other') {
    ruleId = 'mystery-review';
    ruleLabel = 'mystery crumbs';
    reason = 'unknown extension needs a quick look';
    destinationParts = ['Other', 'Needs a Look'];
    priority = 90;
    confidence = 'review';
    reviewFlags.push('mystery');
  }

  if (stats.size >= largeThreshold) {
    tags.push('big crumb');
    reviewFlags.push('large file');
    priority = Math.max(priority, 85);

    if (category.categoryName === 'Video') {
      ruleId = 'video-large';
      ruleLabel = 'big movie crumbs';
      reason = 'large videos deserve an obvious pile';
      destinationParts = ['Video', 'Large Videos'];
    }
  }

  if (ageMs < FRESH_REVIEW_MS) {
    tags.push('fresh crumb');
  }

  const destinationFolder = getDestinationFolder(watchedFolder, ...destinationParts);

  return {
    destinationFolder,
    destinationLabel: destinationLabel(watchedFolder, destinationFolder),
    selectedByDefault: reviewFlags.length === 0,
    smartRule: {
      ruleId,
      ruleLabel,
      reason,
      confidence,
      reviewFlags,
      tags,
      priority
    }
  };
}

function duplicateKey(file) {
  const extension = path.extname(file.fileName).toLowerCase();
  const baseName = path
    .basename(file.fileName, extension)
    .toLowerCase()
    .replace(/\s+-\s+copy$/i, '')
    .replace(/\s+copy$/i, '')
    .replace(/\s+\(\d+\)$/i, '')
    .replace(/\s+\d+$/i, '')
    .trim();

  return `${file.categoryName}:${extension}:${file.sizeBytes}:${baseName}`;
}

function applyDuplicateHints(files) {
  const groups = new Map();

  for (const file of files) {
    const key = duplicateKey(file);
    const group = groups.get(key) || [];
    group.push(file);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    if (group.length < 2) {
      continue;
    }

    for (const file of group) {
      file.selectedByDefault = false;
      file.smartRule.tags.push('possible twin');
      file.smartRule.reviewFlags.push('possible duplicate');
      file.smartRule.confidence = 'review';
      file.smartRule.reason = 'name and size look like a possible twin';
    }
  }
}

function buildCleanupPlan(scanResult) {
  const files = scanResult.categories.flatMap((category) => category.files);
  const ruleMap = new Map();
  let selectedByDefaultCount = 0;
  let reviewCount = 0;
  let selectedBytes = 0;
  const destinations = new Set();

  for (const file of files) {
    destinations.add(file.destinationFolder);

    if (file.selectedByDefault) {
      selectedByDefaultCount += 1;
      selectedBytes += file.sizeBytes;
    } else {
      reviewCount += 1;
    }

    const ruleId = file.smartRule.ruleId;
    const entry = ruleMap.get(ruleId) || {
      ruleId,
      ruleLabel: file.smartRule.ruleLabel,
      reason: file.smartRule.reason,
      priority: file.smartRule.priority,
      fileCount: 0,
      selectedByDefaultCount: 0,
      reviewCount: 0,
      totalBytes: 0
    };

    entry.fileCount += 1;
    entry.totalBytes += file.sizeBytes;

    if (file.selectedByDefault) {
      entry.selectedByDefaultCount += 1;
    } else {
      entry.reviewCount += 1;
    }

    ruleMap.set(ruleId, entry);
  }

  const rules = Array.from(ruleMap.values()).sort((a, b) => a.priority - b.priority || b.fileCount - a.fileCount);
  const summary =
    files.length === 0
      ? 'raccoon found no crumbs to sort'
      : `raccoon has ${selectedByDefaultCount} ready crumbs and ${reviewCount} to peek at`;

  return {
    planName: "raccoon's tidy route",
    summary,
    selectedByDefaultCount,
    reviewCount,
    destinationCount: destinations.size,
    totalBytesSelected: selectedBytes,
    rules
  };
}

module.exports = {
  applyDuplicateHints,
  buildCleanupPlan,
  makePlan
};
