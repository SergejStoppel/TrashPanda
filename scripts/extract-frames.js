'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SRC_DIR = path.join(__dirname, '..', 'src', 'assets', 'animations');
const OUT_DIR = path.join(SRC_DIR, 'frames');
const PIXEL_H = 96;        // logical frame height every clip is normalized to
const PALETTE_SIZE = 64;   // shared colour palette size
const PAD = 6;             // transparent padding inside each cell (source px)
const TOL = 72;            // background match tolerance
const ALPHA_CUT = 128;     // edge hardness after downsample

// rows = frames per character row (length = number of rows on the sheet)
// clips = named animations sliced out of those rows
const SHEETS = {
  idle_breath: { rows: [4], master: true, clips: [{ name: 'idle_breathe', row: 0, from: 0, to: 3, fps: 2, loop: 'pingpong' }] },
  drink_tea: { rows: [5], clips: [{ name: 'drink_tea', row: 0, from: 0, to: 4, fps: 2, loop: 'once' }] },
  read_book: { rows: [4], clips: [{ name: 'read_book', row: 0, from: 0, to: 3, fps: 2, loop: 'loop' }] },
  eat_cookie: { rows: [4], clips: [{ name: 'eat_cookie', row: 0, from: 0, to: 3, fps: 3, loop: 'loop' }] },
  groom: { rows: [4], clips: [{ name: 'groom', row: 0, from: 0, to: 3, fps: 3, loop: 'loop' }] },
  look_around: { rows: [4], clips: [{ name: 'look_around', row: 0, from: 0, to: 3, fps: 2, loop: 'loop' }] },
  stretch: { rows: [4], clips: [{ name: 'stretch', row: 0, from: 0, to: 3, fps: 3, loop: 'once' }] },
  ywan: { rows: [4], clips: [{ name: 'yawn', row: 0, from: 0, to: 3, fps: 3, loop: 'once' }] },
  greet_wave: { rows: [6], clips: [{ name: 'greet_wave', row: 0, from: 0, to: 5, fps: 4, loop: 'once' }] },
  click_react: { rows: [4], clips: [{ name: 'click_react', row: 0, from: 0, to: 3, fps: 4, loop: 'once' }] },
  present_discovery: { rows: [5], clips: [{ name: 'present_discovery', row: 0, from: 0, to: 4, fps: 4, loop: 'once' }] },
  photo_frame: { rows: [10], clips: [{ name: 'photo_frame', row: 0, from: 0, to: 9, fps: 6, loop: 'once' }] },
  pet: { rows: [4], clips: [{ name: 'pet', row: 0, from: 0, to: 3, fps: 4, loop: 'loop' }] },
  idle_to_sort: { rows: [6], clips: [{ name: 'idle_to_sort', row: 0, from: 0, to: 5, fps: 4, loop: 'once' }] },
  sort_organize: { rows: [6], clips: [{ name: 'sort_organize', row: 0, from: 0, to: 5, fps: 3, loop: 'loop' }] },
  sort_to_idle_transition: { rows: [6], clips: [{ name: 'sort_to_idle', row: 0, from: 0, to: 5, fps: 4, loop: 'once' }] },
  drag_hold: {
    rows: [8],
    clips: [
      { name: 'drag_hold_loop', row: 0, from: 0, to: 3, fps: 4, loop: 'loop' },
      { name: 'drag_release', row: 0, from: 4, to: 7, fps: 4, loop: 'once' }
    ]
  },
  idle_to_sleep: {
    rows: [8, 8],
    clips: [
      { name: 'idle_to_sleep', row: 0, from: 0, to: 7, fps: 3, loop: 'once' },
      { name: 'sleep_to_idle', row: 1, from: 0, to: 7, fps: 3, loop: 'once' }
    ]
  }
};

// ---------- PNG decode ----------
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png');
  let o = 8, w, h, ct, idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('ascii', o + 4, o + 8);
    const data = buf.slice(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      if (data[8] !== 8) throw new Error('bit depth unsupported');
      if (data[12] !== 0) throw new Error('interlaced unsupported');
      ct = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    o += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : (() => { throw new Error('color type ' + ct); })();
  const stride = w * ch, out = Buffer.alloc(w * h * 4);
  const cur = Buffer.alloc(stride), prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p++];
    for (let i = 0; i < stride; i++) {
      let v = raw[p++];
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      if (f === 1) v = (v + a) & 255;
      else if (f === 2) v = (v + b) & 255;
      else if (f === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255; }
      cur[i] = v;
    }
    for (let x = 0; x < w; x++) { const s = x * ch, d = (y * w + x) * 4; out[d] = cur[s]; out[d + 1] = cur[s + 1]; out[d + 2] = cur[s + 2]; out[d + 3] = ch === 4 ? cur[s + 3] : 255; }
    cur.copy(prev);
  }
  return { w, h, px: out };
}

