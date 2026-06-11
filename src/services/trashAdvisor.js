const path = require('path');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const LEFTOVER_EXTENSIONS = new Set(['log', 'bak', 'old', 'dmp', 'tmp']);
const ARCHIVE_EXTENSIONS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'tgz']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'avi', 'mkv', 'wmv', 'flv']);

// confidence thresholds on the summed score
const LIKELY_AT = 0.7;
const MAYBE_AT = 0.4;

function daysBetween(now, thenMs) {
  return Math.max(0, Math.floor((now - thenMs) / ONE_DAY_MS));
}

// On Windows last-access updates are frequently disabled, so atime is only
// trustworthy when it clearly diverges from mtime.
function accessLooksUseful(stats) {
  return Number.isFinite(stats.atimeMs) && Math.abs(stats.atimeMs - stats.mtimeMs) > 60 * 1000;
}

function humanAge(days) {
  if (days >= 365) {
    const years = days / 365;
    const text = years < 10 ? years.toFixed(1) : String(Math.round(years));
    return `${text} year${years >= 2 ? 's' : ''}`;
  }
  if (days >= 30) {
    const months = Math.round(days / 30);
    return `${months} month${months > 1 ? 's' : ''}`;
  }
  return `${days} day${days === 1 ? '' : 's'}`;
}

function addSignal(signals, signal) {
  if (signal && !signals.includes(signal)) signals.push(signal);
}

function stripExt(name) {
  return path.basename(name, path.extname(name)).toLowerCase();
}

/*
 * Returns a scored toss hunch. Each rule contributes a weight; the weights are
 * summed and clamped to 0..1. The dominant (highest-weight) rule supplies the
 * label and headline reason. The strongest signal by design is "untouched for
 * years", since that is what users most want surfaced.
 */
