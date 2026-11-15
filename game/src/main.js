// EMBERLINE boot: fixed 1/60 sim, render loop, ?shot capture modes.
// Wires state, world, player, weapons, bots, combat, rounds, hud, audio, input.
import * as THREE from 'three';
import { createState } from './state.js';
import { createWorld } from './world.js';
import { createPlayer } from './player.js';
import { WEAPONS, createWeaponRig } from './weapons.js';
import { createBots } from './bots.js';
import * as combat from './combat.js';
import { createRounds } from './rounds.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';

const FIXED = 1 / 60;
const TRACER_MAX = 24;
const _dir = new THREE.Vector3();
const _from = new THREE.Vector3();
const _aim = new THREE.Vector3();

function mulberry32(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const rng = mulberry32(Number.parseInt(params.get('seed') || '1', 10) || 1);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x10161a);
scene.fog = new THREE.Fog(0x10161a, 18, 46);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 140);
scene.add(camera);

const state = createState();
const world = createWorld(scene);
state.world = world;
const player = createPlayer(world.colliders, state.player);
const rig = createWeaponRig(camera, state);
combat.bindWorld(world);
const impacts = combat.createImpacts(scene);
const bots = createBots(scene, world, state);
const hud = createHud();
const audio = createAudio();
let matchResult = null;
const rounds = createRounds(state, {
  onKill: () => audio.hit(true),
  onRoundEnd: (d) => {
    if (d.winner === 'vanguard') audio.roundWin();
    else audio.roundLose();
    if (!shot) {
      if (document.pointerLockElement) document.exitPointerLock();
      hud.showOverlay('roundEnd', d);
    }
  },
  onMatchEnd: (d) => {
    matchResult = d;
    if (!shot) {
      if (document.pointerLockElement) document.exitPointerLock();
      hud.showOverlay('matchEnd', d);
    }
  },
  onPlant: () => audio.plant(),
  onDefuse: () => audio.defuse(),
  onExplode: () => audio.explode(),
});
const input = createInput(renderer.domElement, onLockChange);

// Tracer pool: prebuilt lines, reused every frame, no per-frame allocation.
const tracers = [];
for (let i = 0; i < TRACER_MAX; i += 1) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xf0a830, transparent: true, opacity: 0.9 }));
  line.visible = false;
  line.frustumCulled = false;
  scene.add(line);
  tracers.push(line);
}

const prevKeys = new Set();
let lastGun = 'pistol';
let prevFiring = false;
let prevAlive = true;
let dryCd = 0;
let lastFeed = 0;
let lastReset = -1;
let lastHp = 100;
let lastFov = 74;
let started = false;
let frozen = false;
let accumulator = 0;
let lastTime = performance.now();

function syncLoadout() {
  for (const id of ['pistol', 'smg', 'rifle', 'sniper']) if (rounds.owned[id]) rig.refill(id);
  rig.state.fragCount = rounds.owned.frag;
  rig.state.smokeCount = rounds.owned.smoke;
  const w = state.player.weapon;
  if (w !== 'frag' && w !== 'smoke' && !rounds.owned[w]) state.player.weapon = 'pistol';
  if (isGun(state.player.weapon)) {
    rig.switchTo(state.player.weapon);
    lastGun = state.player.weapon;
  }
  const cur = WEAPONS[state.player.weapon];
  hud.setWeapon(cur ? cur.name : state.player.weapon);
}

function currentSpread() {
  return rig.spread(player.groundSpeed(), input.state.firingAlt, state.player.crouching);
}

function shoot() {
  const p = state.player;
  if (!p.alive) return;
  const id = p.weapon;
  if (id === 'frag' || id === 'smoke') { throwGrenadeNow(id); return; }
  const w = WEAPONS[id];
  if (!w) return;
  if (!rig.takeRound()) { audio.dry(); return; }
  camera.getWorldDirection(_dir);
  const sp = currentSpread();
  // fireWeapon applies spread jitter, raycast, damage, kill, stats + tracer.
  const res = combat.fireWeapon(state, 'player', camera.position, _dir, sp, rng);
  rig.pullTrigger();
  player.recoil(w.kick || 0.01, (rng() * 2 - 1) * 0.004);
  audio.shot(id);
  if (res && res.hit) {
    hud.hitmarker(res.killed);
    if (res.killed) rounds.registerKill(res.target);
    else audio.hit(false);
  }
}

