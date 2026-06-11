const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp']);
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };
const MAX_DATA_URL_BYTES = 12 * 1024 * 1024;   // skip very large photos
const MAX_SCAN = 5000;                          // cap how many we enumerate

function ext(name) {
  return path.extname(name).replace(/^\./, '').toLowerCase();
}

// Enumerate image files under a folder. Local only, no network, metadata only.
async function collectPhotos(folder, { recursive = true } = {}) {
  const out = [];
  const stack = [folder];
  while (stack.length && out.length < MAX_SCAN) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (recursive) stack.push(full);
        continue;
      }
      if (entry.isFile() && IMAGE_EXTENSIONS.has(ext(entry.name))) out.push(full);
      if (out.length >= MAX_SCAN) break;
    }
  }
  return out;
}

async function pickRandomPhoto(folder, options = {}) {
  if (!folder || !fs.existsSync(folder)) return null;
  const photos = await collectPhotos(folder, options);
  if (!photos.length) return null;
  const fullPath = photos[Math.floor(Math.random() * photos.length)];
  return { fullPath, fileName: path.basename(fullPath) };
}

// Read an image into a data URL so the renderer can show it under a strict CSP
// without granting file-system access. Returns null if missing or too large.
async function readPhotoDataUrl(fullPath) {
  try {
    const stat = await fsp.stat(fullPath);
    if (!stat.isFile() || stat.size > MAX_DATA_URL_BYTES) return null;
    const buf = await fsp.readFile(fullPath);
    const mime = MIME[ext(fullPath)] || 'image/jpeg';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

module.exports = { pickRandomPhoto, readPhotoDataUrl, collectPhotos };
