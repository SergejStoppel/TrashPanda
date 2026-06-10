const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ASSET_DIR = path.join(__dirname, '..', 'src', 'assets');
const FRAME = 48;
const STATES = ['idle', 'notice', 'carry', 'sweep', 'buried', 'celebrate', 'sleep', 'think', 'bin'];
const FRAMES_PER_STATE = 4;
const SHEET_WIDTH = FRAME * FRAMES_PER_STATE;
const SHEET_HEIGHT = FRAME * STATES.length;

const COLORS = {
  clear: [0, 0, 0, 0],
  outline: [18, 19, 22, 255],
  fur: [39, 42, 48, 255],
  fur2: [54, 59, 67, 255],
  mask: [9, 10, 12, 255],
  eye: [255, 253, 238, 255],
  paper: [255, 248, 218, 255],
  paperEdge: [226, 198, 113, 255],
  broom: [142, 91, 43, 255],
  bristle: [231, 177, 74, 255],
  sparkle: [246, 205, 78, 255],
  soft: [126, 137, 149, 255]
};

const crcTable = (() => {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  const crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function pngFromPixels(width, height, pixels) {
  const raw = Buffer.alloc((width * 4 + 1) * height);

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;

    for (let x = 0; x < width; x += 1) {
      const source = (y * width + x) * 4;
      const target = rowStart + 1 + x * 4;
      raw[target] = pixels[source];
      raw[target + 1] = pixels[source + 1];
      raw[target + 2] = pixels[source + 2];
      raw[target + 3] = pixels[source + 3];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function createCanvas(width, height) {
  return {
    width,
    height,
    pixels: Buffer.alloc(width * height * 4)
  };
}

function setPixel(canvas, x, y, color) {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) {
    return;
  }

  const offset = (y * canvas.width + x) * 4;
  canvas.pixels[offset] = color[0];
  canvas.pixels[offset + 1] = color[1];
  canvas.pixels[offset + 2] = color[2];
  canvas.pixels[offset + 3] = color[3];
}

function rect(canvas, x, y, width, height, color) {
  for (let yy = y; yy < y + height; yy += 1) {
    for (let xx = x; xx < x + width; xx += 1) {
      setPixel(canvas, xx, yy, color);
    }
  }
}

function clearRect(canvas, x, y, width, height) {
  rect(canvas, x, y, width, height, COLORS.clear);
}

function drawPattern(canvas, originX, originY, rows, palette) {
  rows.forEach((row, y) => {
    [...row].forEach((key, x) => {
      if (key !== '.' && palette[key]) {
        setPixel(canvas, originX + x, originY + y, palette[key]);
      }
    });
  });
}

function drawPaper(canvas, x, y, tilt = 0) {
  rect(canvas, x, y, 9, 12, COLORS.outline);
  rect(canvas, x + 1, y + 1, 7, 10, COLORS.paper);
  rect(canvas, x + 1, y + 8, 7, 2, COLORS.paperEdge);

  if (tilt > 0) {
    setPixel(canvas, x + 8, y, COLORS.clear);
    setPixel(canvas, x + 8, y + 1, COLORS.clear);
  }
}

function drawBroom(canvas, x, y, frame) {
  const sweep = frame % 2 === 0 ? 0 : 2;
  rect(canvas, x + sweep, y, 18, 2, COLORS.broom);
  rect(canvas, x + 16 + sweep, y - 3, 7, 8, COLORS.outline);
  rect(canvas, x + 17 + sweep, y - 2, 5, 6, COLORS.bristle);
  rect(canvas, x + 18 + sweep, y + 2, 4, 1, COLORS.outline);
}

function drawTrashBin(canvas, x, y, frame) {
  const lidLift = frame % 2 === 0 ? 0 : -1;
  rect(canvas, x + 1, y + lidLift, 26, 4, COLORS.outline);
  rect(canvas, x + 3, y + lidLift + 1, 22, 2, COLORS.soft);
  rect(canvas, x + 4, y + 5, 20, 19, COLORS.outline);
  rect(canvas, x + 6, y + 6, 16, 17, COLORS.soft);
  rect(canvas, x + 9, y + 8, 2, 13, COLORS.outline);
  rect(canvas, x + 16, y + 8, 2, 13, COLORS.outline);
  clearRect(canvas, x + 4, y + 5, 2, 2);
  clearRect(canvas, x + 22, y + 5, 2, 2);
}

function drawZ(canvas, x, y, size = 1) {
  rect(canvas, x, y, 5 * size, size, COLORS.soft);
  rect(canvas, x + 3 * size, y + size, size, size, COLORS.soft);
  rect(canvas, x + 2 * size, y + 2 * size, size, size, COLORS.soft);
  rect(canvas, x, y + 3 * size, 5 * size, size, COLORS.soft);
}

function drawSparkle(canvas, x, y) {
  rect(canvas, x + 1, y, 1, 5, COLORS.sparkle);
  rect(canvas, x, y + 2, 3, 1, COLORS.sparkle);
}

function drawRaccoon(canvas, offsetX, offsetY, state, frame) {
  const bounce = {
    idle: [0, 1, 0, 0],
    notice: [2, -2, 0, -1],
    carry: [0, 1, 0, 1],
    sweep: [0, 1, 0, 1],
    buried: [3, 3, 2, 3],
    celebrate: [0, -4, 0, -3],
    sleep: [3, 3, 4, 3],
    think: [0, 1, 0, 1],
    bin: [1, 2, 1, 2]
  }[state][frame];
  const baseX = offsetX + 4 + (state === 'carry' && frame % 2 === 1 ? 1 : 0);
  const baseY = offsetY + 5 + bounce;
  const blink = (state === 'idle' && frame === 2) || state === 'sleep';
  const perk = state === 'notice' || state === 'think';
  const tailWag = frame % 2 === 0 ? 0 : 1;

  if (state === 'buried') {
    drawPaper(canvas, offsetX + 5, offsetY + 33, 1);
    drawPaper(canvas, offsetX + 16, offsetY + 36, 0);
    drawPaper(canvas, offsetX + 29, offsetY + 34, 1);
  }

  rect(canvas, baseX + 30 + tailWag, baseY + 22, 9, 17, COLORS.outline);
  rect(canvas, baseX + 31 + tailWag, baseY + 23, 7, 15, COLORS.soft);
  rect(canvas, baseX + 31 + tailWag, baseY + 26, 7, 3, COLORS.outline);
  rect(canvas, baseX + 31 + tailWag, baseY + 33, 7, 3, COLORS.outline);

  rect(canvas, baseX + 11, baseY + 22, 22, 18, COLORS.outline);
  clearRect(canvas, baseX + 11, baseY + 22, 4, 3);
  clearRect(canvas, baseX + 29, baseY + 22, 4, 3);
  clearRect(canvas, baseX + 11, baseY + 37, 3, 3);
  clearRect(canvas, baseX + 30, baseY + 37, 3, 3);
  rect(canvas, baseX + 13, baseY + 23, 18, 16, COLORS.fur);
  clearRect(canvas, baseX + 13, baseY + 23, 2, 2);
  clearRect(canvas, baseX + 29, baseY + 23, 2, 2);
  rect(canvas, baseX + 18, baseY + 28, 8, 8, COLORS.fur2);
  rect(canvas, baseX + 13, baseY + 38, 6, 3, COLORS.mask);
  rect(canvas, baseX + 25, baseY + 38, 6, 3, COLORS.mask);

  rect(canvas, baseX + 9, baseY + (perk ? 2 : 5), 8, 9, COLORS.outline);
  rect(canvas, baseX + 28, baseY + (perk ? 2 : 5), 8, 9, COLORS.outline);
  clearRect(canvas, baseX + 9, baseY + (perk ? 2 : 5), 2, 2);
  clearRect(canvas, baseX + 34, baseY + (perk ? 2 : 5), 2, 2);
  rect(canvas, baseX + 11, baseY + (perk ? 4 : 7), 4, 4, COLORS.fur);
  rect(canvas, baseX + 30, baseY + (perk ? 4 : 7), 4, 4, COLORS.fur);

  rect(canvas, baseX + 8, baseY + 9, 28, 20, COLORS.outline);
  clearRect(canvas, baseX + 8, baseY + 9, 5, 3);
  clearRect(canvas, baseX + 31, baseY + 9, 5, 3);
  clearRect(canvas, baseX + 8, baseY + 26, 4, 3);
  clearRect(canvas, baseX + 32, baseY + 26, 4, 3);
  rect(canvas, baseX + 10, baseY + 11, 24, 16, COLORS.fur);
  clearRect(canvas, baseX + 10, baseY + 11, 3, 2);
  clearRect(canvas, baseX + 31, baseY + 11, 3, 2);
  rect(canvas, baseX + 11, baseY + 16, 22, 7, COLORS.mask);

  if (blink) {
    rect(canvas, baseX + 15, baseY + 19, 5, 1, COLORS.eye);
    rect(canvas, baseX + 25, baseY + 19, 5, 1, COLORS.eye);
  } else {
    rect(canvas, baseX + 15, baseY + 17, 5, 6, COLORS.eye);
    rect(canvas, baseX + 25, baseY + 17, 5, 6, COLORS.eye);
  }

  rect(canvas, baseX + 21, baseY + 24, 4, 2, COLORS.mask);

  if (state === 'carry') {
    drawPaper(canvas, baseX + 5 + frame, baseY + 24, 0);
    rect(canvas, baseX + 11, baseY + 29, 6, 2, COLORS.outline);
  }

  if (state === 'sweep') {
    drawBroom(canvas, baseX + 15, baseY + 33, frame);
  }

  if (state === 'notice') {
    rect(canvas, baseX + 37, baseY + 6, 2, 8, COLORS.sparkle);
    rect(canvas, baseX + 37, baseY + 16, 2, 2, COLORS.sparkle);
  }

  if (state === 'celebrate') {
    drawSparkle(canvas, baseX + 4, baseY + 9);
    drawSparkle(canvas, baseX + 38, baseY + 7);
  }

  if (state === 'sleep') {
    drawZ(canvas, baseX + 33, baseY + 6 - frame, 1);
  }

  if (state === 'think') {
    drawPattern(canvas, baseX + 35, baseY + 6, ['oo', 'oo'], { o: COLORS.paper });
    rect(canvas, baseX + 35, baseY + 6, 2, 2, COLORS.outline);
  }

  if (state === 'bin') {
    drawTrashBin(canvas, offsetX + 10, offsetY + 28, frame);
  }

  if (state === 'buried') {
    drawPaper(canvas, offsetX + 9, offsetY + 27, 0);
    drawPaper(canvas, offsetX + 23, offsetY + 29, 1);
  }
}

function generateSpriteSheet() {
  const canvas = createCanvas(SHEET_WIDTH, SHEET_HEIGHT);

  STATES.forEach((state, row) => {
    for (let frame = 0; frame < FRAMES_PER_STATE; frame += 1) {
      drawRaccoon(canvas, frame * FRAME, row * FRAME, state, frame);
    }
  });

  fs.writeFileSync(path.join(ASSET_DIR, 'raccoon-sprite.png'), pngFromPixels(canvas.width, canvas.height, canvas.pixels));
}

function generateTrayIcon() {
  const canvas = createCanvas(32, 32);
  drawRaccoon(canvas, -7, -7, 'idle', 0);
  rect(canvas, 12, 15, 1, 2, COLORS.mask);
  rect(canvas, 22, 15, 1, 2, COLORS.mask);
  fs.writeFileSync(path.join(ASSET_DIR, 'tray-raccoon.png'), pngFromPixels(canvas.width, canvas.height, canvas.pixels));
}

fs.mkdirSync(ASSET_DIR, { recursive: true });
generateSpriteSheet();
generateTrayIcon();
console.log('Generated pixel raccoon assets.');
