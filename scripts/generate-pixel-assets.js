const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ASSET_DIR = path.join(__dirname, '..', 'src', 'assets');
const FRAME = 48;

// Per-state frame counts. States can have different numbers of frames.
const STATE_FRAMES = {
  idle: 6, notice: 4, carry: 4, sweep: 4, buried: 4,
  celebrate: 6, sleep: 4, think: 4, bin: 4,
  walk: 6, peek: 4, pet: 4, yawn: 4, wave: 4
};
const STATES = Object.keys(STATE_FRAMES);
const MAX_FRAMES = Math.max(...Object.values(STATE_FRAMES));
const SHEET_WIDTH = FRAME * MAX_FRAMES;
const SHEET_HEIGHT = FRAME * STATES.length;

// Warm palette taken from the reference raccoon.
const C = {
  clear: [0, 0, 0, 0],
  ol: [58, 42, 48, 255],        // soft dark-brown outline
  furD: [92, 82, 108, 255],     // lavender-grey shadow
  fur: [124, 114, 142, 255],    // lavender-grey base
  furL: [156, 148, 172, 255],   // lavender-grey rim highlight
  mask: [46, 40, 54, 255],      // dark eye mask
  cream: [245, 233, 206, 255],  // chest, belly, muzzle
  creamD: [222, 205, 170, 255], // cream shadow
  peach: [228, 172, 150, 255],  // inner ear
  tan: [198, 152, 98, 255],     // tail light ring
  tanD: [150, 112, 70, 255],    // tail shade
  ringD: [74, 56, 48, 255],     // tail dark ring
  eye: [28, 24, 30, 255],       // pupil
  white: [252, 250, 244, 255],
  nose: [40, 32, 38, 255],
  tongue: [214, 82, 88, 255],
  sparkle: [248, 206, 96, 255],
  paper: [255, 248, 218, 255],
  soft: [130, 140, 152, 255]
};

// ---------- PNG encode ----------
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let v = i;
    for (let b = 0; b < 8; b += 1) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1;
    t[i] = v >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4);
  const crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function pngFromPixels(w, h, px) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y += 1) {
    const rs = y * (w * 4 + 1);
    raw[rs] = 0;
    for (let x = 0; x < w; x += 1) {
      const s = (y * w + x) * 4;
      const t = rs + 1 + x * 4;
      raw[t] = px[s]; raw[t + 1] = px[s + 1]; raw[t + 2] = px[s + 2]; raw[t + 3] = px[s + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function createCanvas(w, h) {
  return { width: w, height: h, pixels: Buffer.alloc(w * h * 4) };
}

function setPixel(cv, x, y, c) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= cv.width || y >= cv.height) return;
  const o = (y * cv.width + x) * 4;
  cv.pixels[o] = c[0]; cv.pixels[o + 1] = c[1]; cv.pixels[o + 2] = c[2]; cv.pixels[o + 3] = c[3];
}

function rect(cv, x, y, w, h, c) {
  for (let yy = 0; yy < h; yy += 1) for (let xx = 0; xx < w; xx += 1) setPixel(cv, x + xx, y + yy, c);
}

function clr(cv, x, y, w, h) { rect(cv, x, y, w, h, C.clear); }

function ellipse(cv, cx, cy, rx, ry, c) {
  for (let y = -ry; y <= ry; y += 1) {
    for (let x = -rx; x <= rx; x += 1) {
      if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1) setPixel(cv, cx + x, cy + y, c);
    }
  }
}

