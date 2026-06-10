const fs = require('fs');
const path = require('path');

class HistoryStore {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, 'history.json');
    this.entries = [];
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const saved = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        this.entries = Array.isArray(saved) ? saved : [];
      }
    } catch {
      this.entries = [];
    }

    this.save();
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.entries, null, 2));
  }

  add(entry) {
    this.entries.unshift(entry);
    this.entries = this.entries.slice(0, 200);
    this.save();
    return entry;
  }

  list() {
    return [...this.entries];
  }
}

module.exports = {
  HistoryStore
};
