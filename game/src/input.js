// Keyboard + mouse + pointer lock. Plain browser APIs only. Main reads keys by
// event.code (KeyW/KeyA/KeyS/KeyD, Space, ControlLeft/KeyC, KeyR, KeyB, KeyE,
// KeyG, Digit1-4, KeyQ) and consumes look deltas via takeLook() each sim step.
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const state = { keys, locked: false, firing: false, firingAlt: false, lookDX: 0, lookDY: 0 };

  function setKey(e, down) {
    if (down) keys.add(e.code);
    else keys.delete(e.code);
    if (e.code === 'Space') e.preventDefault();
  }

  window.addEventListener('keydown', (e) => setKey(e, true));
  window.addEventListener('keyup', (e) => setKey(e, false));
  window.addEventListener('blur', () => keys.clear());
  window.addEventListener('mousemove', (e) => {
    if (!state.locked) return;
    state.lookDX += e.movementX;
    state.lookDY += e.movementY;
  });
  window.addEventListener('mousedown', (e) => {
    if (!state.locked) return;
    if (e.button === 0) state.firing = true;
    if (e.button === 2) state.firingAlt = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) state.firing = false;
    if (e.button === 2) state.firingAlt = false;
  });
  canvas.addEventListener('click', () => {
    if (!state.locked) requestLock();
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      keys.clear();
      state.firing = false;
      state.firingAlt = false;
    }
    if (onLockChange) onLockChange(state.locked);
  });

  function requestLock() {
    try {
      const p = canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch (err) { /* lock rejected (too soon after Esc); main retries on click */ }
  }

  return {
    state,
    get locked() { return state.locked; },
    requestLock,
    takeLook() {
      const dx = state.lookDX;
      const dy = state.lookDY;
      state.lookDX = 0;
      state.lookDY = 0;
      return { dx, dy };
    },
  };
}