// ---------- PNG encode ----------
const crcT = (() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let v = i; for (let b = 0; b < 8; b++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1; t[i] = v >>> 0; } return t; })();
function crc(b) { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(t, d) { const tt = Buffer.from(t), l = Buffer.alloc(4), cc = Buffer.alloc(4); l.writeUInt32BE(d.length, 0); cc.writeUInt32BE(crc(Buffer.concat([tt, d])), 0); return Buffer.concat([l, tt, d, cc]); }
function encodePng(w, h, px) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- background + bands ----------
function dist2(px, i, c) { const dr = px[i] - c[0], dg = px[i + 1] - c[1], db = px[i + 2] - c[2]; return dr * dr + dg * dg + db * db; }
function medianBorder(img) {
  const { w, h, px } = img; const rs = [], gs = [], bs = [];
  const s = (x, y) => { const i = (y * w + x) * 4; rs.push(px[i]); gs.push(px[i + 1]); bs.push(px[i + 2]); };
  for (let x = 0; x < w; x += 4) { s(x, 0); s(x, h - 1); }
  for (let y = 0; y < h; y += 4) { s(0, y); s(w - 1, y); }
  const m = a => a.sort((p, q) => p - q)[a.length >> 1];
  return [m(rs), m(gs), m(bs)];
}
function backgroundMask(img, bg, tol) {
  const { w, h, px } = img; const tol2 = tol * tol; const bgm = new Uint8Array(w * h); const stack = [];
  const push = (x, y) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const idx = y * w + x; if (bgm[idx]) return; if (dist2(px, idx * 4, bg) <= tol2) { bgm[idx] = 1; stack.push(idx); } };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) { const idx = stack.pop(); const x = idx % w, y = (idx / w) | 0; push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1); }
  const fr2 = (tol * 1.5) * (tol * 1.5); const add = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const idx = y * w + x; if (bgm[idx]) continue; if (dist2(px, idx * 4, bg) > fr2) continue; if ((x > 0 && bgm[idx - 1]) || (x < w - 1 && bgm[idx + 1]) || (y > 0 && bgm[idx - w]) || (y < h - 1 && bgm[idx + w])) add.push(idx); }
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
function findRowBands(img, bgm, nRows) {
  const { w, h } = img;
  const rowFg = new Array(h).fill(0);
  for (let y = 0; y < h; y++) { let c = 0; const base = y * w; for (let x = 0; x < w; x++) if (!bgm[base + x]) c++; rowFg[y] = c; }
  let bands = runs(rowFg, w * 0.015, Math.round(h * 0.012));
  if (!bands.length) throw new Error('no content bands');
  bands.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
  bands = bands.slice(0, nRows).sort((a, b) => a[0] - b[0]);
  return bands;
}
// pick how many frames each gap-separated blob holds so the counts sum to n
function allocateFrames(blobs, n) {
  const widths = blobs.map((r) => r[1] - r[0] + 1);
  const total = widths.reduce((a, b) => a + b, 0);
  for (let unit = Math.max(1, Math.floor((total / n) * 0.55)); unit <= total; unit++) {
    const counts = widths.map((wd) => Math.max(1, Math.round(wd / unit)));
    if (counts.reduce((a, b) => a + b, 0) === n) return counts;
  }
  return null;
}

