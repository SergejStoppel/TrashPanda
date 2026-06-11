const button = document.getElementById('raccoonButton');
const bubble = document.getElementById('bubble');
const sprite = document.getElementById('sprite');
const photoFrame = document.getElementById('photoFrame');
const photoImg = document.getElementById('photoImg');
const photoWarp = document.getElementById('photoWarp');
const photoWarpImg = document.getElementById('photoWarpImg');

const DISPLAY_H = 124;
const WIN_W = 160;
const WIN_H = 220;
const SPRITE_BOTTOM = 14;       // matches .sprite bottom in companion.css
const SCALE = { drag_hold_loop: 1.5, drag_release: 1.5, photo_frame: 1.6 };  // hanging, falling, and photo-showing take more space
const ASSET_BASE = './assets/animations/';
// idle-time activities cycled at random while the raccoon is resting
const AMBIENT = ['yawn', 'read_book', 'drink_tea', 'eat_cookie', 'groom', 'look_around', 'stretch'];
const INACTIVITY_MS = 45000;   // doze off after this long with no activity
const HOLD_MS = 320;           // press-and-hold longer than this = petting
const DRAG_THRESH = 5;         // px of movement that counts as a drag
const WORK_STATES = ['analyzing', 'analyze', 'sort', 'sorting', 'working'];
const DISCOVER_STATES = ['notice', 'discovery', 'found'];
const SORT_GROUP = ['enterSort', 'sort', 'exitSort'];
const TRANSIENT = ['greet', 'react', 'pet', 'drag', 'release', 'discovery', 'enterSleep', 'sleep', 'exitSleep', 'enterSort', 'sort', 'exitSort'];

let manifest = {};
let base = 'idle_breathe';
let current = null;
let behavior = 'idle';

let frameTimer = null;
let ambientTimer = null;
let inactivityTimer = null;
let holdTimer = null;
let sortTimer = null;
let bubbleTimer = null;
let photoTimer = null;
let photoActive = false;

let pointerActive = false;
let pointerMoved = false;
let startPoint = null;

// ---------- core clip player ----------
function stopFrameTimer() {
  if (frameTimer) { clearTimeout(frameTimer); frameTimer = null; }
}

function play(name, options = {}) {
  const anim = manifest[name];
  if (!anim) { if (name !== base && manifest[base]) play(base, options); return; }
  current = name;
  stopFrameTimer();
  if (name !== 'photo_frame' && photoActive) { photoActive = false; photoWarp.style.display = 'none'; }

  const dispH = Math.round(DISPLAY_H * (SCALE[name] || 1));
  const scale = dispH / anim.frameHeight;
  const cellW = Math.round(anim.frameWidth * scale);
  sprite.style.width = `${cellW}px`;
  sprite.style.height = `${dispH}px`;
  sprite.style.backgroundImage = `url("${ASSET_BASE}${anim.strip}")`;
  sprite.style.backgroundSize = `${cellW * anim.frames}px ${dispH}px`;

  const loop = options.loopOverride || anim.loop;
  let index = 0;
  let dir = 1;
  const render = () => { sprite.style.backgroundPositionX = `-${index * cellW}px`; if (options.onFrame) options.onFrame(index); };
  render();

  if (anim.frames <= 1) { if (loop === 'once' && options.onEnd) options.onEnd(); return; }

  const baseDelay = Math.max(60, Math.round(1000 / (anim.fps || 4)));
  let held = false;
  const tick = () => {
    if (loop === 'pingpong') {
      if (index + dir < 0 || index + dir >= anim.frames) dir *= -1;
      index += dir;
      render();
      frameTimer = setTimeout(tick, baseDelay);
    } else if (loop === 'once') {
      if (index >= anim.frames - 1) { frameTimer = null; if (options.onEnd) options.onEnd(); return; }
      index += 1;
      render();
      let delay = baseDelay;
      // optionally linger on one frame (e.g. hold the photo up long enough to see)
      if (!held && options.holdFrame != null && index === options.holdFrame) { held = true; delay = options.holdMs || baseDelay; }
      frameTimer = setTimeout(tick, delay);
    } else {
      index = (index + 1) % anim.frames;
      render();
      frameTimer = setTimeout(tick, baseDelay);
    }
  };
  frameTimer = setTimeout(tick, baseDelay);
}

// ---------- idle + ambient ----------
function enterIdle() {
  behavior = 'idle';
  play(base);
  scheduleAmbient();
  resetInactivity();
}

function scheduleAmbient() {
  clearTimeout(ambientTimer);
  ambientTimer = setTimeout(() => {
    if (behavior !== 'idle') return;
    const pool = AMBIENT.filter((n) => manifest[n]);
    if (!pool.length) { scheduleAmbient(); return; }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    const anim = manifest[pick];
    behavior = 'ambient';
    if (anim.loop === 'once') {
      play(pick, { onEnd: () => { if (behavior === 'ambient') enterIdle(); } });
    } else {
      play(pick);
      const dwell = Math.max(3500, (anim.frames / (anim.fps || 4)) * 1000 * 2.5);
      clearTimeout(ambientTimer);
      ambientTimer = setTimeout(() => { if (behavior === 'ambient') enterIdle(); }, dwell);
    }
  }, 9000 + Math.random() * 9000);
}