function throwGrenadeNow(id) {
  _from.copy(state.player.pos);
  _from.y += state.player.eye;
  camera.getWorldDirection(_dir);
  if (!rig.throw(id, _from, _dir)) return;
  rounds.owned[id] = id === 'frag' ? rig.state.fragCount : rig.state.smokeCount;
  state.player.weapon = lastGun;
  rig.state.cooldown = 0.4;
}

function isGun(id) {
  return id !== 'frag' && id !== 'smoke';
}

function switchWeapon(id) {
  const p = state.player;
  if (p.weapon === id) return;
  if (isGun(id)) {
    if (!rounds.owned[id]) return;
    if (rig.state.weapon !== id && !rig.switchTo(id)) return;
    if (isGun(p.weapon)) lastGun = p.weapon;
    p.weapon = id;
  } else {
    const count = id === 'frag' ? rig.state.fragCount : rig.state.smokeCount;
    if (count <= 0) return;
    if (isGun(p.weapon)) lastGun = p.weapon;
    p.weapon = id;
  }
  const w = WEAPONS[id];
  hud.setWeapon(w ? w.name : id);
}

function cycleGrenade() {
  const cur = state.player.weapon;
  if (cur === 'frag') { if (rounds.owned.smoke > 0) switchWeapon('smoke'); else switchWeapon(lastGun); }
  else if (cur === 'smoke') switchWeapon(lastGun);
  else if (rounds.owned.frag > 0) switchWeapon('frag');
  else if (rounds.owned.smoke > 0) switchWeapon('smoke');
}

function startReload() {
  const id = state.player.weapon;
  const w = WEAPONS[id];
  if (!w || !isGun(id)) return;
  if (rig.state.reloadLeft > 0 || rig.state.mag >= w.mag || rig.state.reserve <= 0) return;
  rig.reload();
  audio.reload();
}

function onKeyDown(key) {
  if (state.phase !== 'live' && state.phase !== 'planted') return;
  if (key === 'Digit1') {
    const primary = rounds.owned.rifle ? 'rifle' : rounds.owned.smg ? 'smg' : rounds.owned.sniper ? 'sniper' : null;
    if (primary) switchWeapon(primary);
  } else if (key === 'Digit2') switchWeapon('pistol');
  else if (key === 'Digit3') switchWeapon('frag');
  else if (key === 'Digit4') switchWeapon('smoke');
  else if (key === 'KeyQ') switchWeapon(lastGun);
  else if (key === 'KeyR') startReload();
  else if (key === 'KeyG') cycleGrenade();
}

function syncCamera() {
  const p = state.player;
  camera.position.set(p.pos.x, p.pos.y + p.eye, p.pos.z);
  camera.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const p = state.player;
  const dx = point.x - p.pos.x;
  const dy = point.y - (p.pos.y + p.eye);
  const dz = point.z - p.pos.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  p.yaw = Math.atan2(-dx, -dz);
  p.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
  syncCamera();
}

function bombText() {
  const b = state.bomb;
  if (b.state === 'planted') return 'CHARGE PLANTED — ' + Math.ceil(Math.max(0, b.fuse)) + 's';
  if (b.state === 'defused') return 'CHARGE DEFUSED';
  if (b.state === 'exploded') return 'CHARGE DETONATED';
  if (state.phase === 'live' || state.phase === 'buy') return 'PLANT THE CHARGE — A OR B';
  return '';
}

