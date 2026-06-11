const button = document.getElementById('raccoonButton');
const bubble = document.getElementById('bubble');
const sprite = document.getElementById('sprite');

const DISPLAY_H = 124;
const WIN_W = 160;
const WIN_H = 220;
const SPRITE_BOTTOM = 14;       // matches .sprite bottom in companion.css
const SCALE = { drag_hold_loop: 1.5, drag_release: 1.5 };  // hanging and falling take more space
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

let pointerActive = false;
let pointerMoved = false;
let startPoint = null;

// ---------- core clip player ----------
function stopFrameTimer() {
  if (frameTimer) { clearInterval(frameTimer); frameTimer = null; }
}

function play(name, options = {}) {
  const anim = manifest[name];
  if (!anim) { if (name !== base && manifest[base]) play(base, options); return; }
  current = name;
  stopFrameTimer();

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
  const render = () => { sprite.style.backgroundPositionX = `-${index * cellW}px`; };
  render();

  if (anim.frames <= 1) { if (loop === 'once' && options.onEnd) options.onEnd(); return; }

  frameTimer = setInterval(() => {
    if (loop === 'pingpong') {
      if (index + dir < 0 || index + dir >= anim.frames) dir *= -1;
      index += dir;
    } else if (loop === 'once') {
      if (index >= anim.frames - 1) { stopFrameTimer(); if (options.onEnd) options.onEnd(); return; }
      index += 1;
    } else {
      index = (index + 1) % anim.frames;
    }
    render();
  }, Math.max(60, Math.round(1000 / (anim.fps || 4))));
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

window.raccoon.getAnimations().then(applyManifest).catch(() => {});
window.raccoon.onAnimations(applyManifest);