// ---------- one-shot reactions ----------
function greet() {
  if (!manifest.greet_wave) { enterIdle(); return; }
  behavior = 'greet';
  play('greet_wave', { onEnd: enterIdle });
}

function reactClick() {
  resetInactivity();
  if (!manifest.click_react) { enterIdle(); return; }
  behavior = 'react';
  play('click_react', { onEnd: enterIdle });
}

function discovery() {
  resetInactivity();
  if (!manifest.present_discovery) { enterIdle(); return; }
  behavior = 'discovery';
  play('present_discovery', { onEnd: enterIdle });
}

// ---------- petting + dragging ----------
function startPet() {
  resetInactivity();
  if (!manifest.pet) return;
  behavior = 'pet';
  play('pet');
}

function startDragAnim() {
  resetInactivity();
  behavior = 'drag';
  if (!manifest.drag_hold_loop) return;
  play('drag_hold_loop');
  // hang from the cursor at the scruff/hand near the top-centre of the dangling sprite
  const dispH = Math.round(DISPLAY_H * (SCALE.drag_hold_loop || 1));
  const spriteTop = WIN_H - SPRITE_BOTTOM - dispH;
  const anchorX = Math.round(WIN_W / 2);
  const anchorY = Math.max(6, spriteTop + Math.round(dispH * 0.12));
  window.raccoon.dragHang({ x: anchorX, y: anchorY });
}

function endDragAnim() {
  if (manifest.drag_release) { behavior = 'release'; play('drag_release', { onEnd: enterIdle }); }
  else enterIdle();
}

// ---------- self-timed sort sequence ----------
function enterSort() {
  resetInactivity();
  clearTimeout(sortTimer);
  if (!manifest.sort_organize) { enterIdle(); return; }
  const loopThenExit = () => {
    behavior = 'sort';
    play('sort_organize');
    const anim = manifest.sort_organize;
    const dwell = Math.max(2600, (anim.frames / (anim.fps || 4)) * 1000 * 2);
    clearTimeout(sortTimer);
    sortTimer = setTimeout(() => { if (behavior === 'sort') exitSort(); }, dwell);
  };
  behavior = 'enterSort';
  if (manifest.idle_to_sort) play('idle_to_sort', { onEnd: loopThenExit });
  else loopThenExit();
}

function exitSort() {
  clearTimeout(sortTimer);
  if (manifest.sort_to_idle) { behavior = 'exitSort'; play('sort_to_idle', { onEnd: enterIdle }); }
  else enterIdle();
}

// ---------- sleep ----------
function enterSleep() {
  if (behavior !== 'idle' && behavior !== 'ambient') return;
  if (!manifest.idle_to_sleep) return;
  clearTimeout(ambientTimer);
  clearTimeout(inactivityTimer);
  behavior = 'enterSleep';
  play('idle_to_sleep', { onEnd: () => { behavior = 'sleep'; } });
}

function wake() {
  if (behavior !== 'sleep' && behavior !== 'enterSleep') return;
  if (manifest.sleep_to_idle) { behavior = 'exitSleep'; play('sleep_to_idle', { onEnd: enterIdle }); }
  else enterIdle();
}

// ---------- inactivity ----------
function resetInactivity() {
  clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(enterSleep, INACTIVITY_MS);
}

// ---------- bubble ----------
function showBubble(message) {
  if (!message) return;
  bubble.textContent = message;
  bubble.classList.remove('is-hidden');
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => bubble.classList.add('is-hidden'), 5200);
}

// ---------- manifest load ----------
function applyManifest(data) {
  manifest = data || {};
  base = manifest.idle_breathe ? 'idle_breathe' : Object.keys(manifest)[0];
  if (!base) return;
  greet();
}

// ---------- signals from main ----------
window.raccoon.onCompanionUpdate((payload) => {
  if ((behavior === 'sleep' || behavior === 'enterSleep') && payload.visualState !== 'sleep') wake();
  resetInactivity();
  if (payload.bubble) showBubble(payload.bubble);

  const vs = payload.visualState;
  if (!vs) return;

  if (WORK_STATES.includes(vs)) {
    if (!SORT_GROUP.includes(behavior)) enterSort();
  } else if (DISCOVER_STATES.includes(vs)) {
    if (behavior !== 'discovery') discovery();
  } else if (vs === 'sleep') {
    enterSleep();
  } else if (vs === 'celebrate') {
    behavior = 'greet';
    play(manifest.greet_wave ? 'greet_wave' : base, { onEnd: enterIdle });
  }
  // any other (idle/think/carry/sweep/buried): just a mood + bubble, no interruption
});