// tight bbox of the dominant blob inside a column window
function bboxInWindow(img, bgm, band, wx0, wx1) {
  const { w } = img; const [by0, by1] = band; const bandH = by1 - by0 + 1;
  const sub = []; for (let x = wx0; x <= wx1; x++) { let c = 0; for (let y = by0; y <= by1; y++) if (!bgm[y * w + x]) c++; sub.push(c > bandH * 0.03 ? 1 : 0); }
  const r = runs(sub, 0, 3);
  const best = r.length ? r.reduce((m, c) => (c[1] - c[0] > m[1] - m[0] ? c : m)) : [0, wx1 - wx0];
  const cx0 = wx0 + best[0], cx1 = wx0 + best[1];
  let x0 = cx1, x1 = cx0, y0 = by1, y1 = by0;
  for (let y = by0; y <= by1; y++) { const base = y * w; for (let x = cx0; x <= cx1; x++) if (!bgm[base + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
  if (x1 < x0) { x0 = wx0; x1 = wx1; y0 = by0; y1 = by1; }
  return { x0, y0, x1, y1 };
}

function sliceRow(img, bgm, band, n) {
  const { w } = img; const [by0, by1] = band; const bandH = by1 - by0 + 1;
  const colFg = new Array(w).fill(0);
  for (let y = by0; y <= by1; y++) { const base = y * w; for (let x = 0; x < w; x++) if (!bgm[base + x]) colFg[x]++; }
  let minX = w, maxX = 0;
  for (let x = 0; x < w; x++) if (colFg[x] > bandH * 0.02) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
  // gap-separated blobs across the content extent
  const blobs = runs(colFg.map((c) => (c > bandH * 0.02 ? 1 : 0)), 0, Math.max(4, Math.round(w * 0.012)))
    .filter((r) => r[1] >= minX && r[0] <= maxX);
  const windows = [];
  if (blobs.length === n) {
    for (const b of blobs) windows.push([b[0], b[1]]);
  } else {
    const counts = blobs.length > 1 ? allocateFrames(blobs, n) : null;
    if (counts) {
      blobs.forEach((b, i) => { const span = (b[1] - b[0] + 1) / counts[i]; for (let k = 0; k < counts[i]; k++) windows.push([Math.round(b[0] + k * span), Math.round(b[0] + (k + 1) * span) - 1]); });
    } else {
      const span = (maxX - minX + 1) / n;
      for (let k = 0; k < n; k++) windows.push([Math.round(minX + k * span), Math.round(minX + (k + 1) * span) - 1]);
    }
  }
  return windows.map(([wx0, wx1]) => bboxInWindow(img, bgm, band, wx0, wx1));
}
// compose a clip's frames into uniform full-res transparent cells, feet to baseline
function composeCells(img, bgm, frames) {
  const { w, px } = img;
  const fw = Math.max(...frames.map(f => f.x1 - f.x0 + 1)) + PAD * 2;
  const fh = Math.max(...frames.map(f => f.y1 - f.y0 + 1)) + PAD * 2;
  return frames.map(f => {
    const cw = f.x1 - f.x0 + 1, chh = f.y1 - f.y0 + 1;
    const offX = Math.round((fw - cw) / 2), offY = fh - PAD - chh;
    const cell = Buffer.alloc(fw * fh * 4);
    for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++) {
      const si = (f.y0 + y) * w + (f.x0 + x); if (bgm[si]) continue;
      const s = si * 4, d = ((offY + y) * fw + (offX + x)) * 4;
      cell[d] = px[s]; cell[d + 1] = px[s + 1]; cell[d + 2] = px[s + 2]; cell[d + 3] = 255;
    }
    return { w: fw, h: fh, px: cell };
  });
}

// Detect the green photo area of a frame: returns its 4 corners (normalized
// 0..1 of the cell) and keys the green out so a photo can show through. Used
// only for the photo_frame clip. Returns null when there is no photo area.
function keyPhotoArea(cell, bg) {
  const { w, h, px } = cell;
  const green = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const idx = y * w + x; const i = idx * 4; if (px[i + 3] === 0) continue;
    const r = px[i], g = px[i + 1], b = px[i + 2];
    // true chroma-key green: g clearly dominant (grey/brown/cream fail this)
    if (g > 55 && g - r > 20 && g - b > 20) green[idx] = 1;
  }
  // largest connected green region = the photo area
  const seen = new Uint8Array(w * h);
  let best = null;
  for (let s = 0; s < w * h; s++) {
    if (!green[s] || seen[s]) continue;
    const stack = [s]; seen[s] = 1; const comp = [];
    while (stack.length) {
      const idx = stack.pop(); comp.push(idx);
      const x = idx % w, y = (idx / w) | 0;
      if (x > 0 && green[idx - 1] && !seen[idx - 1]) { seen[idx - 1] = 1; stack.push(idx - 1); }
      if (x < w - 1 && green[idx + 1] && !seen[idx + 1]) { seen[idx + 1] = 1; stack.push(idx + 1); }
      if (y > 0 && green[idx - w] && !seen[idx - w]) { seen[idx - w] = 1; stack.push(idx - w); }
      if (y < h - 1 && green[idx + w] && !seen[idx + w]) { seen[idx + w] = 1; stack.push(idx + w); }
    }
    if (!best || comp.length > best.length) best = comp;
  }
  // key out all green so no fringe remains
  for (let idx = 0; idx < w * h; idx++) if (green[idx]) { const i = idx * 4; px[i] = px[i + 1] = px[i + 2] = px[i + 3] = 0; }
  if (!best || best.length < w * h * 0.012) return null;
  let tlx = 0, tly = 0, trx = 0, try_ = 0, brx = 0, bry = 0, blx = 0, bly = 0;
  let tlS = Infinity, brS = -Infinity, trD = -Infinity, blD = Infinity;
  let minX = w, maxX = 0, minY = h, maxY = 0;
  for (const idx of best) {
    const x = idx % w, y = (idx / w) | 0;
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    const sum = x + y, diff = x - y;
    if (sum < tlS) { tlS = sum; tlx = x; tly = y; }
    if (sum > brS) { brS = sum; brx = x; bry = y; }
    if (diff > trD) { trD = diff; trx = x; try_ = y; }
    if (diff < blD) { blD = diff; blx = x; bly = y; }
  }
  const bboxArea = (maxX - minX + 1) * (maxY - minY + 1);
  if (best.length / bboxArea < 0.45) return null; // thin/scattered, not a solid quad
  return {
    tl: [tlx / w, tly / h], tr: [trx / w, try_ / h],
    br: [brx / w, bry / h], bl: [blx / w, bly / h]
  };
}

// ---------- pixelize ----------
function downsample(cell, targetH) {
  const scale = targetH / cell.h, tw = Math.max(1, Math.round(cell.w * scale)), th = targetH;
  const out = Buffer.alloc(tw * th * 4);
  for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
    const sx0 = Math.floor(tx / scale), sx1 = Math.max(sx0 + 1, Math.floor((tx + 1) / scale));
    const sy0 = Math.floor(ty / scale), sy1 = Math.max(sy0 + 1, Math.floor((ty + 1) / scale));
    let sr = 0, sg = 0, sb = 0, sa = 0, n = 0;
    for (let sy = sy0; sy < sy1 && sy < cell.h; sy++) for (let sx = sx0; sx < sx1 && sx < cell.w; sx++) {
      const i = (sy * cell.w + sx) * 4, a = cell.px[i + 3];
      sr += cell.px[i] * a; sg += cell.px[i + 1] * a; sb += cell.px[i + 2] * a; sa += a; n++;
    }
    const d = (ty * tw + tx) * 4;
    if (n === 0 || sa / n < ALPHA_CUT) { out[d] = out[d + 1] = out[d + 2] = out[d + 3] = 0; }
    else { out[d] = Math.round(sr / sa); out[d + 1] = Math.round(sg / sa); out[d + 2] = Math.round(sb / sa); out[d + 3] = 255; }
  }
  return { w: tw, h: th, px: out };
}
// median-cut palette from sampled opaque pixels
function buildPalette(samples, k) {
  let boxes = [samples];
  const channelRange = box => {
    const mn = [255, 255, 255], mx = [0, 0, 0];
    for (const p of box) for (let c = 0; c < 3; c++) { if (p[c] < mn[c]) mn[c] = p[c]; if (p[c] > mx[c]) mx[c] = p[c]; }
    return [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
  };
  while (boxes.length < k) {
    let bi = -1, bspan = -1, bch = 0;
    boxes.forEach((box, i) => { if (box.length < 2) return; const r = channelRange(box); const ch = r[0] >= r[1] && r[0] >= r[2] ? 0 : r[1] >= r[2] ? 1 : 2; if (r[ch] > bspan) { bspan = r[ch]; bi = i; bch = ch; } });
    if (bi < 0) break;
    const box = boxes[bi]; box.sort((a, b) => a[bch] - b[bch]);
    const mid = box.length >> 1; boxes.splice(bi, 1, box.slice(0, mid), box.slice(mid));
  }
  return boxes.filter(b => b.length).map(box => {
    let r = 0, g = 0, b = 0; for (const p of box) { r += p[0]; g += p[1]; b += p[2]; }
    return [Math.round(r / box.length), Math.round(g / box.length), Math.round(b / box.length)];
  });
}
function snap(palette, r, g, b) {
  let bi = 0, bd = Infinity;
  for (let i = 0; i < palette.length; i++) { const p = palette[i]; const dr = p[0] - r, dg = p[1] - g, db = p[2] - b; const d = dr * dr + dg * dg + db * db; if (d < bd) { bd = d; bi = i; } }
  return palette[bi];
}
function applyPalette(small, palette) {
  for (let i = 0; i < small.w * small.h; i++) { const d = i * 4; if (small.px[d + 3] === 0) continue; const c = snap(palette, small.px[d], small.px[d + 1], small.px[d + 2]); small.px[d] = c[0]; small.px[d + 1] = c[1]; small.px[d + 2] = c[2]; }
  return small;
}


// ---------- pass 1 + 2 driver ----------
function composeForClip(img, bgm, rowFrames, clip) {
  const rf = rowFrames[clip.row];
  if (!rf) throw new Error(`missing row ${clip.row} for ${clip.name}`);
  return composeCells(img, bgm, rf.slice(clip.from, clip.to + 1));
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const files = fs.readdirSync(SRC_DIR).filter(f => f.toLowerCase().endsWith('.png'));
  const order = Object.keys(SHEETS).filter(b => files.includes(b + '.png'));
  const missing = [];
  for (const b of Object.keys(SHEETS)) if (!files.includes(b + '.png')) missing.push(b);
  if (missing.length) console.warn('! no png for: ' + missing.join(', '));

  const clipCells = {};
  const samples = [];
  for (const base of order) {
    const cfg = SHEETS[base];
    const img = decodePng(fs.readFileSync(path.join(SRC_DIR, base + '.png')));
    const bg = medianBorder(img);
    const bgm = backgroundMask(img, bg, TOL);
    const bands = findRowBands(img, bgm, cfg.rows.length);
    if (bands.length < cfg.rows.length) console.warn(`! ${base}: wanted ${cfg.rows.length} rows, found ${bands.length}`);
    const rowFrames = bands.map((band, ri) => sliceRow(img, bgm, band, cfg.rows[ri]));
    for (const clip of cfg.clips) {
      const cells = composeForClip(img, bgm, rowFrames, clip);
      const quads = clip.name === 'photo_frame' ? cells.map((cell) => keyPhotoArea(cell, bg)) : null;
      clipCells[clip.name] = { cells, clip, base, quads };
      for (const cell of cells) for (let i = 0; i < cell.w * cell.h; i += 7) { const d = i * 4; if (cell.px[d + 3]) samples.push([cell.px[d], cell.px[d + 1], cell.px[d + 2]]); }
    }
  }
  let s = samples;
  if (s.length > 60000) { const step = Math.ceil(s.length / 60000); s = s.filter((_, i) => i % step === 0); }
  const palette = buildPalette(s, PALETTE_SIZE);

  const manifest = {};
  const report = [];
  for (const name of Object.keys(clipCells)) {
    const { cells, clip, quads } = clipCells[name];
    const smalls = cells.map(c => applyPalette(downsample(c, PIXEL_H), palette));
    const fw = Math.max(...smalls.map(c => c.w)), fh = PIXEL_H, n = smalls.length;
    const strip = Buffer.alloc(fw * n * fh * 4);
    const dir = path.join(OUT_DIR, name); fs.mkdirSync(dir, { recursive: true });
    smalls.forEach((c, fi) => {
      const ox = Math.round((fw - c.w) / 2);
      const single = Buffer.alloc(fw * fh * 4);
      for (let y = 0; y < fh; y++) for (let x = 0; x < c.w; x++) {
        const si = (y * c.w + x) * 4; if (!c.px[si + 3]) continue;
        const ds = (y * (fw * n) + (fi * fw + ox + x)) * 4;
        strip[ds] = c.px[si]; strip[ds + 1] = c.px[si + 1]; strip[ds + 2] = c.px[si + 2]; strip[ds + 3] = 255;
        const dd = (y * fw + (ox + x)) * 4;
        single[dd] = c.px[si]; single[dd + 1] = c.px[si + 1]; single[dd + 2] = c.px[si + 2]; single[dd + 3] = 255;
      }
      fs.writeFileSync(path.join(dir, `frame_${fi}.png`), encodePng(fw, fh, single));
    });
    fs.writeFileSync(path.join(OUT_DIR, name + '.png'), encodePng(fw * n, fh, strip));
    manifest[name] = { frames: n, frameWidth: fw, frameHeight: fh, fps: clip.fps, loop: clip.loop, strip: `frames/${name}.png` };
    if (quads) manifest[name].photoQuads = quads;
    report.push(`${name.padEnd(20)} ${n}f  ${fw}x${fh}  ${clip.loop}/${clip.fps}fps`);
  }
  fs.writeFileSync(path.join(SRC_DIR, 'animations.json'), JSON.stringify(manifest, null, 2));
  console.log(`Shared palette: ${palette.length} colours, target height ${PIXEL_H}px\n` + report.sort().join('\n'));
  console.log('\nManifest written to src/assets/animations/animations.json');
}

if (require.main === module) main();
