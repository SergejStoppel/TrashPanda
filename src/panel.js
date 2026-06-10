const pilesList = document.getElementById('pilesList');
const fileCount = document.getElementById('fileCount');
const totalSize = document.getElementById('totalSize');
const oldFiles = document.getElementById('oldFiles');
const installerCount = document.getElementById('installerCount');
const headline = document.getElementById('headline');
const moodLabel = document.getElementById('moodLabel');
const folderLine = document.getElementById('folderLine');
const planSummary = document.getElementById('planSummary');
const planStats = document.getElementById('planStats');
const ruleStrip = document.getElementById('ruleStrip');
const trashCard = document.getElementById('trashCard');
const trashSummary = document.getElementById('trashSummary');
const trashStats = document.getElementById('trashStats');
const trashList = document.getElementById('trashList');
const scanButton = document.getElementById('scanButton');
const smartPickButton = document.getElementById('smartPickButton');
const oldOnlyButton = document.getElementById('oldOnlyButton');
const noneButton = document.getElementById('noneButton');
const sortButton = document.getElementById('sortButton');
const missingFolder = document.getElementById('missingFolder');
const chooseFolderButton = document.getElementById('chooseFolderButton');
const confirmModal = document.getElementById('confirmModal');
const confirmCopy = document.getElementById('confirmCopy');
const cancelSortButton = document.getElementById('cancelSortButton');
const confirmSortButton = document.getElementById('confirmSortButton');

let currentScan = null;
let selectedFiles = new Set();
let openCategories = new Set();

