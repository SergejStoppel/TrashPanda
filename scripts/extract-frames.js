'use strict';
/*
 * Extracts individual animation frames from the labeled sprite sheets in
 * src/assets/animations/*.png (title on top, a row of numbered frames in the
 * middle, captions below, all on a green background).
 *
 * For each sheet it:
 *   1. keys out the green background with a border flood fill (interior green,
 *      like a tea cup, is preserved),
 *   2. isolates the middle frame row and skips the title and caption text,
 *   3. detects the individual frames by column gaps,
 *   4. normalizes them to one cell size, anchored feet-to-baseline,
 *   5. writes a transparent horizontal strip plus individual frame PNGs,
 *   6. updates animations.json with frame count, cell size, fps, and loop.
 *
 * Pure Node, no dependencies, so it runs anywhere the project does.
 *   node scripts/extract-frames.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SRC_DIR = path.join(__dirname, '..', 'src', 'assets', 'animations');
const OUT_DIR = path.join(SRC_DIR, 'frames');

// Per-sheet playback metadata (not visually detectable). Keyed by file base name.
const META = {
  idle_breath: { name: 'idle_breathe', fps: 2, loop: 'pingpong', frames: 4 },
  drink_tea: { name: 'drink_tea', fps: 2, loop: 'once', frames: 5 },
  read_book: { name: 'read_book', fps: 2, loop: 'loop', frames: 4 },
  eat_cookie: { name: 'eat_cookie', fps: 3, loop: 'loop', frames: 4 },
  groom: { name: 'groom', fps: 3, loop: 'loop', frames: 4 },
  look_around: { name: 'look_around', fps: 2, loop: 'loop', frames: 4 },
  stretch: { name: 'stretch', fps: 3, loop: 'once', frames: 4 }
};
const TOL = 72;   // background colour match tolerance
const PAD = 8;    // transparent padding inside each cell

// ---------- PNG decode (filters 0-4, color types 2/6, 8-bit, non-interlaced) ----------
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png');
  let o = 8, w, h, ct, idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('ascii', o + 4, o + 8);
    const data = buf.slice(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      if (data[8] !== 8) throw new Error('bit depth ' + data[8] + ' unsupported');
      if (data[12] !== 0) throw new Error('interlaced png unsupported');
      ct = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    o += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : (() => { throw new Error('color type ' + ct + ' unsupported'); })();
  const stride = w * ch;
  const out = Buffer.alloc(w * h * 4);
  const cur = Buffer.alloc(stride), prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p++];
    for (let i = 0; i < stride; i++) {
      let v = raw[p++];
      const a = i >= ch ? cur[i - ch] : 0;
      const b = prev[i];
      const c = i >= ch ? prev[i - ch] : 0;
      if (f === 1) v = (v + a) & 255;
      else if (f === 2) v = (v + b) & 255;
      else if (f === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      cur[i] = v;
    }
    for (let x = 0; x < w; x++) {
      const s = x * ch, d = (y * w + x) * 4;
      out[d] = cur[s]; out[d + 1] = cur[s + 1]; out[d + 2] = cur[s + 2];
      out[d + 3] = ch === 4 ? cur[s + 3] : 255;
    }
    cur.copy(prev);
  }
  return { w, h, px: out };
}

// ---------- PNG encode (RGBA) ----------
const crcT = (() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let v = i; for (let b = 0; b < 8; b++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1; t[i] = v >>> 0; } return t; })();
function crc(b) { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(t, d) { const tt = Buffer.from(t), l = Buffer.alloc(4), cc = Buffer.alloc(4); l.writeUInt32BE(d.length, 0); cc.writeUInt32BE(crc(Buffer.concat([tt, d])), 0); return Buffer.concat([l, tt, d, cc]); }
function encodePng(w, h, px) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- extraction ----------
function dist2(px, i, c) { const dr = px[i] - c[0], dg = px[i + 1] - c[1], db = px[i + 2] - c[2]; return dr * dr + dg * dg + db * db; }

function medianBorder(img) {
  const { w, h, px } = img; const rs = [], gs = [], bs = [];
  const samp = (x, y) => { const i = (y * w + x) * 4; rs.push(px[i]); gs.push(px[i + 1]); bs.push(px[i + 2]); };
  for (let x = 0; x < w; x += 4) { samp(x, 0); samp(x, h - 1); }
  for (let y = 0; y < h; y += 4) { samp(0, y); samp(w - 1, y); }
  const med = a => a.sort((p, q) => p - q)[a.length >> 1];
  return [med(rs), med(gs), med(bs)];
}

function backgroundMask(img, bg, tol) {
  const { w, h, px } = img; const tol2 = tol * tol;
  const bgm = new Uint8Array(w * h);
  const stack = [];
  const push = (x, y) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const idx = y * w + x; if (bgm[idx]) return; if (dist2(px, idx * 4, bg) <= tol2) { bgm[idx] = 1; stack.push(idx); } };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) { const idx = stack.pop(); const x = idx % w, y = (idx / w) | 0; push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1); }
  // one halo-trim pass: green-ish fringe pixels touching background become background
  const fringe2 = (tol * 1.5) * (tol * 1.5);
  const add = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const idx = y * w + x; if (bgm[idx]) continue;
    if (dist2(px, idx * 4, bg) > fringe2) continue;
    if ((x > 0 && bgm[idx - 1]) || (x < w - 1 && bgm[idx + 1]) || (y > 0 && bgm[idx - w]) || (y < h - 1 && bgm[idx + w])) add.push(idx);
  }
  for (const idx of add) bgm[idx] = 1;
  return bgm;
}

function runs(vals, thr, minGap) {
  const out = []; let start = -1, gap = 0;
  for (let i = 0; i < vals.length; i++) {
    if (vals[i] > thr) { if (start < 0) start = i; gap = 0; }
    else if (start >= 0) { gap++; if (gap >= minGap) { out.push([start, i - gap]); start = -1; gap = 0; } }
  }
  if (start >= 0) out.push([start, vals.length - 1]);
  return out;
}

function extractSheet(img, expectedN) {
  const bg = medianBorder(img);
  const bgm = backgroundMask(img, bg, TOL);
  const { w, h } = img;
  const rowFg = new Array(h).fill(0);
  for (let y = 0; y < h; y++) { let c = 0; const base = y * w; for (let x = 0; x < w; x++) if (!bgm[base + x]) c++; rowFg[y] = c; }
  const bands = runs(rowFg, w * 0.015, Math.round(h * 0.012));
  if (!bands.length) throw new Error('no content bands found');
  bands.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
  const [by0, by1] = bands[0];
  const bandH = by1 - by0 + 1;
  const colFg = new Array(w).fill(0);
  for (let y = by0; y <= by1; y++) { const base = y * w; for (let x = 0; x < w; x++) if (!bgm[base + x]) colFg[x]++; }
  // content horizontal extent within the band
  let minX = w, maxX = 0;
  for (let x = 0; x < w; x++) if (colFg[x] > bandH * 0.02) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
  // frame count: use the known count; fall back to gap auto-detect
  let N = expectedN;
  if (!N) N = runs(colFg, bandH * 0.03, Math.round(w * 0.012)).filter(([a, b]) => (b - a) > w * 0.05).length || 1;
  // split the occupied row into N even windows, then take the dominant blob in each
  const span = (maxX - minX + 1) / N;
  const frames = [];
  for (let k = 0; k < N; k++) {
    const wx0 = Math.round(minX + k * span), wx1 = Math.round(minX + (k + 1) * span) - 1;
    const sub = [];
    for (let x = wx0; x <= wx1; x++) sub.push(colFg[x] > bandH * 0.03 ? 1 : 0);
    const r = runs(sub, 0, 3);
    const best = r.length ? r.reduce((m, c) => (c[1] - c[0] > m[1] - m[0] ? c : m)) : [0, wx1 - wx0];
    const cx0 = wx0 + best[0], cx1 = wx0 + best[1];
    let x0 = cx1, x1 = cx0, y0 = by1, y1 = by0;
    for (let y = by0; y <= by1; y++) { const base = y * w; for (let x = cx0; x <= cx1; x++) if (!bgm[base + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
    frames.push({ x0, y0, x1, y1 });
  }
  return { bg, bgm, band: [by0, by1], frames };
}

function composeStrip(img, res) {
  const { w, px } = img; const { bgm, frames } = res;
  const fw = Math.max(...frames.map(f => f.x1 - f.x0 + 1)) + PAD * 2;
  const fh = Math.max(...frames.map(f => f.y1 - f.y0 + 1)) + PAD * 2;
  const n = frames.length;
  const strip = Buffer.alloc(fw * n * fh * 4);
  const singles = [];
  frames.forEach((f, fi) => {
    const cw = f.x1 - f.x0 + 1, chh = f.y1 - f.y0 + 1;
    const offX = Math.round((fw - cw) / 2), offY = fh - PAD - chh;
    const single = Buffer.alloc(fw * fh * 4);
    for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++) {
      const si = (f.y0 + y) * w + (f.x0 + x); if (bgm[si]) continue;
      const s = si * 4;
      const dStrip = ((offY + y) * (fw * n) + (fi * fw + offX + x)) * 4;
      strip[dStrip] = px[s]; strip[dStrip + 1] = px[s + 1]; strip[dStrip + 2] = px[s + 2]; strip[dStrip + 3] = 255;
      const dS = ((offY + y) * fw + (offX + x)) * 4;
      single[dS] = px[s]; single[dS + 1] = px[s + 1]; single[dS + 2] = px[s + 2]; single[dS + 3] = 255;
    }
    singles.push(single);
  });
  return { strip, singles, fw, fh, n };
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const manifest = {};
  const report = [];
  for (const file of fs.readdirSync(SRC_DIR).filter(f => f.toLowerCase().endsWith('.png'))) {
    const base = path.basename(file, path.extname(file));
    const meta = META[base] || { name: base, fps: 4, loop: 'loop' };
    const img = decodePng(fs.readFileSync(path.join(SRC_DIR, file)));
    const res = extractSheet(img, meta.frames);
    const { strip, singles, fw, fh, n } = composeStrip(img, res);
    const animDir = path.join(OUT_DIR, meta.name);
    fs.mkdirSync(animDir, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, meta.name + '.png'), encodePng(fw * n, fh, strip));
    singles.forEach((s, i) => fs.writeFileSync(path.join(animDir, `frame_${i}.png`), encodePng(fw, fh, s)));
    manifest[meta.name] = { frames: n, frameWidth: fw, frameHeight: fh, fps: meta.fps, loop: meta.loop, strip: `frames/${meta.name}.png` };
    report.push(`${file.padEnd(18)} -> ${meta.name.padEnd(12)} ${n} frames, cell ${fw}x${fh}, band ${res.band.join('-')}, bg rgb(${res.bg.join(',')})`);
  }
  fs.writeFileSync(path.join(SRC_DIR, 'animations.json'), JSON.stringify(manifest, null, 2));
  console.log('Extracted animation frames:\n' + report.join('\n'));
  console.log('\nManifest written to src/assets/animations/animations.json');
}

if (require.main === module) main();
