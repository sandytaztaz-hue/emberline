// EMBERLINE combat: one hitscan shot, grenade physics, LOS, impact sparks.
import * as THREE from 'three';
import { WEAPONS } from './weapons.js';

const MAX_DIST = 80;
const NOISE_RADIUS = 30;
const GRAVITY = 20;
const BOUNCE = 0.45;
const HEAD_Y = 1.53;
const TORSO_Y = 1.0;
const HEAD_R = 0.16;
const TORSO_R = 0.34;
const LEGS_TOP = 0.72;

// Module temps: no per-frame allocation in the hot paths.
const _dir = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _hitP = new THREE.Vector3();
const _c = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _ap = new THREE.Vector3();
const _ray = new THREE.Ray();
const _sphere = new THREE.Sphere();
const _box = new THREE.Box3();
const _legBox = new THREE.Box3();
let worldRef = null;

// Impact spark pool (max 40 points), created by createImpacts(scene).
let pool = null;

export function bindWorld(world) { worldRef = world; }

export function createImpacts(scene) {
  const N = 40;
  const positions = new Float32Array(N * 3);
  for (let i = 0; i < N; i += 1) positions[i * 3 + 1] = -999;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color: 0xffc860, size: 0.07, transparent: true, opacity: 0.95, depthWrite: false });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
  pool = {
    n: N, positions, geo, vel: new Float32Array(N * 3), life: new Float32Array(N),
    cursor: 0, points,
    spawn(point, normal) {
      for (let k = 0; k < 6; k += 1) {
        const i = this.cursor;
        this.cursor = (this.cursor + 1) % this.n;
        this.positions[i * 3] = point.x;
        this.positions[i * 3 + 1] = point.y;
        this.positions[i * 3 + 2] = point.z;
        this.vel[i * 3] = normal.x * 2 + (Math.random() * 2 - 1) * 2.4;
        this.vel[i * 3 + 1] = normal.y * 2 + Math.random() * 2.4;
        this.vel[i * 3 + 2] = normal.z * 2 + (Math.random() * 2 - 1) * 2.4;
        this.life[i] = 0.35;
      }
      this.geo.attributes.position.needsUpdate = true;
    },
    step(dt) {
      let dirty = false;
      for (let i = 0; i < this.n; i += 1) {
        if (this.life[i] <= 0) continue;
        dirty = true;
        this.life[i] -= dt;
        if (this.life[i] <= 0) { this.positions[i * 3 + 1] = -999; continue; }
        this.vel[i * 3 + 1] -= 9 * dt;
        this.positions[i * 3] += this.vel[i * 3] * dt;
        this.positions[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
        this.positions[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      }
      if (dirty) this.geo.attributes.position.needsUpdate = true;
    },
  };
  return pool;
}

export function spawnImpact(state, point, normal) {
  if (pool) pool.spawn(point, normal);
}

// Armor absorbs half the incoming damage until it runs out (player only).
function applyArmor(player, dmg) {
  if (!player || player.armor <= 0) return dmg;
  const absorbed = Math.min(player.armor, dmg * 0.5);
  player.armor -= absorbed;
  return dmg - absorbed;
}

function falloff(dmg, dist) {
  if (dist > 50) return dmg * 0.65;
  if (dist > 30) return dmg * 0.8;
  return dmg;
}

// Ray vs one Box3, returns t or Infinity (temp point, no allocation).
function rayBoxT(box, tMax) {
  const p = _ray.intersectBox(box, _hitP);
  if (!p) return Infinity;
  const t = p.distanceTo(_origin);
  return t <= tMax ? t : Infinity;
}

// Ray vs one sphere, returns t or Infinity.
function raySphereT(cx, cy, cz, r, tMax) {
  _sphere.center.set(cx, cy, cz);
  _sphere.radius = r;
  const p = _ray.intersectSphere(_sphere, _hitP);
  if (!p) return Infinity;
  const t = p.distanceTo(_origin);
  return t <= tMax ? t : Infinity;
}

// Resolve ONE hitscan shot. shooter: 'player' or 'bot:<id>'.
// origin/dir are world-space; spread is a radian-ish jitter; rng in [0,1).
export function fireWeapon(state, shooter, origin, dir, spread, rng) {
  const isPlayer = shooter === 'player';
  let def = null;
  let bot = null;
  if (isPlayer) {
    def = WEAPONS[state.player.weapon];
  } else {
    const id = parseInt(shooter.slice(4), 10);
    bot = state.bots.find((b) => b.id === id);
    def = bot ? WEAPONS[bot.weapon] : WEAPONS.rifle;
  }
  _dir.copy(dir);
  if (spread > 0) {
    _dir.x += (rng() * 2 - 1) * spread;
    _dir.y += (rng() * 2 - 1) * spread;
    _dir.z += (rng() * 2 - 1) * spread;
  }
  _dir.normalize();
  _origin.copy(origin);
  _ray.origin.copy(_origin);
  _ray.direction.copy(_dir);
  const world = worldRef || state.world || null;
  const colliders = world ? world.colliders : [];

  // Nearest wall hit.
  let wallT = Infinity;
  let wallBox = null;
  for (let i = 0; i < colliders.length; i += 1) {
    const t = rayBoxT(colliders[i], MAX_DIST);
    if (t < wallT) { wallT = t; wallBox = colliders[i]; }
  }

  // Nearest target hit: head sphere, torso sphere, legs box.
  let bestT = Infinity;
  let bestTarget = null;
  let bestPart = null;
  const targets = [];
  if (isPlayer) {
    for (const b of state.bots) if (b.alive) targets.push(b);
  } else if (state.player.alive) {
    targets.push(state.player);
  }
  for (const tgt of targets) {
    const p = tgt.pos;
    let t = raySphereT(p.x, p.y + HEAD_Y, p.z, HEAD_R, MAX_DIST);
    let part = 'head';
    const tt = raySphereT(p.x, p.y + TORSO_Y, p.z, TORSO_R, MAX_DIST);
    if (tt < t) { t = tt; part = 'torso'; }
    _legBox.min.set(p.x - 0.26, p.y, p.z - 0.18);
    _legBox.max.set(p.x + 0.26, p.y + LEGS_TOP, p.z + 0.18);
    const tl = rayBoxT(_legBox, MAX_DIST);
    if (tl < t) { t = tl; part = 'legs'; }
    if (t < bestT) { bestT = t; bestTarget = tgt; bestPart = part; }
  }

  const hitWall = wallT < bestT;
  const endT = hitWall ? wallT : (bestTarget ? bestT : MAX_DIST);
  const endX = _origin.x + _dir.x * endT;
  const endY = _origin.y + _dir.y * endT;
  const endZ = _origin.z + _dir.z * endT;
  state.shots.push({ from: _origin.clone(), to: new THREE.Vector3(endX, endY, endZ), t: state.time });
  state.noise.push({ pos: _origin.clone(), t: state.time, radius: NOISE_RADIUS });
  if (isPlayer) state.stats.shotsFired += 1;

  if (hitWall) {
    if (wallBox) {
      // Face normal: dominant axis of (hit - box center).
      _c.copy(wallBox.getCenter(_ap)).set(endX - _c.x, endY - _c.y, endZ - _c.z);
      const ax = Math.abs(_c.x);
      const ay = Math.abs(_c.y);
      const az = Math.abs(_c.z);
      const n = new THREE.Vector3();
      if (ax >= ay && ax >= az) n.set(Math.sign(_c.x), 0, 0);
      else if (ay >= az) n.set(0, Math.sign(_c.y), 0);
      else n.set(0, 0, Math.sign(_c.z));
      spawnImpact(state, new THREE.Vector3(endX, endY, endZ), n);
    }
    return { hit: false, target: null, part: null, damage: 0, killed: false };
  }
  if (!bestTarget) return { hit: false, target: null, part: null, damage: 0, killed: false };

  let dmg = def.dmg;
  if (bestPart === 'head') dmg *= def.head;
  dmg = falloff(dmg, bestT);
  let killed = false;
  if (isPlayer) {
    state.stats.shotsHit += 1;
    bestTarget.hp -= dmg;
    if (bestTarget.hp <= 0) { bestTarget.hp = 0; bestTarget.alive = false; bestTarget.fall = 0; killed = true; state.stats.kills += 1; }
  } else {
    dmg = applyArmor(state.player, dmg);
    state.player.hp -= dmg;
    if (state.player.hp <= 0) { state.player.hp = 0; state.player.alive = false; killed = true; }
  }
  return { hit: true, target: bestTarget, part: bestPart, damage: dmg, killed };
}

// Queue a grenade; physics + fuse run in stepGrenades.
export function throwGrenade(state, from, dir, kind) {
  const def = WEAPONS[kind];
  if (!def) return false;
  state.frags.push({
    pos: from.clone(),
    vel: dir.clone().normalize().multiplyScalar(13).add(_c.set(0, 2.5, 0)),
    t: 0, fuse: def.fuse || 1.6, kind,
  });
  return true;
}

function explodeFrag(state, frag) {
  const def = WEAPONS.frag;
  state.noise.push({ pos: frag.pos.clone(), t: state.time, radius: 30 });
  const victims = [];
  if (state.player.alive) victims.push(state.player);
  for (const b of state.bots) if (b.alive) victims.push(b);
  for (const v of victims) {
    const d = v.pos.distanceTo(frag.pos);
    if (d > def.radius) continue;
    const raw = def.dmg - ((def.dmg - def.dmgMin) * d) / def.radius;
    if (v === state.player) {
      v.hp -= applyArmor(v, raw);
      if (v.hp <= 0) { v.hp = 0; v.alive = false; }
    } else {
      v.hp -= raw;
      if (v.hp <= 0) { v.hp = 0; v.alive = false; v.fall = 0; }
    }
  }
  spawnImpact(state, frag.pos, _c.set(0, 1, 0));
}

// Arc, bounce (damp 0.45), fuse -> frag explosion or smoke cloud.
export function stepGrenades(state, dt, world) {
  const w = world || worldRef || state.world || null;
  const colliders = w ? w.colliders : [];
  for (let i = state.frags.length - 1; i >= 0; i -= 1) {
    const f = state.frags[i];
    f.t += dt;
    f.vel.y -= GRAVITY * dt;
    f.pos.x += f.vel.x * dt;
    f.pos.y += f.vel.y * dt;
    f.pos.z += f.vel.z * dt;
    // Ground bounce.
    if (f.pos.y < 0.08) {
      f.pos.y = 0.08;
      if (Math.abs(f.vel.y) > 0.6) f.vel.y *= -BOUNCE;
      else f.vel.y = 0;
      f.vel.x *= 0.7;
      f.vel.z *= 0.7;
    }
    // Box bounce: push out along the smallest penetration axis.
    for (let j = 0; j < colliders.length; j += 1) {
      const b = colliders[j];
      if (f.pos.x < b.min.x || f.pos.x > b.max.x || f.pos.y < b.min.y || f.pos.y > b.max.y || f.pos.z < b.min.z || f.pos.z > b.max.z) continue;
      const px = Math.min(f.pos.x - b.min.x, b.max.x - f.pos.x);
      const py = Math.min(f.pos.y - b.min.y, b.max.y - f.pos.y);
      const pz = Math.min(f.pos.z - b.min.z, b.max.z - f.pos.z);
      if (px <= py && px <= pz) {
        f.pos.x = f.pos.x - b.min.x < b.max.x - f.pos.x ? b.min.x - 0.02 : b.max.x + 0.02;
        f.vel.x *= -BOUNCE;
      } else if (py <= pz) {
        f.pos.y = f.pos.y - b.min.y < b.max.y - f.pos.y ? b.min.y - 0.02 : b.max.y + 0.02;
        f.vel.y *= -BOUNCE;
      } else {
        f.pos.z = f.pos.z - b.min.z < b.max.z - f.pos.z ? b.min.z - 0.02 : b.max.z + 0.02;
        f.vel.z *= -BOUNCE;
      }
      f.vel.x *= 0.9;
      f.vel.z *= 0.9;
      break;
    }
    if (f.t < f.fuse) continue;
    state.frags.splice(i, 1);
    if (f.kind === 'smoke') {
      state.smokes.push({ pos: f.pos.clone(), t: state.time, ttl: WEAPONS.smoke.ttl });
    } else {
      explodeFrag(state, f);
    }
  }
  // Expire old smoke.
  for (let i = state.smokes.length - 1; i >= 0; i -= 1) {
    if (state.time - state.smokes[i].t > state.smokes[i].ttl) state.smokes.splice(i, 1);
  }
}

// Segment a->b clear of colliders and smoke spheres?
export function hasLOS(a, b, world, smokes) {
  const w = world || worldRef || null;
  _ab.copy(b).sub(a);
  const dist = _ab.length();
  if (dist < 0.001) return true;
  _ab.divideScalar(dist);
  _ray.origin.copy(a);
  _ray.direction.copy(_ab);
  _origin.copy(a);
  if (w) {
    for (let i = 0; i < w.colliders.length; i += 1) {
      if (rayBoxT(w.colliders[i], dist) < dist) return false;
    }
  }
  if (smokes) {
    for (let i = 0; i < smokes.length; i += 1) {
      const s = smokes[i];
      _ap.copy(s.pos).sub(a);
      const along = Math.max(0, Math.min(dist, _ap.dot(_ab)));
      _c.copy(a).addScaledVector(_ab, along);
      if (_c.distanceToSquared(s.pos) < WEAPONS.smoke.radius * WEAPONS.smoke.radius) return false;
    }
  }
  return true;
}
