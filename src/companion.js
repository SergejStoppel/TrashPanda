const root = document.getElementById('companion');
const button = document.getElementById('raccoonButton');
const bubble = document.getElementById('bubble');

let bubbleTimer = null;
let pointerDown = false;
let pointerMoved = false;
let startPoint = null;
let currentState = 'idle';
let idleTimer = null;
let idleRestoreTimer = null;

function setVisualState(state) {
  const states = ['idle', 'notice', 'carry', 'buried', 'sweep', 'celebrate', 'sleep', 'think', 'bin'];
  currentState = state || 'idle';

  for (const knownState of states) {
    root.classList.remove(`state-${knownState}`);
  }

  root.classList.add(`state-${currentState}`);
}

function setMood(mood) {
  const moods = ['tidy', 'curious', 'busy', 'buried', 'missing'];

  for (const knownMood of moods) {
    root.classList.remove(`mood-${knownMood}`);
  }

  if (mood) {
    root.classList.add(`mood-${mood}`);
  }
}

function showBubble(message) {
  if (!message) {
    return;
  }

  bubble.textContent = message;
  bubble.classList.remove('is-hidden');

  if (bubbleTimer) {
    clearTimeout(bubbleTimer);
  }

  bubbleTimer = setTimeout(() => {
    bubble.classList.add('is-hidden');
  }, 4300);
}

function scheduleIdleTrick() {
  if (idleTimer) {
    clearTimeout(idleTimer);
  }

  idleTimer = setTimeout(() => {
    if (!['idle', 'sleep'].includes(currentState) || pointerDown) {
      scheduleIdleTrick();
      return;
    }

    const trick = Math.random() > 0.5 ? 'think' : 'bin';
    const restore = currentState;
    setVisualState(trick);

    if (idleRestoreTimer) {
      clearTimeout(idleRestoreTimer);
    }

    idleRestoreTimer = setTimeout(() => {
      setVisualState(restore);
      scheduleIdleTrick();
    }, trick === 'bin' ? 2800 : 1800);
  }, 8000 + Math.random() * 7000);
}

window.raccoon.onCompanionUpdate((payload) => {
  if (idleRestoreTimer) {
    clearTimeout(idleRestoreTimer);
    idleRestoreTimer = null;
  }

  if (payload.visualState) {
    setVisualState(payload.visualState);
  }

  if (payload.mood) {
    setMood(payload.mood);
  }

  if (payload.bubble) {
    showBubble(payload.bubble);
  }

  scheduleIdleTrick();
});

window.raccoon.onCursor((payload) => {
  root.style.setProperty('--look-x', `${Math.round(payload.x * 4)}px`);
  root.style.setProperty('--look-y', `${Math.round(payload.y * 3)}px`);
});

button.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) {
    return;
  }

  pointerDown = true;
  pointerMoved = false;
  startPoint = { x: event.screenX, y: event.screenY };
  button.setPointerCapture(event.pointerId);
  window.raccoon.startDrag({ screenX: event.screenX, screenY: event.screenY });
});

button.addEventListener('pointermove', (event) => {
  if (!pointerDown || !startPoint) {
    return;
  }

  const distance = Math.hypot(event.screenX - startPoint.x, event.screenY - startPoint.y);

  if (distance > 4) {
    pointerMoved = true;
  }

  window.raccoon.dragMove({ screenX: event.screenX, screenY: event.screenY });
});

button.addEventListener('pointerup', (event) => {
  if (!pointerDown) {
    return;
  }

  pointerDown = false;
  window.raccoon.endDrag();

  if (!pointerMoved) {
    window.raccoon.openPanel();
  }

  try {
    button.releasePointerCapture(event.pointerId);
  } catch {
    // The pointer may already be released by the host window.
  }
});

button.addEventListener('dblclick', () => {
  window.raccoon.openPanel();
});

window.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  window.raccoon.showContextMenu();
});

scheduleIdleTrick();
