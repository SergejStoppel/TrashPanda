const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  Tray
} = require('electron');
const { scanDownloads } = require('./services/downloadScanner');
const { isHiddenFileName, isTemporaryDownload, PILES_FOLDER_NAME } = require('./services/fileCategorizer');
const { moveFiles } = require('./services/fileMover');
const { SettingsStore } = require('./services/settingsStore');
const { HistoryStore } = require('./services/historyStore');

const COMPANION_WIDTH = 160;
const COMPANION_HEIGHT = 220;
const PANEL_WIDTH = 560;
const PANEL_HEIGHT = 780;

let settingsStore;
let historyStore;
let companionWindow;
let panelWindow;
let tray;
let watcher;
let watchDebounceTimer;
let cursorTimer;
let currentScanResult;
let dragStart;
let lastNewFileNoticeAt = 0;
let reactionTimers = [];
let animationManifest = {};
const pendingFilePaths = new Set();
const singleInstanceLock = app.requestSingleInstanceLock();

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function loadAnimations() {
  try {
    animationManifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', 'animations', 'animations.json'), 'utf8'));
  } catch {
    animationManifest = {};
  }
}

function createTrayIcon() {
  const image = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray-raccoon.png'));
  return image.isEmpty() ? nativeImage.createEmpty() : image;
}

function getCompanionPosition() {
  const settings = settingsStore.get();
  const workArea = screen.getPrimaryDisplay().workArea;
  const savedX = Number(settings.companionX);
  const savedY = Number(settings.companionY);

  if (Number.isFinite(savedX) && Number.isFinite(savedY)) {
    return {
      x: Math.max(workArea.x, Math.min(savedX, workArea.x + workArea.width - COMPANION_WIDTH)),
      y: Math.max(workArea.y, Math.min(savedY, workArea.y + workArea.height - COMPANION_HEIGHT))
    };
  }

  return {
    x: workArea.x + workArea.width - COMPANION_WIDTH - 16,
    y: workArea.y + workArea.height - COMPANION_HEIGHT - 16
  };
}