function syncHud() {
  if (rounds.resetCount !== lastReset) {
    lastReset = rounds.resetCount;
    syncLoadout();
  }
  const p = state.player;
  hud.setHealth(p.hp);
  hud.setArmor(p.armor);
  const w = WEAPONS[p.weapon];
  if (w && isGun(p.weapon)) {
    hud.setAmmo(rig.state.mag, rig.state.reserve);
    hud.setWeapon(w.name);
  } else {
    hud.setAmmo(p.weapon === 'frag' ? rig.state.fragCount : rig.state.smokeCount, 0);
    hud.setWeapon(p.weapon === 'frag' ? 'FRAG-2' : 'SMK-1');
  }
  hud.setMoney(state.money);
  hud.setTimer(state.roundTime);
  hud.setScore(state.score.vanguard, state.score.sentinel);
  let botsAlive = 0;
  for (const b of state.bots) if (b.alive) botsAlive += 1;
  hud.setAlive(p.alive ? 1 : 0, botsAlive);
  hud.setBomb(bombText());
  hud.setCrosshair(currentSpread());
  hud.showBuy(rounds.buyOpen && state.phase === 'buy', state.money, rounds.owned);
  if (state.feed.length < lastFeed) { hud.clearFeed(); lastFeed = 0; }
  for (let i = lastFeed; i < state.feed.length; i += 1) hud.feed(state.feed[i].text);
  lastFeed = state.feed.length;
}

function renderTracers() {
  let n = 0;
  for (const s of state.shots) {
    if (n >= TRACER_MAX) break;
    if (state.time - s.t > 0.06) continue;
    const line = tracers[n];
    n += 1;
    const pos = line.geometry.attributes.position;
    pos.setXYZ(0, s.from.x, s.from.y, s.from.z);
    pos.setXYZ(1, s.to.x, s.to.y, s.to.z);
    pos.needsUpdate = true;
    line.visible = true;
  }
  for (let i = n; i < TRACER_MAX; i += 1) tracers[i].visible = false;
}

function stepSim(dt) {
  const keys = input.state.keys;
  for (const k of keys) if (!prevKeys.has(k)) onKeyDown(k);
  prevKeys.clear();
  for (const k of keys) prevKeys.add(k);
  const p = state.player;
  player.step(dt, keys, input.state.firingAlt);
  bots.step(dt, world, combat, state.player, rng);
  combat.stepGrenades(state, dt, world);
  impacts.step(dt);
  rig.step(dt, player.groundSpeed() > 0.5 && p.onGround, input.state.firingAlt);
  if (prevAlive && !p.alive) rounds.registerDeath(null);
  prevAlive = p.alive;
  if (p.hp < lastHp && p.alive) hud.damageFlash();
  lastHp = p.hp;
  if (p.alive && (state.phase === 'live' || state.phase === 'planted')) {
    const w = WEAPONS[p.weapon];
    const held = input.state.firing;
    const semi = !w || w.auto !== true;
    dryCd -= dt;
    if (held && (!semi || !prevFiring)) {
      if (rig.ready()) shoot();
      else if (isGun(p.weapon) && rig.state.mag <= 0 && rig.state.reloadLeft <= 0 && dryCd <= 0) {
        audio.dry();
        dryCd = 0.3;
      }
    }
  }
  prevFiring = input.state.firing;
  rounds.step(dt, input.state);
  let n = 0;
  for (let i = 0; i < state.shots.length; i += 1) {
    if (state.time - state.shots[i].t <= 0.06) {
      state.shots[n] = state.shots[i];
      n += 1;
    }
  }
  state.shots.length = n;
  world.update(dt);
  audio.step(dt, player.groundSpeed() > 0.5 && p.onGround, p.onGround);
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    audio.resume();
    hud.hideOverlay();
    return;
  }
  if (state.phase === 'matchEnd') { hud.showOverlay('matchEnd', matchResult); return; }
  if (state.phase === 'roundEnd') return;
  hud.showOverlay(started ? 'paused' : 'start');
}