function makeTrashRecommendation({ file, stats, settings, now = Date.now(), siblingDirs }) {
  const modifiedDays = daysBetween(now, stats.mtimeMs);
  const accessedDays = daysBetween(now, stats.atimeMs);
  const hasAccessSignal = accessLooksUseful(stats);
  // most recent of modify/access = how long since anyone touched it
  const staleDays = hasAccessSignal ? Math.min(modifiedDays, accessedDays) : modifiedDays;

  const oldInstallerDays = Number(settings.trashOldInstallerDays ?? 45);
  const oldArchiveDays = Number(settings.trashOldArchiveDays ?? 120);
  const oldScreenshotDays = Number(settings.trashOldScreenshotDays ?? 60);
  const largeFileThreshold = Number(settings.largeFileThresholdBytes ?? 2147483648);
  const agedMediaBytes = Number(settings.agedMediaBytes ?? 50 * 1024 * 1024);
  const staleYearDays = Number(settings.trashStaleDays ?? 365);

  const extension = path.extname(file.fileName).replace(/^\./, '').toLowerCase();
  const signals = [];
  const contributions = []; // { weight, label, reason }

  const note = (weight, label, reason) => contributions.push({ weight, label, reason });

  // --- headline: untouched for a long time ---
  if (staleDays >= staleYearDays * 3) {
    note(0.6, 'ancient crumb', hasAccessSignal ? `not opened in ${humanAge(staleDays)}` : `untouched for ${humanAge(staleDays)}`);
    addSignal(signals, `${humanAge(staleDays)} untouched`);
  } else if (staleDays >= staleYearDays * 2) {
    note(0.45, 'very stale crumb', hasAccessSignal ? `not opened in ${humanAge(staleDays)}` : `untouched for ${humanAge(staleDays)}`);
    addSignal(signals, `${humanAge(staleDays)} untouched`);
  } else if (staleDays >= staleYearDays) {
    note(0.25, 'stale crumb', hasAccessSignal ? `not opened in ${humanAge(staleDays)}` : `untouched for ${humanAge(staleDays)}`);
    addSignal(signals, `${humanAge(staleDays)} untouched`);
  }

  // --- empty ---
  if (stats.size === 0 && modifiedDays >= 7) {
    note(0.45, 'empty crumb', 'empty and sitting unused');
    addSignal(signals, 'empty file');
  }

  // --- leftover logs / temp / backups ---
  if (LEFTOVER_EXTENSIONS.has(extension) && modifiedDays >= 30) {
    note(0.3, 'leftover helper crumb', 'an old log, temp, or backup leftover');
    addSignal(signals, `.${extension}`);
  }

  // --- old installer ---
  if (file.categoryName === 'Installers' && modifiedDays >= oldInstallerDays) {
    note(hasAccessSignal && accessedDays >= 30 ? 0.5 : 0.4, 'old installer snack', 'an installer you likely already ran');
    addSignal(signals, 'installer');
  }

  // --- extracted archive (a sibling folder shares its name) ---
  const siblingSet = siblingDirs instanceof Set ? siblingDirs : null;
  if (ARCHIVE_EXTENSIONS.has(extension) && siblingSet && siblingSet.has(stripExt(file.fileName)) && modifiedDays >= 14) {
    note(0.4, 'already-unpacked zip', 'already extracted to a folder next to it');
    addSignal(signals, 'extracted nearby');
  } else if (ARCHIVE_EXTENSIONS.has(extension) && modifiedDays >= oldArchiveDays) {
    note(0.25, 'old zip snack', 'an old archive');
    addSignal(signals, 'old archive');
  }

  // --- stale screenshot ---
  if (file.smartRule?.ruleId === 'images-screenshots' && modifiedDays >= oldScreenshotDays) {
    note(0.25, 'stale screenshot', 'an old screenshot');
    addSignal(signals, 'screenshot');
  }

  // --- aged big media ---
  if (VIDEO_EXTENSIONS.has(extension) && stats.size >= agedMediaBytes && modifiedDays >= 180) {
    note(0.3, 'aged video', 'a big video untouched for months');
    addSignal(signals, 'large video');
  }

  // --- large + old (any type) ---
  if (stats.size >= largeFileThreshold && modifiedDays >= 120) {
    const sizeBonus = Math.min(0.15, (stats.size / largeFileThreshold - 1) * 0.1);
    note(0.3 + sizeBonus, 'big old crumb', 'large and old enough to review');
    addSignal(signals, 'large file');
  }

  // --- possible duplicate (from cleanup planner hints) ---
  if (file.smartRule?.reviewFlags?.includes('possible duplicate')) {
    note(0.3, 'possible twin', 'name and size look like another crumb');
    addSignal(signals, 'possible duplicate');
  }

  if (contributions.length === 0) {
    return {
      recommended: false,
      confidence: 'none',
      score: 0,
      label: 'keep nearby',
      reason: 'no toss hunch',
      signals: [],
      modifiedDays,
      accessedDays,
      lastAccessed: stats.atime.toISOString(),
      accessTimeUseful: hasAccessSignal
    };
  }

  const score = Math.min(1, contributions.reduce((sum, c) => sum + c.weight, 0));
  const dominant = contributions.reduce((m, c) => (c.weight > m.weight ? c : m));
  const confidence = score >= LIKELY_AT ? 'likely' : score >= MAYBE_AT ? 'maybe' : 'review';

  return {
    recommended: true,
    confidence,
    score: Number(score.toFixed(3)),
    label: dominant.label,
    reason: dominant.reason,
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
    .sort((a, b) => (b.trashRecommendation.score - a.trashRecommendation.score) || (b.sizeBytes - a.sizeBytes));

  const totalBytes = recommendations.reduce((sum, file) => sum + file.sizeBytes, 0);
  const likelyCount = recommendations.filter((file) => file.trashRecommendation.confidence === 'likely').length;
  const maybeCount = recommendations.filter((file) => file.trashRecommendation.confidence === 'maybe').length;
  const reviewCount = recommendations.length - likelyCount - maybeCount;

  return {
    summary:
      recommendations.length === 0
        ? 'trashpanda has no toss hunches'
        : `trashpanda has ${recommendations.length} toss hunch${recommendations.length === 1 ? '' : 'es'}`,
    recommendationCount: recommendations.length,
    likelyCount,
    maybeCount,
    reviewCount,
    totalBytes,
    files: recommendations.slice(0, 20).map((file) => ({
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
