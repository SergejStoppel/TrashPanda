const path = require('path');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const LEFTOVER_EXTENSIONS = new Set(['log', 'bak', 'old', 'dmp']);

function daysBetween(now, thenMs) {
  return Math.max(0, Math.floor((now - thenMs) / ONE_DAY_MS));
}

function accessLooksUseful(stats) {
  return Number.isFinite(stats.atimeMs) && Math.abs(stats.atimeMs - stats.mtimeMs) > 60 * 1000;
}

function addSignal(signals, signal) {
  if (!signals.includes(signal)) {
    signals.push(signal);
  }
}

function makeTrashRecommendation({ file, stats, settings, now = Date.now() }) {
  const modifiedDays = daysBetween(now, stats.mtimeMs);
  const accessedDays = daysBetween(now, stats.atimeMs);
  const hasAccessSignal = accessLooksUseful(stats);
  const oldInstallerDays = Number(settings.trashOldInstallerDays ?? 45);
  const oldArchiveDays = Number(settings.trashOldArchiveDays ?? 120);
  const oldScreenshotDays = Number(settings.trashOldScreenshotDays ?? 60);
  const staleAccessDays = Number(settings.trashStaleAccessDays ?? 90);
  const largeFileThreshold = Number(settings.largeFileThresholdBytes ?? 2147483648);
  const extension = path.extname(file.fileName).replace(/^\./, '').toLowerCase();
  const signals = [];
  let recommended = false;
  let confidence = 'none';
  let label = 'keep nearby';
  let reason = 'no toss hunch';

  if (stats.size === 0 && modifiedDays >= 7) {
    recommended = true;
    confidence = 'likely';
    label = 'empty crumb';
    reason = 'empty and has been sitting for a while';
    addSignal(signals, 'empty file');
  }

  if (file.smartRule?.reviewFlags?.includes('possible duplicate')) {
    recommended = true;
    confidence = confidence === 'likely' ? 'likely' : 'review';
    label = 'possible twin';
    reason = 'name and size look like another crumb';
    addSignal(signals, 'possible duplicate');
  }

  if (file.categoryName === 'Installers' && modifiedDays >= oldInstallerDays) {
    recommended = true;
    confidence = hasAccessSignal && accessedDays >= 30 ? 'likely' : 'review';
    label = 'old installer snack';
    reason = hasAccessSignal ? 'old installer and not opened recently' : 'old installer';
    addSignal(signals, `${modifiedDays} days old`);
  }

  if (file.categoryName === 'Archives' && modifiedDays >= oldArchiveDays) {
    recommended = true;
    confidence = hasAccessSignal && accessedDays >= staleAccessDays ? 'maybe' : 'review';
    label = 'old zip snack';
    reason = hasAccessSignal ? 'old archive with stale open metadata' : 'old archive';
    addSignal(signals, `${modifiedDays} days old`);
  }

  if (file.smartRule?.ruleId === 'images-screenshots' && modifiedDays >= oldScreenshotDays) {
    recommended = true;
    confidence = hasAccessSignal && accessedDays >= oldScreenshotDays ? 'maybe' : 'review';
    label = 'stale screenshot';
    reason = hasAccessSignal ? 'old screenshot and not opened recently' : 'old screenshot';
    addSignal(signals, `${modifiedDays} days old`);
  }

  if (LEFTOVER_EXTENSIONS.has(extension) && modifiedDays >= 30) {
    recommended = true;
    confidence = confidence === 'likely' ? 'likely' : 'maybe';
    label = 'leftover helper crumb';
    reason = 'looks like an old log or backup leftover';
    addSignal(signals, `.${extension}`);
  }

  if (stats.size >= largeFileThreshold && modifiedDays >= 120) {
    recommended = true;
    confidence = confidence === 'likely' ? 'likely' : 'review';
    label = 'big old crumb';
    reason = 'large and old enough to review';
    addSignal(signals, 'large file');
  }

  if (hasAccessSignal && accessedDays >= staleAccessDays && recommended) {
    addSignal(signals, `not opened ${accessedDays} days`);
  }

  return {
    recommended,
    confidence,
    label,
    reason,
    signals,
    modifiedDays,
    accessedDays,
    lastAccessed: stats.atime.toISOString(),
    accessTimeUseful: hasAccessSignal
  };
}

function buildTrashSummary(files) {
  const recommendations = files
    .filter((file) => file.trashRecommendation?.recommended)
    .sort((a, b) => {
      const confidenceWeight = { likely: 0, maybe: 1, review: 2, none: 3 };
      return (
        confidenceWeight[a.trashRecommendation.confidence] - confidenceWeight[b.trashRecommendation.confidence] ||
        b.sizeBytes - a.sizeBytes
      );
    });

  const totalBytes = recommendations.reduce((sum, file) => sum + file.sizeBytes, 0);
  const likelyCount = recommendations.filter((file) => file.trashRecommendation.confidence === 'likely').length;
  const maybeCount = recommendations.filter((file) => file.trashRecommendation.confidence === 'maybe').length;
  const reviewCount = recommendations.length - likelyCount - maybeCount;

  return {
    summary:
      recommendations.length === 0
        ? 'trashpanda has no toss hunches'
        : `trashpanda has ${recommendations.length} toss hunches`,
    recommendationCount: recommendations.length,
    likelyCount,
    maybeCount,
    reviewCount,
    totalBytes,
    files: recommendations.slice(0, 12).map((file) => ({
      id: file.id,
      fileName: file.fileName,
      categoryName: file.categoryName,
      sizeBytes: file.sizeBytes,
      destinationLabel: file.destinationLabel,
      trashRecommendation: file.trashRecommendation
    }))
  };
}

module.exports = {
  buildTrashSummary,
  makeTrashRecommendation
};