hud.onPlay(() => {
  if (shot) return;
  audio.resume();
  if (state.phase === 'matchEnd') {
    rounds.restartMatch();
    matchResult = null;
    lastFeed = 0;
    hud.clearFeed();
    syncLoadout();
  }
  input.requestLock();
});

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    if (look.dx || look.dy) player.look(look.dx, look.dy);
    if (started && (input.locked || state.phase === 'roundEnd')) {
      accumulator += dt;
      let steps = 0;
      while (accumulator >= FIXED && steps < 5) {
        stepSim(FIXED);
        accumulator -= FIXED;
        steps += 1;
      }
      if (accumulator > FIXED * 5) accumulator = 0;
    }
    const wantFov = input.state.firingAlt && state.player.weapon === 'sniper' ? 30 : 74;
    if (wantFov !== lastFov) {
      camera.fov = wantFov;
      camera.updateProjectionMatrix();
      lastFov = wantFov;
    }
    syncCamera();
    renderTracers();
    syncHud();
    if (started && !input.locked && (state.phase === 'buy' || state.phase === 'live' || state.phase === 'planted')) {
      hud.showOverlay('paused');
    }
  }
  renderer.render(scene, camera);
}

function nearestBot() {
  const p = state.player;
  let best = null;
  let bestD = Infinity;
  for (const b of state.bots) {
    if (!b.alive) continue;
    const dx = b.pos.x - p.pos.x;
    const dz = b.pos.z - p.pos.z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = b; }
  }
  return best;
}

function settle(n) {
  for (let i = 0; i < n; i += 1) stepSim(FIXED);
}

function runShot(name) {
  started = true;
  if (name === 'start') {
    state.player.pos.set(0, 0, 18);
    state.player.yaw = 0;
    state.player.pitch = 0;
    settle(20);
    // Bots can land hits during the settle; top the player back up so the
    // cover shows a clean 100 HP, not a half-spent health bar.
    state.player.hp = 100;
    state.player.alive = true;
    prevAlive = true;
    lastHp = 100;
    _aim.set(0, 1.4, -10);
    aimAt(_aim);
    hud.showOverlay('start');
    syncHud();
  } else if (name === 'play') {
    hud.hideOverlay();
    state.phase = 'live';
    state.roundTime = 100;
    rounds.buyOpen = false;
    rounds.owned.rifle = true;
    state.player.weapon = 'rifle';
    syncLoadout();
    state.player.pos.set(0, 0, 18);
    state.player.yaw = 0;
    state.player.pitch = 0;
    settle(30);
    input.state.keys.add('KeyW');
    settle(40);
    input.state.keys.delete('KeyW');
    // Top up regardless: bots chew the player down during the walk-in settle,
    // and the capture should show a healthy player, not 4 HP + red vignette.
    state.player.hp = 100;
    state.player.alive = true;
    lastHp = 100;
    prevAlive = true;
    state.phase = 'live';
    state.roundTime = 100;
    state.score.vanguard = 0;
    state.score.sentinel = 0;
    state.feed.length = 0;
    const bot = nearestBot();
    if (bot) {
      for (let r = 0; r < 3; r += 1) {
        _aim.copy(bot.pos);
        _aim.y += 1.0;
        aimAt(_aim);
        shoot();
        if (r < 2) settle(8);
      }
      if (bot.alive) {
        bot.hp = 0;
        bot.alive = false;
        state.stats.kills += 1;
        rounds.registerKill(bot);
      }
    }
    settle(12);
    const bot2 = nearestBot();
    if (bot2) {
      _aim.copy(bot2.pos);
      _aim.y += 1.0;
      aimAt(_aim);
      shoot();
    }
    settle(1);
    // Final top-up: return fire during the shooting sequence may have dented
    // HP again; the capture should show a healthy player.
    state.player.hp = 100;
    lastHp = 100;
    syncHud();
  } else {
    state.score.vanguard = 1;
    state.score.sentinel = 0;
    state.phase = 'roundEnd';
    state.roundTime = 4;
    state.bomb.state = 'planted';
    state.bomb.site = 'A';
    state.bomb.fuse = 32;
    state.player.pos.set(-18, 0, -10);
    state.player.yaw = 0;
    state.player.pitch = 0;
    settle(10);
    _aim.set(-22, 0.8, -14);
    aimAt(_aim);
    hud.showOverlay('roundEnd', { winner: 'vanguard', reason: 'explode', score: { vanguard: 1, sentinel: 0 } });
    syncHud();
  }
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderTracers();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
syncLoadout();
lastReset = rounds.resetCount;
if (!shot) hud.showOverlay('start');
syncHud();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
