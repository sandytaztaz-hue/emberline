// Fully procedural WebAudio: no audio files. Context is created lazily on the
// first user gesture (resume) or first sound, so autoplay policy never blocks.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let stepT = 0;

  function ensure() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.45;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }

  // Short oscillator blip; slideTo glides the pitch down (gun body thump).
  function tone(freq, dur, type, vol, slideTo, when) {
    if (!ensure()) return;
    const t0 = ctx.currentTime + (when || 0);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  // Filtered noise burst (shots, footsteps, explosion body).
  function burst(dur, vol, freq, type, q, when) {
    if (!ensure()) return;
    const t0 = ctx.currentTime + (when || 0);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type || 'lowpass';
    f.frequency.value = freq;
    f.Q.value = q || 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  const SHOTS = {
    pistol: () => { burst(0.09, 0.5, 2600, 'lowpass'); tone(220, 0.08, 'square', 0.18, 70); },
    smg: () => { burst(0.07, 0.42, 3200, 'bandpass', 1.2); tone(300, 0.05, 'square', 0.12, 90); },
    rifle: () => { burst(0.13, 0.6, 1800, 'lowpass'); tone(160, 0.11, 'square', 0.22, 55); },
    sniper: () => { burst(0.32, 0.8, 1200, 'lowpass'); tone(110, 0.28, 'sawtooth', 0.3, 40); },
  };

  return {
    resume() {
      if (ensure() && ctx.state === 'suspended') ctx.resume();
    },
    shot(kind) {
      (SHOTS[kind] || SHOTS.rifle)();
    },
    reload() {
      tone(700, 0.04, 'square', 0.12);
      tone(420, 0.05, 'square', 0.14, 0, 0.18);
    },
    hit(kill) {
      tone(1250, 0.05, 'sine', 0.22);
      if (kill) tone(880, 0.12, 'sine', 0.22, 0, 0.07);
    },
    dry() {
      tone(900, 0.03, 'square', 0.1);
    },
    plant() {
      tone(880, 0.09, 'sine', 0.2);
      tone(880, 0.09, 'sine', 0.2, 0, 0.14);
    },
    defuse() {
      tone(660, 0.09, 'sine', 0.2);
      tone(990, 0.09, 'sine', 0.2, 0, 0.14);
    },
    explode() {
      burst(0.9, 0.9, 500, 'lowpass');
      tone(55, 0.8, 'sine', 0.5, 30);
    },
    roundWin() {
      tone(523, 0.14, 'sine', 0.22);
      tone(659, 0.14, 'sine', 0.22, 0, 0.13);
      tone(784, 0.24, 'sine', 0.24, 0, 0.26);
    },
    roundLose() {
      tone(392, 0.16, 'sine', 0.22);
      tone(311, 0.3, 'sine', 0.22, 0, 0.16);
    },
    // Footstep ticks while moving on the ground; interval quickens with speed.
    step(dt, moving, onGround) {
      if (!moving || !onGround) { stepT = 0; return; }
      stepT -= dt;
      if (stepT <= 0) {
        burst(0.05, 0.14, 500, 'lowpass');
        stepT = 0.38;
      }
    },
  };
}