// ---------- pointer gestures ----------
button.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  if (behavior === 'sleep' || behavior === 'enterSleep') wake();
  resetInactivity();
  pointerActive = true;
  pointerMoved = false;
  startPoint = { x: event.screenX, y: event.screenY };
  button.setPointerCapture(event.pointerId);
  window.raccoon.startDrag({ screenX: event.screenX, screenY: event.screenY });
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => { if (pointerActive && !pointerMoved) startPet(); }, HOLD_MS);
});

button.addEventListener('pointermove', (event) => {
  if (!pointerActive || !startPoint) return;
  if (!pointerMoved && Math.hypot(event.screenX - startPoint.x, event.screenY - startPoint.y) > DRAG_THRESH) {
    pointerMoved = true;
    clearTimeout(holdTimer);
    if (behavior !== 'drag') startDragAnim();
  }
  if (pointerMoved) window.raccoon.dragMove({ screenX: event.screenX, screenY: event.screenY });
});

button.addEventListener('pointerup', (event) => {
  if (!pointerActive) return;
  pointerActive = false;
  clearTimeout(holdTimer);
  window.raccoon.endDrag();
  if (behavior === 'drag') endDragAnim();
  else if (behavior === 'pet') enterIdle();
  else reactClick();
  try { button.releasePointerCapture(event.pointerId); } catch { /* already released */ }
});

button.addEventListener('dblclick', () => window.raccoon.openPanel());
window.addEventListener('contextmenu', (event) => { event.preventDefault(); window.raccoon.showContextMenu(); });

// The raccoon intentionally stays still and does not follow the cursor.

// ---------- perspective photo tracked into the frame ----------
function projAdj(m) { return [m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4], m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5], m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3]]; }
function projMul(a, b) { const c = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { let s = 0; for (let k = 0; k < 3; k++) s += a[3 * i + k] * b[3 * k + j]; c[3 * i + j] = s; } return c; }
function projMulV(m, v) { return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]]; }
function projBasis(x1, y1, x2, y2, x3, y3, x4, y4) { const m = [x1, x2, x3, y1, y2, y3, 1, 1, 1]; const v = projMulV(projAdj(m), [x4, y4, 1]); return projMul(m, [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]]); }
// CSS matrix3d mapping the box (0,0)-(srcW,srcH) onto dst corners [TL,TR,BR,BL]
function quadTransform(srcW, srcH, d) {
  const s = projBasis(0, 0, srcW, 0, 0, srcH, srcW, srcH);
  const t = projBasis(d[0][0], d[0][1], d[1][0], d[1][1], d[3][0], d[3][1], d[2][0], d[2][1]);
  const m = projMul(t, projAdj(s));
  for (let i = 0; i < 9; i++) m[i] /= m[8];
  return `matrix3d(${m[0]},${m[3]},0,${m[6]},${m[1]},${m[4]},0,${m[7]},0,0,1,0,${m[2]},${m[5]},0,${m[8]})`;
}

function warpPhoto(index) {
  const anim = manifest.photo_frame;
  const quad = photoActive && anim && anim.photoQuads ? anim.photoQuads[index] : null;
  if (!quad) { photoWarp.style.display = 'none'; return; }
  const sRect = sprite.getBoundingClientRect();
  const pRect = photoWarp.parentElement.getBoundingClientRect();
  const ow = sRect.width, oh = sRect.height;
  const dst = [
    [quad.tl[0] * ow, quad.tl[1] * oh], [quad.tr[0] * ow, quad.tr[1] * oh],
    [quad.br[0] * ow, quad.br[1] * oh], [quad.bl[0] * ow, quad.bl[1] * oh]
  ];
  photoWarp.style.display = 'block';
  photoWarp.style.left = (sRect.left - pRect.left) + 'px';
  photoWarp.style.top = (sRect.top - pRect.top) + 'px';
  photoWarp.style.width = ow + 'px';
  photoWarp.style.height = oh + 'px';
  photoWarp.style.transformOrigin = '0 0';
  photoWarp.style.transform = quadTransform(ow, oh, dst);
}

function showPhoto(payload) {
  if (!payload || !payload.src) return;
  resetInactivity();
  if (manifest.photo_frame) {
    photoWarpImg.src = payload.src;
    photoActive = true;
    behavior = 'photo';
    play('photo_frame', { onFrame: warpPhoto, holdFrame: 5, holdMs: 5000, onEnd: () => { photoActive = false; photoWarp.style.display = 'none'; enterIdle(); } });
    return;
  }
  // fallback overlay if the photo_frame clip is missing
  photoImg.src = payload.src;
  photoFrame.classList.remove('is-hidden');
  if (photoTimer) clearTimeout(photoTimer);
  const seconds = Math.max(3, Number(payload.seconds) || 9);
  photoTimer = setTimeout(() => { photoFrame.classList.add('is-hidden'); photoImg.src = ''; }, seconds * 1000);
}
window.raccoon.onShowPhoto(showPhoto);

window.raccoon.getAnimations().then(applyManifest).catch(() => {});
window.raccoon.onAnimations(applyManifest);
