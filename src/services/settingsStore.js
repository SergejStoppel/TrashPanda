const fs = require('fs');
const path = require('path');
const os = require('os');

function buildDefaults(defaultDownloadsFolder = path.join(os.homedir(), 'Downloads')) {
  return {
    watchedFolder: defaultDownloadsFolder,
    companionX: null,
    companionY: null,
    companionHidden: false,
    watchingPaused: false,
    oldFileDays: 30,
    skipRecentSeconds: 60,
    largeFileThresholdBytes: 2147483648,
    trashOldInstallerDays: 45,
    trashOldArchiveDays: 120,
    trashOldScreenshotDays: 60,
    trashStaleAccessDays: 90,
    trashStaleDays: 365,
    agedMediaBytes: 52428800,
    photoFolder: null,
    photoFrameEnabled: false,
    photoFrameMinMinutes: 25,
    photoFrameSeconds: 9,
    lastClutterNotificationDate: null
  };
}

class SettingsStore {
  constructor(userDataPath, defaultDownloadsFolder) {
    this.filePath = path.join(userDataPath, 'settings.json');
    this.defaults = buildDefaults(defaultDownloadsFolder);
    this.settings = { ...this.defaults };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const saved = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        this.settings = { ...this.defaults, ...saved };
      }
    } catch {
      this.settings = { ...this.defaults };
    }

    this.save();
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.settings, null, 2));
  }

  get() {
    return { ...this.settings };
  }

  update(patch) {
    this.settings = { ...this.settings, ...patch };
    this.save();
    return this.get();
  }
}

module.exports = {
  SettingsStore,
  buildDefaults
};