function formatBytes(bytes) {
  if (!bytes) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 || unitIndex === 0 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`;
}

function moodForCount(count, missing) {
  if (missing) {
    return {
      eyebrow: 'raccoon needs a folder',
      headline: 'raccoon cannot find downloads'
    };
  }

  if (count <= 10) {
    return {
      eyebrow: 'sleepy and cozy',
      headline: count === 0 ? 'Downloads is cozy' : `Raccoon found ${count} crumbs`
    };
  }

  if (count <= 30) {
    return {
      eyebrow: 'curious little pile',
      headline: `Raccoon found ${count} crumbs`
    };
  }

  if (count <= 75) {
    return {
      eyebrow: 'downloads is snacky today',
      headline: `Raccoon found ${count} crumbs`
    };
  }

  return {
    eyebrow: 'under the downloads mountain',
    headline: `Raccoon found ${count} crumbs`
  };
}

function allFiles(scan = currentScan) {
  return scan ? scan.categories.flatMap((category) => category.files) : [];
}

function selectSmartDefaults(scan = currentScan) {
  selectedFiles = new Set(allFiles(scan).filter((file) => file.selectedByDefault).map((file) => file.id));
}

function selectedCount() {
  const knownIds = new Set(allFiles().map((file) => file.id));
  return Array.from(selectedFiles).filter((id) => knownIds.has(id)).length;
}

function syncSortButton() {
  const count = selectedCount();
  sortButton.disabled = count === 0 || currentScan?.missing;
  sortButton.textContent = count > 0 ? `Sort selected files (${count})` : 'Sort selected files';
}

function textElement(tag, className, text) {
  const element = document.createElement(tag);

  if (className) {
    element.className = className;
  }

  element.textContent = text;
  return element;
}

function renderPlan(scan) {
  const plan = scan.cleanupPlan || {
    summary: 'raccoon is making a tidy route',
    selectedByDefaultCount: 0,
    reviewCount: 0,
    destinationCount: 0,
    totalBytesSelected: 0,
    rules: []
  };

  planSummary.textContent = plan.summary;
  planStats.innerHTML = '';

  const stats = [
    `${plan.selectedByDefaultCount} ready`,
    `${plan.reviewCount} review`,
    `${plan.destinationCount} nests`,
    `${formatBytes(plan.totalBytesSelected)} picked`
  ];

  for (const stat of stats) {
    planStats.appendChild(textElement('span', null, stat));
  }

  ruleStrip.innerHTML = '';

  for (const rule of plan.rules.slice(0, 5)) {
    const chip = document.createElement('span');
    chip.className = rule.reviewCount > 0 ? 'rule-chip needs-review' : 'rule-chip';
    chip.textContent = `${rule.ruleLabel}: ${rule.fileCount}`;
    chip.title = rule.reason;
    ruleStrip.appendChild(chip);
  }
}

function renderTrashHunches(scan) {
  const summary = scan.trashSummary || {
    summary: 'trashpanda has no toss hunches',
    recommendationCount: 0,
    likelyCount: 0,
    maybeCount: 0,
    reviewCount: 0,
    totalBytes: 0,
    files: []
  };

  trashSummary.textContent = summary.summary;
  trashCard.classList.toggle('is-quiet', summary.recommendationCount === 0);
  trashStats.innerHTML = '';
  trashList.innerHTML = '';

  const stats = [
    `${summary.likelyCount} likely`,
    `${summary.maybeCount} maybe`,
    `${summary.reviewCount} review`,
    `${formatBytes(summary.totalBytes)} hinted`
  ];

  for (const stat of stats) {
    trashStats.appendChild(textElement('span', null, stat));
  }

  for (const file of summary.files.slice(0, 4)) {
    const item = document.createElement('div');
    item.className = `trash-item confidence-${file.trashRecommendation.confidence}`;

    const title = textElement('span', 'trash-file', file.fileName);
    title.title = file.fileName;

    item.appendChild(title);
    item.appendChild(
      textElement('span', 'trash-reason', `${file.trashRecommendation.label}: ${file.trashRecommendation.reason}`)
    );
    item.appendChild(
      textElement('span', 'trash-signals', file.trashRecommendation.signals.join(' · ') || 'metadata hunch')
    );
    trashList.appendChild(item);
  }
}

function renderFileRow(file) {
  const row = document.createElement('label');
  row.className = 'file-row';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = selectedFiles.has(file.id);
  checkbox.addEventListener('change', (event) => {
    if (event.target.checked) {
      selectedFiles.add(file.id);
    } else {
      selectedFiles.delete(file.id);
    }

    render(currentScan);
  });

  const body = document.createElement('div');
  body.className = 'file-body';

  const name = textElement('span', 'file-name', file.fileName);
  name.title = file.fileName;
  body.appendChild(name);

  const meta = document.createElement('div');
  meta.className = 'file-meta';
  meta.appendChild(textElement('span', 'rule-badge', file.smartRule?.ruleLabel || file.categoryName));
  meta.appendChild(textElement('span', 'destination-line', file.destinationLabel || file.categoryName));

  for (const flag of file.smartRule?.reviewFlags || []) {
    meta.appendChild(textElement('span', 'review-pill', flag));
  }

  if (file.trashRecommendation?.recommended) {
    meta.appendChild(textElement('span', 'trash-pill', file.trashRecommendation.label));
  }

  body.appendChild(meta);

  row.appendChild(checkbox);
  row.appendChild(body);
  row.appendChild(textElement('span', 'file-size', formatBytes(file.sizeBytes)));
  return row;
}

function renderPileCard(category) {
  const card = document.createElement('article');
  card.className = 'pile-card';
  card.dataset.category = category.categoryName;

  if (openCategories.has(category.categoryName)) {
    card.classList.add('is-open');
  }

  const categorySelected = category.files.every((file) => selectedFiles.has(file.id));
  const categoryHasSelected = category.files.some((file) => selectedFiles.has(file.id));

  const summary = document.createElement('div');
  summary.className = 'pile-summary';

  const checkbox = document.createElement('input');
  checkbox.className = 'pile-checkbox';
  checkbox.type = 'checkbox';
  checkbox.setAttribute('aria-label', `Select ${category.categoryName}`);
  checkbox.checked = categorySelected;
  checkbox.indeterminate = categoryHasSelected && !categorySelected;
  checkbox.addEventListener('change', () => {
    for (const file of category.files) {
      if (checkbox.checked) {
        selectedFiles.add(file.id);
      } else {
        selectedFiles.delete(file.id);
      }
    }

    render(currentScan);
  });

  const titleBox = document.createElement('div');
  titleBox.appendChild(textElement('p', 'pile-title', category.categoryName));
  titleBox.appendChild(
    textElement(
      'p',
      'pile-label',
      `${category.cuteLabel} · ${category.readyCount || 0} ready · ${category.reviewCount || 0} review · ${category.trashHintCount || 0} toss hunches`
    )
  );

  const count = textElement('span', 'pile-count', `${category.fileCount} / ${formatBytes(category.totalBytes)}`);
  const expand = document.createElement('button');
  expand.className = 'expand-button';
  expand.type = 'button';
  expand.setAttribute('aria-label', `Expand ${category.categoryName}`);
  expand.textContent = openCategories.has(category.categoryName) ? '-' : '+';
  expand.addEventListener('click', () => {
    if (openCategories.has(category.categoryName)) {
      openCategories.delete(category.categoryName);
    } else {
      openCategories.add(category.categoryName);
    }

    render(currentScan);
  });

  summary.appendChild(checkbox);
  summary.appendChild(titleBox);
  summary.appendChild(count);
  summary.appendChild(expand);

  const fileList = document.createElement('div');
  fileList.className = 'file-list';

  for (const file of category.files) {
    fileList.appendChild(renderFileRow(file));
  }

  card.appendChild(summary);
  card.appendChild(fileList);
  return card;
}

function render(scan) {
  currentScan = scan;

  const mood = moodForCount(scan.totalFiles, scan.missing);
  moodLabel.textContent = mood.eyebrow;
  headline.textContent = mood.headline;
  folderLine.textContent = scan.watchedFolder || '';
  fileCount.textContent = String(scan.totalFiles);
  totalSize.textContent = formatBytes(scan.totalBytes);
  oldFiles.textContent = String(scan.oldFiles);
  installerCount.textContent = String(scan.installerCount);
  missingFolder.classList.toggle('is-hidden', !scan.missing);
  renderPlan(scan);
  renderTrashHunches(scan);

  const visibleCategories = scan.categories.filter((category) => category.fileCount > 0);
  pilesList.innerHTML = '';

  if (visibleCategories.length === 0 && !scan.missing) {
    pilesList.appendChild(textElement('div', 'empty-state', 'downloads is cozy\nraccoon found no crumbs'));
    syncSortButton();
    return;
  }

  for (const category of visibleCategories) {
    pilesList.appendChild(renderPileCard(category));
  }

  syncSortButton();
}

async function refreshScan() {
  scanButton.disabled = true;
  scanButton.textContent = 'Sniffing...';

  try {
    const scan = await window.raccoon.scanNow();
    selectSmartDefaults(scan);
    render(scan);
  } finally {
    scanButton.disabled = false;
    scanButton.textContent = 'Scan again';
  }
}

function openConfirmModal() {
  const count = selectedCount();

  if (count === 0) {
    return;
  }

  confirmCopy.textContent = `Raccoon will move ${count} files into the tidy piles shown here.`;
  confirmModal.classList.remove('is-hidden');
}

function closeConfirmModal() {
  confirmModal.classList.add('is-hidden');
}

async function sortSelected() {
  const fileIds = Array.from(selectedFiles);
  confirmSortButton.disabled = true;
  confirmSortButton.textContent = 'Sorting...';

  try {
    const result = await window.raccoon.sortFiles({ fileIds, confirmed: true });
    closeConfirmModal();
    const scan = await window.raccoon.getScan();
    selectSmartDefaults(scan);
    render(scan);
    const slippery = result.skippedCount === 1 ? '1 was too slippery' : `${result.skippedCount} were too slippery`;
    headline.textContent = `Raccoon sorted ${result.movedCount} files`;
    moodLabel.textContent = slippery;
  } finally {
    confirmSortButton.disabled = false;
    confirmSortButton.textContent = 'Sort them';
  }
}

scanButton.addEventListener('click', refreshScan);

smartPickButton.addEventListener('click', () => {
  selectSmartDefaults();
  render(currentScan);
});

oldOnlyButton.addEventListener('click', () => {
  if (!currentScan) {
    return;
  }

  const oldCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  selectedFiles = new Set(
    allFiles()
      .filter((file) => new Date(file.lastModified).getTime() <= oldCutoff)
      .map((file) => file.id)
  );
  render(currentScan);
});

noneButton.addEventListener('click', () => {
  selectedFiles.clear();
  render(currentScan);
});

sortButton.addEventListener('click', openConfirmModal);
cancelSortButton.addEventListener('click', closeConfirmModal);
confirmSortButton.addEventListener('click', sortSelected);

chooseFolderButton.addEventListener('click', async () => {
  await window.raccoon.chooseFolder();
  const scan = await window.raccoon.getScan();
  selectSmartDefaults(scan);
  render(scan);
});

window.raccoon.onScanResult((scan) => {
  const previouslyKnown = new Set(allFiles().map((file) => file.id));
  const currentIds = new Set(allFiles(scan).map((file) => file.id));
  selectedFiles = new Set(Array.from(selectedFiles).filter((id) => currentIds.has(id)));

  for (const file of allFiles(scan)) {
    if (!previouslyKnown.has(file.id) && file.selectedByDefault) {
      selectedFiles.add(file.id);
    }
  }

  render(scan);
});

window.raccoon.getScan().then((scan) => {
  selectSmartDefaults(scan);
  render(scan);
});