function ellipseOutline(cv, cx, cy, rx, ry, c) {
  for (let y = -ry - 1; y <= ry + 1; y += 1) {
    for (let x = -rx - 1; x <= rx + 1; x += 1) {
      const inside = (x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1;
      if (!inside) continue;
      const edge = ((x + 1) * (x + 1)) / (rx * rx) + (y * y) / (ry * ry) > 1 ||
        ((x - 1) * (x - 1)) / (rx * rx) + (y * y) / (ry * ry) > 1 ||
        (x * x) / (rx * rx) + ((y + 1) * (y + 1)) / (ry * ry) > 1 ||
        (x * x) / (rx * rx) + ((y - 1) * (y - 1)) / (ry * ry) > 1;
      if (edge) setPixel(cv, cx + x, cy + y, c);
    }
  }
}

// ---------- Raccoon ----------
// Front-facing sitting raccoon centered in a 48px cell at (ox, oy).
function drawRaccoon(cv, ox, oy, opts) {
  const o = Object.assign({
    bounce: 0, earPerk: 0, eye: 'open', mouth: 'neutral',
    arms: 'rest', tailWag: 0, blush: false, sparkles: false
  }, opts);
  const cx = ox + 24;
  const by = oy + 6 + o.bounce;

  // Tail (behind body) with rings
  const tx = ox + 9 + o.tailWag;
  const ty = by + 26;
  ellipseOutline(cv, tx, ty + 6, 6, 9, C.ol);
  ellipse(cv, tx, ty + 6, 5, 8, C.tan);
  rect(cv, tx - 5, ty + 1, 11, 3, C.ringD);
  rect(cv, tx - 5, ty + 8, 11, 3, C.ringD);
  rect(cv, tx - 4, ty + 12, 9, 3, C.tanD);

  // Body with cream belly
  ellipseOutline(cv, cx, by + 30, 14, 14, C.ol);
  ellipse(cv, cx, by + 30, 13, 13, C.fur);
  ellipse(cv, cx, by + 33, 9, 11, C.cream);
  ellipse(cv, cx, by + 30, 9, 9, C.cream);
  for (let y = -13; y <= 13; y += 1) for (let x = -13; x <= -6; x += 1) {
    if ((x * x) / 169 + (y * y) / 169 <= 1) setPixel(cv, cx + x, by + 30 + y, C.furD);
  }
  rect(cv, cx - 6, by + 22, 12, 2, C.creamD);

  // Feet
  ellipse(cv, cx - 8, by + 42, 4, 3, C.cream);
  ellipse(cv, cx + 8, by + 42, 4, 3, C.cream);
  ellipseOutline(cv, cx - 8, by + 42, 4, 3, C.ol);
  ellipseOutline(cv, cx + 8, by + 42, 4, 3, C.ol);

  // Arms
  if (o.arms === 'up' || o.arms === 'wave') {
    const lift = o.arms === 'wave' ? 6 : 0;
    ellipse(cv, cx - 12, by + 17 - lift, 3, 4, C.fur);
    ellipseOutline(cv, cx - 12, by + 17 - lift, 3, 4, C.ol);
    rect(cv, cx - 13, by + 19 - lift, 3, 1, C.furD);
    ellipse(cv, cx + 12, by + 17, 3, 4, C.fur);
    ellipseOutline(cv, cx + 12, by + 17, 3, 4, C.ol);
    rect(cv, cx + 11, by + 19, 3, 1, C.furD);
  } else if (o.arms === 'carry') {
    ellipse(cv, cx - 9, by + 28, 3, 4, C.fur);
    ellipse(cv, cx + 9, by + 28, 3, 4, C.fur);
    rect(cv, cx - 4, by + 24, 8, 9, C.ol);
    rect(cv, cx - 3, by + 25, 6, 7, C.paper);
  } else {
    ellipse(cv, cx - 11, by + 30, 3, 5, C.fur);
    ellipse(cv, cx + 11, by + 30, 3, 5, C.fur);
    ellipseOutline(cv, cx - 11, by + 30, 3, 5, C.ol);
    ellipseOutline(cv, cx + 11, by + 30, 3, 5, C.ol);
  }

  // Ears
  const ep = o.earPerk;
  rect(cv, cx - 16, by + 0 - ep, 9, 9, C.ol);
  rect(cv, cx - 15, by + 1 - ep, 7, 7, C.fur);
  rect(cv, cx - 13, by + 3 - ep, 4, 5, C.peach);
  rect(cv, cx + 7, by + 0 - ep, 9, 9, C.ol);
  rect(cv, cx + 8, by + 1 - ep, 7, 7, C.fur);
  rect(cv, cx + 9, by + 3 - ep, 4, 5, C.peach);
  clr(cv, cx - 16, by + 0 - ep, 2, 2); clr(cv, cx - 9, by + 0 - ep, 2, 2);
  clr(cv, cx + 7, by + 0 - ep, 2, 2); clr(cv, cx + 14, by + 0 - ep, 2, 2);

  // Head
  ellipseOutline(cv, cx, by + 12, 15, 12, C.ol);
  ellipse(cv, cx, by + 12, 14, 11, C.fur);
  rect(cv, cx - 8, by + 2, 16, 2, C.furL);
  ellipse(cv, cx, by + 9, 3, 6, C.cream);
  ellipse(cv, cx, by + 18, 8, 6, C.cream);

  // Mask
  ellipse(cv, cx - 7, by + 12, 5, 5, C.mask);
  ellipse(cv, cx + 7, by + 12, 5, 5, C.mask);
  rect(cv, cx - 3, by + 8, 6, 3, C.mask);

  // Eyes
  if (o.eye === 'closed') {
    rect(cv, cx - 9, by + 12, 5, 1, C.white);
    setPixel(cv, cx - 10, by + 13, C.white); setPixel(cv, cx - 4, by + 13, C.white);
    rect(cv, cx + 5, by + 12, 5, 1, C.white);
    setPixel(cv, cx + 4, by + 13, C.white); setPixel(cv, cx + 10, by + 13, C.white);
  } else if (o.eye === 'blink') {
    rect(cv, cx - 9, by + 13, 4, 1, C.white);
    rect(cv, cx + 5, by + 13, 4, 1, C.white);
  } else {
    ellipse(cv, cx - 7, by + 12, 2, 3, C.white);
    ellipse(cv, cx + 7, by + 12, 2, 3, C.white);
    setPixel(cv, cx - 7, by + 12, C.eye); setPixel(cv, cx - 7, by + 13, C.eye);
    setPixel(cv, cx + 7, by + 12, C.eye); setPixel(cv, cx + 7, by + 13, C.eye);
  }

  // Nose and mouth
  rect(cv, cx - 1, by + 16, 3, 2, C.nose);
  if (o.mouth === 'open') {
    rect(cv, cx - 2, by + 19, 5, 3, C.ol);
    rect(cv, cx - 1, by + 20, 3, 2, C.tongue);
  } else if (o.mouth === 'smile') {
    setPixel(cv, cx - 2, by + 19, C.ol);
    rect(cv, cx - 1, by + 20, 3, 1, C.ol);
    setPixel(cv, cx + 2, by + 19, C.ol);
  }

  if (o.blush) {
    setPixel(cv, cx - 11, by + 15, C.peach); setPixel(cv, cx - 10, by + 15, C.peach);
    setPixel(cv, cx + 10, by + 15, C.peach); setPixel(cv, cx + 11, by + 15, C.peach);
  }
  if (o.sparkles) {
    rect(cv, ox + 4, by + 2, 1, 5, C.sparkle); rect(cv, ox + 2, by + 4, 5, 1, C.sparkle);
    rect(cv, ox + 42, by + 4, 1, 5, C.sparkle); rect(cv, ox + 40, by + 6, 5, 1, C.sparkle);
  }
}

function optsFor(state, f) {
  const wag = f % 2 === 0 ? 0 : 1;
  switch (state) {
    case 'idle':
      return { bounce: [0, 0, 1, 1, 0, 0][f], eye: f === 3 ? 'blink' : 'open', mouth: 'smile', tailWag: wag };
    case 'notice':
      return { bounce: [0, -2, 0, -1][f], earPerk: 2, eye: 'open', mouth: 'open', tailWag: wag, sparkles: f % 2 === 1 };
    case 'carry':
      return { bounce: [0, 1, 0, 1][f], arms: 'carry', eye: 'open', mouth: 'smile', tailWag: wag };
    case 'sweep':
      return { bounce: [0, 1, 0, 1][f], arms: 'rest', eye: 'open', mouth: 'smile', tailWag: wag };
    case 'buried':
      return { bounce: [2, 2, 3, 2][f], eye: 'blink', mouth: 'neutral' };
    case 'celebrate':
      return { bounce: [0, -3, -1, -4, -1, -3][f], arms: 'up', eye: 'closed', mouth: 'open', blush: true, sparkles: true, tailWag: wag };
    case 'sleep':
      return { bounce: [2, 2, 3, 2][f], eye: 'closed', mouth: 'neutral' };
    case 'think':
      return { bounce: [0, 1, 0, 1][f], earPerk: 1, eye: 'open', mouth: 'neutral', tailWag: wag };
    case 'bin':
      return { bounce: [0, 1, 0, 1][f], arms: 'carry', eye: 'open', mouth: 'smile' };
    case 'walk':
      return { bounce: [0, 1, 2, 1, 0, 1][f], eye: 'open', mouth: 'smile', tailWag: f % 2 };
    case 'peek':
      return { bounce: [0, 1, 0, 1][f], earPerk: 2, eye: 'open', mouth: 'neutral', tailWag: wag };
    case 'pet':
      return { bounce: [0, -1, 0, -1][f], eye: 'closed', mouth: 'open', blush: true, tailWag: wag };
    case 'yawn':
      return { bounce: [0, 1, 1, 0][f], eye: ['open', 'blink', 'closed', 'closed'][f], mouth: 'open' };
    case 'wave':
      return { bounce: [0, -1, 0, -1][f], arms: 'wave', eye: 'open', mouth: 'open', tailWag: wag };
    default:
      return { bounce: 0 };
  }
}

function extras(cv, ox, oy, state, f) {
  if (state === 'sleep') {
    const yy = oy + 4 - f;
    rect(cv, ox + 34, yy, 4, 1, C.soft);
    setPixel(cv, ox + 36, yy + 1, C.soft);
    rect(cv, ox + 34, yy + 2, 4, 1, C.soft);
  }
  if (state === 'think') {
    rect(cv, ox + 38, oy + 6, 3, 3, C.ol);
    rect(cv, ox + 39, oy + 7, 1, 1, C.paper);
  }
  if (state === 'bin') {
    const lid = f % 2 === 0 ? 0 : -1;
    rect(cv, ox + 30, oy + 24 + lid, 14, 3, C.ol);
    rect(cv, ox + 31, oy + 27, 12, 14, C.ol);
    rect(cv, ox + 33, oy + 28, 8, 12, C.soft);
  }
}

function generateSpriteSheet() {
  const cv = createCanvas(SHEET_WIDTH, SHEET_HEIGHT);
  STATES.forEach((state, row) => {
    for (let f = 0; f < STATE_FRAMES[state]; f += 1) {
      const ox = f * FRAME;
      const oy = row * FRAME;
      drawRaccoon(cv, ox, oy, optsFor(state, f));
      extras(cv, ox, oy, state, f);
    }
  });
  fs.writeFileSync(path.join(ASSET_DIR, 'raccoon-sprite.png'), pngFromPixels(cv.width, cv.height, cv.pixels));
}

function generateTrayIcon() {
  // Render the idle face into 48px, then nearest-neighbor downscale to 32px.
  const big = createCanvas(FRAME, FRAME);
  drawRaccoon(big, 0, 0, { eye: 'open', mouth: 'smile' });
  const out = createCanvas(32, 32);
  for (let y = 0; y < 32; y += 1) {
    for (let x = 0; x < 32; x += 1) {
      const sx = Math.floor((x / 32) * FRAME);
      const sy = Math.floor((y / 32) * FRAME);
      const s = (sy * FRAME + sx) * 4;
      const t = (y * 32 + x) * 4;
      out.pixels[t] = big.pixels[s];
      out.pixels[t + 1] = big.pixels[s + 1];
      out.pixels[t + 2] = big.pixels[s + 2];
      out.pixels[t + 3] = big.pixels[s + 3];
    }
  }
  fs.writeFileSync(path.join(ASSET_DIR, 'tray-raccoon.png'), pngFromPixels(out.width, out.height, out.pixels));
}

// Layout metadata other modules rely on, written next to the assets so the
// renderer CSS and JS can stay in sync with the generator.
function writeManifest() {
  const rows = {};
  STATES.forEach((s, i) => { rows[s] = { row: i, frames: STATE_FRAMES[s] }; });
  fs.writeFileSync(
    path.join(ASSET_DIR, 'sprite-manifest.json'),
    JSON.stringify({ frame: FRAME, scale: 3, sheetWidth: SHEET_WIDTH, sheetHeight: SHEET_HEIGHT, maxFrames: MAX_FRAMES, states: rows }, null, 2)
  );
}

fs.mkdirSync(ASSET_DIR, { recursive: true });
generateSpriteSheet();
generateTrayIcon();
writeManifest();
console.log(`Generated pixel raccoon assets (${SHEET_WIDTH}x${SHEET_HEIGHT}, ${STATES.length} states).`);
