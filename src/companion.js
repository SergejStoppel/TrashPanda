const root = document.getElementById('companion');
const button = document.getElementById('raccoonButton');
const bubble = document.getElementById('bubble');
const sprite = document.getElementById('sprite');

const DISPLAY_H = 150;                 // on-screen sprite height in px
const ASSET_BASE = './assets/animations/';
const AMBIENT_POOL = ['read_book', 'drink_tea', 'eat_cookie', 'groom', 'look_around', 'stretch', 'tail_flick'];
// When main asks for a state we do not have art for yet, fall back to idle.
const ALIAS = {
  idle: 'idle_breathe', sleep: 'idle_breathe', think: 'idle_breathe', carry: 'idle_breathe',
  sweep: 'idle_breathe', buried: 'idle_breathe', notice: 'idle_breathe', celebrate: 'idle_breathe',
  analyzing: 'idle_breathe', analyze: 'idle_breathe', wave: 'idle_breathe'
};

let manifest = {};
let base = 'idle_breathe';
let current = null;
let frameTimer = null;
let ambientTimer = null;
let bubbleTimer = null;

let pointerDown = false;
let pointerMoved = false;
let startPoint = null;

function resolve(name) {
  if (manifest[name]) return name;
  if (ALIAS[name] && manifest[ALIAS[name]]) return ALIAS[name];
  return base;
}

function stopFrameTimer() {
  if (frameTimer) {
    clearInterval(frameTimer);
    frameTimer = null;
  }
}

// Configure the sprite element for an animation and begin playing it.
function play(name, options = {}) {
  const resolved = resolve(name);
  const anim = manifest[resolved];
  if (!anim) return;

  current = resolved;
  stopFrameTimer();

  const scale = DISPLAY_H / anim.frameHeight;
  const cellW = Math.round(anim.frameWidth * scale);
  sprite.style.width = `${cellW}px`;
  sprite.style.height = `${DISPLAY_H}px`;
  sprite.style.backgroundImage = `url("${ASSET_BASE}${anim.strip}")`;
  sprite.style.backgroundSize = `${cellW * anim.frames}px ${DISPLAY_H}px`;

  let index = 0;
  let dir = 1;
  const render = () => { sprite.style.backgroundPositionX = `-${index * cellW}px`; };
  render();

  if (anim.frames <= 1) return;

  frameTimer = setInterval(() => {
    if (anim.loop === 'pingpong') {
      if (index + dir < 0 || index + dir >= anim.frames) dir *= -1;
      index += dir;
    } else if (anim.loop === 'once') {
      if (index >= anim.frames - 1) {
        stopFrameTimer();
        if (options.onEnd) options.onEnd();
        else returnToBase();
        return;
      }
      index += 1;
    } else {
      index = (index + 1) % anim.frames;
    }
    render();
  }, Math.max(60, Math.round(1000 / (anim.fps || 4))));
}

function returnToBase() {
  play(base);
  scheduleAmbient();
}

// Occasionally drift into an idle activity (reading, tea, snack) then settle.
function scheduleAmbient() {
  if (ambientTimer) clearTimeout(ambientTimer);
  ambientTimer = setTimeout(() => {
    if (current !== base || pointerDown) {
      scheduleAmbient();
      return;
    }
    const pool = AMBIENT_POOL.filter((n) => manifest[n]);
    if (!pool.length) {
      scheduleAmbient();
      return;
    }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    const anim = manifest[pick];
    if (anim.loop === 'once') {
      play(pick, { onEnd: returnToBase });
    } else {
      // Loop the activity for a few cycles, then return to idle.
      play(pick);
      const dwell = Math.max(3200, (anim.frames / (anim.fps || 4)) * 1000 * 2.5);
      ambientTimer = setTimeout(returnToBase, dwell);
    }
  }, 9000 + Math.random() * 8000);
}

function showBubble(message) {
  if (!message) return;
  bubble.textContent = message;
  bubble.classList.remove('is-hidden');
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => bubble.classList.add('is-hidden'), 4300);
}

function applyManifest(data) {
  manifest = data || {};
  base = manifest.idle_breathe ? 'idle_breathe' : Object.keys(manifest)[0];
  if (base) {
    play(base);
    scheduleAmbient();
  }
}

// ----- main process wiring -----
window.raccoon.onCompanionUpdate((payload) => {
  if (payload.visualState) {
    const resolved = resolve(payload.visualState);
    // Reactions we have art for play once; everything else just sits on idle.
    if (manifest[resolved] && manifest[resolved].loop === 'once' && resolved !== base) {
      play(resolved, { onEnd: returnToBase });
    } else {
      play(resolved);
      if (resolved === base) scheduleAmbient();
    }
  }
  if (payload.bubble) showBubble(payload.bubble);
});

// The raccoon intentionally stays still and does not follow the cursor.

button.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  pointerDown = true;
  pointerMoved = false;
  startPoint = { x: event.screenX, y: event.screenY };
  button.setPointerCapture(event.pointerId);
  window.raccoon.startDrag({ screenX: event.screenX, screenY: event.screenY });
});

button.addEventListener('pointermove', (event) => {
  if (!pointerDown || !startPoint) return;
  if (Math.hypot(event.screenX - startPoint.x, event.screenY - startPoint.y) > 4) pointerMoved = true;
  window.raccoon.dragMove({ screenX: event.screenX, screenY: event.screenY });
});

button.addEventListener('pointerup', (event) => {
  if (!pointerDown) return;
  pointerDown = false;
  window.raccoon.endDrag();
  if (!pointerMoved) window.raccoon.openPanel();
  try { button.releasePointerCapture(event.pointerId); } catch { /* already released */ }
});

button.addEventListener('dblclick', () => window.raccoon.openPanel());
window.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  window.raccoon.showContextMenu();
});

// Load the animation manifest, then start idling.
window.raccoon.getAnimations().then(applyManifest).catch(() => {});
window.raccoon.onAnimations(applyManifest);