function createCompanionWindow() {
  if (companionWindow && !companionWindow.isDestroyed()) {
    return companionWindow;
  }

  const position = getCompanionPosition();
  companionWindow = new BrowserWindow({
    width: COMPANION_WIDTH,
    height: COMPANION_HEIGHT,
    x: position.x,
    y: position.y,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  companionWindow.setAlwaysOnTop(true, 'floating');
  companionWindow.loadFile(path.join(__dirname, 'companion.html'));

  companionWindow.once('ready-to-show', () => {
    if (!settingsStore.get().companionHidden) {
      companionWindow.showInactive();
    }
  });

  companionWindow.webContents.once('did-finish-load', async () => {
    startCursorTracker();
    companionWindow.webContents.send('companion:animations', animationManifest);

    if (currentScanResult) {
      sendCompanionMood(currentScanResult);
    }

    sendCompanionUpdate({
      visualState: 'idle',
      bubble: 'raccoon is watching downloads'
    });
  });

  companionWindow.on('closed', () => {
    stopCursorTracker();
    companionWindow = null;
  });

  return companionWindow;
}

function startCursorTracker() {
  stopCursorTracker();

  cursorTimer = setInterval(() => {
    if (!companionWindow || companionWindow.isDestroyed() || !companionWindow.isVisible()) {
      return;
    }

    const cursor = screen.getCursorScreenPoint();
    const bounds = companionWindow.getBounds();
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height * 0.55;
    const x = Math.max(-1, Math.min(1, (cursor.x - centerX) / 360));
    const y = Math.max(-1, Math.min(1, (cursor.y - centerY) / 240));
    companionWindow.webContents.send('companion:cursor', { x, y });
  }, 120);
}

function stopCursorTracker() {
  if (cursorTimer) {
    clearInterval(cursorTimer);
    cursorTimer = null;
  }
}

function createPanelWindow() {
  if (panelWindow && !panelWindow.isDestroyed()) {
    panelWindow.show();
    panelWindow.focus();
    return panelWindow;
  }

  panelWindow = new BrowserWindow({
    width: PANEL_WIDTH,
    height: PANEL_HEIGHT,
    minWidth: PANEL_WIDTH,
    minHeight: PANEL_HEIGHT,
    title: 'Download Raccoon',
    backgroundColor: '#7d9a6e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  panelWindow.loadFile(path.join(__dirname, 'panel.html'));

  panelWindow.webContents.once('did-finish-load', async () => {
    const scan = currentScanResult || (await performScan('panel'));
    sendPanelScan(scan);
    panelWindow.webContents.send('settings:update', settingsStore.get());
  });

  panelWindow.on('closed', () => {
    panelWindow = null;
  });

  return panelWindow;
}

function showCompanion() {
  const win = createCompanionWindow();
  settingsStore.update({ companionHidden: false });
  updateTrayMenu();
  win.showInactive();
  sendSettingsUpdate();
}

function hideCompanion() {
  if (companionWindow && !companionWindow.isDestroyed()) {
    companionWindow.hide();
  }

  settingsStore.update({ companionHidden: true });
  updateTrayMenu();
  sendSettingsUpdate();
}

function sendSettingsUpdate() {
  const settings = settingsStore.get();

  if (panelWindow && !panelWindow.isDestroyed()) {
    panelWindow.webContents.send('settings:update', settings);
  }

  if (companionWindow && !companionWindow.isDestroyed()) {
    companionWindow.webContents.send('settings:update', settings);
  }
}

function sendCompanionUpdate(payload) {
  if (companionWindow && !companionWindow.isDestroyed()) {
    companionWindow.webContents.send('companion:update', payload);
  }
}

function sendPanelScan(scanResult) {
  if (panelWindow && !panelWindow.isDestroyed()) {
    panelWindow.webContents.send('panel:scan-result', scanResult);
  }
}

function getMoodFromScan(scanResult) {
  if (scanResult.missing) {
    return {
      mood: 'missing',
      visualState: 'notice',
      headline: 'raccoon cannot find downloads'
    };
  }

  if (scanResult.totalFiles <= 10) {
    return {
      mood: 'tidy',
      visualState: scanResult.totalFiles === 0 ? 'sleep' : 'idle',
      headline: scanResult.totalFiles === 0 ? 'downloads is cozy' : 'raccoon found no crumbs'
    };
  }

  if (scanResult.totalFiles <= 30) {
    return {
      mood: 'curious',
      visualState: 'carry',
      headline: 'tiny pile forming'
    };
  }

  if (scanResult.totalFiles <= 75) {
    return {
      mood: 'busy',
      visualState: 'sweep',
      headline: 'downloads is getting snacky'
    };
  }

  return {
    mood: 'buried',
    visualState: 'buried',
    headline: 'too many crumbs'
  };
}

function bubbleForScan(scanResult) {
  if (scanResult.missing) {
    return "I can't find Downloads. click me";
  }

  const n = scanResult.totalFiles;
  if (n === 0) return 'Downloads is spotless';
  if (n <= 10) return `just ${n} crumbs here, all cozy`;
  if (n <= 30) return `${n} files piling up. click me to tidy`;
  if (n <= 75) return `${n} files getting snacky. click me`;
  return `whoa, ${n} files. click me to help`;
}

function sendCompanionMood(scanResult, bubble) {
  const mood = getMoodFromScan(scanResult);
  sendCompanionUpdate({
    ...mood,
    fileCount: scanResult.totalFiles,
    totalBytes: scanResult.totalBytes,
    bubble: bubble || bubbleForScan(scanResult)
  });
}

function clearReactionTimers() {
  for (const timer of reactionTimers) {
    clearTimeout(timer);
  }

  reactionTimers = [];
}

function scheduleReactionStep(callback, delay) {
  const timer = setTimeout(callback, delay);
  reactionTimers.push(timer);
}

function triggerNewFileReaction() {
  clearReactionTimers();
  lastNewFileNoticeAt = Date.now();
  sendCompanionUpdate({
    visualState: 'notice',
    bubble: 'raccoon caught a file'
  });

  scheduleReactionStep(() => {
    sendCompanionUpdate({ visualState: 'carry', bubble: 'new crumb' });
  }, 1200);

  scheduleReactionStep(() => {
    if (currentScanResult) {
      sendCompanionMood(currentScanResult);
    }
  }, 5200);
}

function triggerCelebrate(result) {
  clearReactionTimers();
  const bubble = `raccoon sorted ${result.movedCount} files. ${result.skippedCount} were too slippery.`;
  sendCompanionUpdate({
    visualState: 'sweep',
    bubble: 'raccoon is making tidy piles'
  });

  scheduleReactionStep(() => {
    sendCompanionUpdate({
      visualState: 'celebrate',
      bubble
    });
  }, 1000);

  scheduleReactionStep(() => {
    if (currentScanResult) {
      sendCompanionMood(currentScanResult);
    }
  }, 5600);
}

async function performScan(reason = 'manual') {
  if (reason === 'manual') {
    sendCompanionUpdate({
      visualState: 'think',
      bubble: 'raccoon is making a tidy route'
    });
  }

  currentScanResult = await scanDownloads(settingsStore.get());
  sendPanelScan(currentScanResult);

  if (reason !== 'startup') {
    sendCompanionMood(currentScanResult);
  }

  if (currentScanResult.missing) {
    sendCompanionMood(currentScanResult, 'raccoon cannot find downloads');
    createPanelWindow();
    return currentScanResult;
  }

  maybeSendDailyClutterNotice(currentScanResult);
  return currentScanResult;
}

function maybeSendDailyClutterNotice(scanResult) {
  const settings = settingsStore.get();

  if (scanResult.totalFiles < 76 || settings.lastClutterNotificationDate === todayKey()) {
    return;
  }

  settingsStore.update({ lastClutterNotificationDate: todayKey() });
  sendSettingsUpdate();
  sendCompanionMood(scanResult, 'raccoon is under the downloads mountain');
}

async function analyzeFolder() {
  const result = await dialog.showOpenDialog(panelWindow || undefined, {
    title: 'Analyze a folder for cleanup',
    properties: ['openDirectory']
  });

  if (result.canceled || !result.filePaths[0]) {
    return currentScanResult || null;
  }

  const folder = result.filePaths[0];
  sendCompanionUpdate({ visualState: 'think', bubble: 'raccoon is rummaging through the folder' });
  const scan = await scanDownloads({ ...settingsStore.get(), watchedFolder: folder });
  currentScanResult = scan;
  createPanelWindow();
  sendPanelScan(scan);

  const name = path.basename(folder) || folder;
  if (scan.missing) {
    sendCompanionUpdate({ visualState: 'notice', bubble: 'raccoon could not read that folder' });
  } else if (scan.totalFiles > 0) {
    sendCompanionUpdate({ visualState: 'notice', bubble: `found ${scan.totalFiles} things in ${name}` });
  } else {
    sendCompanionUpdate({ visualState: 'idle', bubble: `${name} looks clean` });
  }

  return scan;
}

function setPinned(pinned) {
  settingsStore.update({ companionPinned: Boolean(pinned) });
  updateTrayMenu();
  sendSettingsUpdate();
  return settingsStore.get();
}

function updateTrayMenu() {
  if (!tray) {
    return;
  }

  const settings = settingsStore.get();
  const menu = Menu.buildFromTemplate([
    {
      label: settings.companionHidden ? 'Show raccoon' : 'Hide raccoon',
      click: () => (settings.companionHidden ? showCompanion() : hideCompanion())
    },
    {
      label: 'Pin raccoon in place',
      type: 'checkbox',
      checked: Boolean(settings.companionPinned),
      click: (menuItem) => setPinned(menuItem.checked)
    },
    { type: 'separator' },
    {
      label: 'Open piles',
      click: createPanelWindow
    },
    {
      label: 'Scan downloads now',
      click: () => performScan('manual')
    },
    {
      label: 'Analyze a folder...',
      click: () => analyzeFolder()
    },
    {
      label: settings.watchingPaused ? 'Resume watching downloads' : 'Pause watching downloads',
      click: () => setWatchingPaused(!settings.watchingPaused)
    },
    { type: 'separator' },
    {
      label: 'Quit raccoon',
      click: () => app.quit()
    }
  ]);

  tray.setContextMenu(menu);
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip('Download Raccoon');
  tray.on('click', () => {
    if (settingsStore.get().companionHidden) {
      showCompanion();
    } else {
      createPanelWindow();
    }
  });
  updateTrayMenu();
}

function showCompanionContextMenu() {
  const settings = settingsStore.get();
  const menu = Menu.buildFromTemplate([
    {
      label: 'Open piles',
      click: createPanelWindow
    },
    {
      label: 'Scan downloads now',
      click: () => performScan('manual')
    },
    {
      label: 'Analyze a folder...',
      click: () => analyzeFolder()
    },
    { type: 'separator' },
    {
      label: settings.companionPinned ? 'Unpin raccoon' : 'Pin raccoon in place',
      click: () => setPinned(!settings.companionPinned)
    },
    {
      label: settings.watchingPaused ? 'Resume watching' : 'Pause watching',
      click: () => setWatchingPaused(!settings.watchingPaused)
    },
    {
      label: 'Hide raccoon',
      click: hideCompanion
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => app.quit()
    }
  ]);

  menu.popup({ window: companionWindow || undefined });
}

function setWatchingPaused(paused) {
  settingsStore.update({ watchingPaused: Boolean(paused) });

  if (paused) {
    stopWatcher();
    sendCompanionUpdate({ visualState: 'sleep', bubble: 'raccoon is taking a tiny nap' });
  } else {
    startWatcher();
    sendCompanionUpdate({ visualState: 'idle', bubble: 'raccoon is watching downloads' });
  }

  updateTrayMenu();
  sendSettingsUpdate();
  return settingsStore.get();
}

function stopWatcher() {
  if (watcher) {
    watcher.close();
    watcher = null;
  }

  if (watchDebounceTimer) {
    clearTimeout(watchDebounceTimer);
    watchDebounceTimer = null;
  }
}

function startWatcher() {
  stopWatcher();
  const settings = settingsStore.get();

  if (settings.watchingPaused || !settings.watchedFolder || !fs.existsSync(settings.watchedFolder)) {
    return;
  }

  try {
    watcher = fs.watch(settings.watchedFolder, { persistent: true }, (_eventType, fileName) => {
      if (settingsStore.get().watchingPaused) {
        return;
      }

      if (fileName) {
        const normalizedName = fileName.toString();

        if (!isHiddenFileName(normalizedName) && normalizedName !== PILES_FOLDER_NAME && !isTemporaryDownload(normalizedName)) {
          pendingFilePaths.add(path.join(settingsStore.get().watchedFolder, normalizedName));
        }
      }

      scheduleWatchScan();
    });

    watcher.on('error', (error) => {
      sendCompanionUpdate({
        visualState: 'notice',
        bubble: 'raccoon needs help with downloads'
      });

      if (panelWindow && !panelWindow.isDestroyed()) {
        panelWindow.webContents.send('panel:sort-result', {
          movedCount: 0,
          skippedCount: 1,
          errorMessage: error.message
        });
      }
    });
  } catch (error) {
    sendCompanionUpdate({
      visualState: 'notice',
      bubble: 'raccoon cannot watch downloads'
    });
  }
}

function scheduleWatchScan() {
  if (watchDebounceTimer) {
    clearTimeout(watchDebounceTimer);
  }

  watchDebounceTimer = setTimeout(async () => {
    await handleWatchBurst();
  }, 2000);
}

async function handleWatchBurst() {
  const candidates = Array.from(pendingFilePaths).slice(0, 12);
  pendingFilePaths.clear();
  let completedFile = null;

  for (const filePath of candidates) {
    completedFile = await waitForStableFile(filePath);

    if (completedFile) {
      break;
    }
  }

  await performScan('watch');

  if (completedFile && Date.now() - lastNewFileNoticeAt > 30000) {
    triggerNewFileReaction();
  }
}

async function waitForStableFile(filePath) {
  if (!filePath || isHiddenFileName(path.basename(filePath)) || isTemporaryDownload(filePath)) {
    return null;
  }

  if (isInsidePilesFolder(filePath, settingsStore.get().watchedFolder)) {
    return null;
  }

  let lastSize = null;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const stats = await fsp.stat(filePath);

      if (!stats.isFile()) {
        return null;
      }

      if (lastSize !== null && stats.size === lastSize) {
        return { filePath, fileName: path.basename(filePath), sizeBytes: stats.size };
      }

      lastSize = stats.size;
    } catch {
      return null;
    }

    await wait(450);
  }

  return null;
}

function isInsidePilesFolder(filePath, watchedFolder) {
  const pilesRoot = path.resolve(watchedFolder, PILES_FOLDER_NAME).toLowerCase();
  const resolvedFile = path.resolve(filePath).toLowerCase();
  return resolvedFile === pilesRoot || resolvedFile.startsWith(`${pilesRoot}${path.sep}`);
}

function registerIpcHandlers() {
  ipcMain.on('companion:open-panel', () => {
    clearReactionTimers();
    createPanelWindow();
    sendCompanionUpdate({ visualState: 'think', bubble: 'raccoon opened the piles' });

    scheduleReactionStep(() => {
      if (currentScanResult) {
        sendCompanionMood(currentScanResult);
      }
    }, 1800);
  });

  ipcMain.on('companion:hide', hideCompanion);
  ipcMain.on('companion:context-menu', showCompanionContextMenu);

  ipcMain.on('companion:drag-start', (_event, point) => {
    if (!companionWindow || companionWindow.isDestroyed()) {
      return;
    }

    dragStart = {
      pointerX: Number(point.screenX),
      pointerY: Number(point.screenY),
      bounds: companionWindow.getBounds()
    };
  });

  ipcMain.on('companion:drag-move', (_event, point) => {
    if (!dragStart || !companionWindow || companionWindow.isDestroyed()) {
      return;
    }

    if (settingsStore.get().companionPinned) {
      return;
    }

    const x = dragStart.bounds.x + Number(point.screenX) - dragStart.pointerX;
    const y = dragStart.bounds.y + Number(point.screenY) - dragStart.pointerY;
    companionWindow.setPosition(Math.round(x), Math.round(y));
  });

  ipcMain.on('companion:drag-end', () => {
    if (companionWindow && !companionWindow.isDestroyed()) {
      const bounds = companionWindow.getBounds();
      settingsStore.update({ companionX: bounds.x, companionY: bounds.y });
      sendSettingsUpdate();
    }

    dragStart = null;
  });

  ipcMain.handle('panel:get-scan', async () => currentScanResult || performScan('panel'));
  ipcMain.handle('panel:scan-now', async () => performScan('manual'));
  ipcMain.handle('panel:analyze-folder', async () => analyzeFolder());
  ipcMain.handle('companion:get-animations', () => animationManifest);

  ipcMain.handle('panel:sort-files', async (_event, payload) => {
    const fileIds = Array.isArray(payload?.fileIds) ? payload.fileIds : [];
    const confirmed = payload?.confirmed === true;

    if (!confirmed || fileIds.length === 0) {
      return {
        movedCount: 0,
        skippedCount: 0,
        totalBytesMoved: 0,
        moves: []
      };
    }

    const scan = currentScanResult || (await performScan('sort'));
    const selected = new Set(fileIds);
    const files = scan.categories.flatMap((category) => category.files).filter((file) => selected.has(file.id));
    const result = await moveFiles({ files, watchedFolder: scan.watchedFolder });

    historyStore.add({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      watchedFolder: scan.watchedFolder,
      ...result
    });

    currentScanResult = await performScan('sort');
    triggerCelebrate(result);

    if (panelWindow && !panelWindow.isDestroyed()) {
      panelWindow.webContents.send('panel:sort-result', result);
    }

    return result;
  });

  ipcMain.handle('panel:choose-folder', async () => {
    const result = await dialog.showOpenDialog(panelWindow || undefined, {
      title: 'Choose raccoon watch folder',
      properties: ['openDirectory']
    });

    if (result.canceled || !result.filePaths[0]) {
      return settingsStore.get();
    }

    settingsStore.update({ watchedFolder: result.filePaths[0] });
    sendSettingsUpdate();
    startWatcher();
    await performScan('settings');
    return settingsStore.get();
  });

  ipcMain.handle('settings:get', () => settingsStore.get());
  ipcMain.handle('settings:set-paused', (_event, paused) => setWatchingPaused(paused));
  ipcMain.handle('settings:set-pinned', (_event, pinned) => setPinned(pinned));
}

if (!singleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showCompanion();
    createPanelWindow();
  });

  app.whenReady().then(async () => {
    settingsStore = new SettingsStore(app.getPath('userData'), app.getPath('downloads'));
    historyStore = new HistoryStore(app.getPath('userData'));
    Menu.setApplicationMenu(null);
    loadAnimations();
    registerIpcHandlers();
    createTray();
    createCompanionWindow();
    currentScanResult = await performScan('startup');
    sendCompanionMood(currentScanResult);
    startWatcher();
  });
}

app.on('window-all-closed', (event) => {
  event.preventDefault();
});

app.on('before-quit', () => {
  stopWatcher();
  stopCursorTracker();
});

app.on('activate', () => {
  if (!companionWindow) {
    createCompanionWindow();
  }
});
