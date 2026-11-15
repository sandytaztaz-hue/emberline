// EMBERLINE bots: 5 Sentinel defenders — bodies, waypoint AI, vision, hearing, retake.
import * as THREE from 'three';
import { WEAPONS } from './weapons.js';
import { fireWeapon, hasLOS } from './combat.js';

const BOT_COUNT = 5;
const VISION_RANGE = 45;
const VISION_HALF = 0.61; // 70deg cone -> ~35deg half-angle in radians
const HEAR_RANGE = 30;
const BOT_SPEED = 3.4;
const STRAFE_SPEED = 2.0;
const EYE_Y = 1.53;
const FALL_TIME = 0.4;
const DEFUSE_TIME = 5;
const DEFUSE_RANGE = 1.6;
const RADIUS = 0.34;
const HEIGHT = 1.72;

const HOLD_WP = { a: ['holdA1', 'holdA2'], b: ['holdB1', 'holdB2'], mid: ['holdMid'] };
const SPAWN_OFFSETS = [[0, 0], [-2, 1.5], [2, 1.5], [-4, 2.5], [4, 2.5]];

// Module temps.
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _targetEye = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _aim = new THREE.Vector3();

function yawTo(from, x, z) {
  return Math.atan2(-(x - from.x), -(z - from.z));
}

function buildBody(scene, bot) {
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x4a5a66, roughness: 0.6, metalness: 0.2 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x232a30, roughness: 0.8, metalness: 0.1 });
  const visorMat = new THREE.MeshStandardMaterial({ color: 0xffb020, roughness: 0.3, metalness: 0.2, emissive: 0xff9d00, emissiveIntensity: 1.8 });
  const group = new THREE.Group();

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.78, 0.3), bodyMat);
  torso.position.y = 1.0;
  torso.userData = { bot, part: 'torso' };
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), darkMat);
  head.position.y = 1.53;
  head.userData = { bot, part: 'head' };
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.05), visorMat);
  visor.position.set(0, 1.55, -0.13);
  // Amber shoulder + chest trim so a bot reads as a figure, not a dark box.
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xf0a830, emissive: 0x7a5200, emissiveIntensity: 0.9, roughness: 0.5 });
  const shoulderL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 0.32), trimMat);
  shoulderL.position.set(-0.26, 1.42, 0);
  const shoulderR = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 0.32), trimMat);
  shoulderR.position.set(0.26, 1.42, 0);
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.02), trimMat);
  chest.position.set(0, 1.18, -0.16);
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.7, 0.24), darkMat);
  legs.position.y = 0.35;
  legs.userData = { bot, part: 'legs' };
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.6), darkMat);
  gun.position.set(0.18, 1.25, -0.3);
  group.add(torso, head, visor, legs, gun, shoulderL, shoulderR, chest);
  group.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  group.position.copy(bot.pos);
  scene.add(group);
  bot.group = group;
  bot.hitMeshes = [torso, head, legs];
  return [torso, head, legs];
}

// BFS over world.waypoints {id,x,z,edges[]} -> node id list (excluding start).
function findPath(world, fromId, toId) {
  const nodes = world.waypoints;
  if (fromId === toId) return [];
  const prev = new Map();
  const queue = [fromId];
  prev.set(fromId, null);
  while (queue.length > 0) {
    const cur = queue.shift();
    const node = nodes.find((n) => n.id === cur);
    if (!node) continue;
    for (const e of node.edges) {
      if (prev.has(e)) continue;
      prev.set(e, cur);
      if (e === toId) {
        const path = [e];
        let p = cur;
        while (p !== null && p !== fromId) { path.unshift(p); p = prev.get(p); }
        return path;
      }
      queue.push(e);
    }
  }
  return [];
}

function nearestNode(world, x, z) {
  let best = world.waypoints[0];
  let bestD = Infinity;
  for (const n of world.waypoints) {
    const d = (n.x - x) * (n.x - x) + (n.z - z) * (n.z - z);
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
}

function nodeById(world, id) {
  return world.waypoints.find((n) => n.id === id);
}

export function createBots(scene, world, state) {
  // Use state.bots if the engine already created them, else populate per DESIGN.md.
  if (!state.bots || state.bots.length < BOT_COUNT) {
    const roles = ['a', 'a', 'b', 'b', 'mid'];
    state.bots = roles.map((role, i) => ({
      id: i, team: 'sentinel', role,
      pos: new THREE.Vector3(world.spawns.sentinel[0] + SPAWN_OFFSETS[i][0], 0, world.spawns.sentinel[1] + SPAWN_OFFSETS[i][1]),
      vel: new THREE.Vector3(), yaw: 0, hp: 100, alive: true, mode: 'route',
      wp: 0, path: [], target: null, reactT: 0, burstLeft: 0, fireT: 0,
      weapon: state.round >= 3 ? 'rifle' : 'smg', speed: BOT_SPEED,
    }));
  }
  const bots = state.bots;
  const hitMeshes = [];
  for (const bot of bots) {
    bot.vel = bot.vel || new THREE.Vector3();
    bot.mode = bot.mode || 'route';
    bot.path = bot.path || [];
    bot.fall = bot.fall || 0;
    bot.lastSeen = bot.lastSeen || new THREE.Vector3();
    bot.seenT = bot.seenT || -99;
    bot.strafeDir = bot.strafeDir || 1;
    bot.strafeT = bot.strafeT || 0;
    bot.holdT = bot.holdT || 0;
    bot.defuseT = bot.defuseT || 0;
    bot.defuser = bot.defuser || false;
    bot.holdWp = HOLD_WP[bot.role][bot.id % HOLD_WP[bot.role].length];
    bot.holdYaw = yawTo(bot.pos, 0, 18);
    const meshes = buildBody(scene, bot);
    hitMeshes.push(...meshes);
  }

  function routeTo(bot, wpId) {
    const from = nearestNode(world, bot.pos.x, bot.pos.z);
    bot.path = findPath(world, from.id, wpId);
    bot.mode = 'route';
  }

  function reset() {
    for (let i = 0; i < bots.length; i += 1) {
      const bot = bots[i];
      bot.pos.set(world.spawns.sentinel[0] + SPAWN_OFFSETS[i][0], 0, world.spawns.sentinel[1] + SPAWN_OFFSETS[i][1]);
      bot.hp = 100;
      bot.alive = true;
      bot.fall = 0;
      bot.weapon = state.round >= 3 ? 'rifle' : 'smg';
      bot.reactT = 0;
      bot.burstLeft = 0;
      bot.fireT = 0;
      bot.defuseT = 0;
      bot.defuser = false;
      bot.holdT = 0;
      bot.seenT = -99;
      bot.group.rotation.set(0, 0, 0);
      bot.group.visible = true;
      bot.group.position.copy(bot.pos);
      bot.yaw = yawTo(bot.pos, 0, 18);
      bot.group.rotation.y = bot.yaw;
      routeTo(bot, bot.holdWp);
    }
  }

  // Axis-separated AABB move (mirrors the player box: r .34, h 1.72, feet at y=0).
  function moveCollide(bot, dx, dz) {
    const p = bot.pos;
    const nx = p.x + dx;
    let blocked = false;
    for (const b of world.colliders) {
      if (nx + RADIUS > b.min.x && nx - RADIUS < b.max.x && p.y + HEIGHT > b.min.y && p.y < b.max.y && p.z + RADIUS > b.min.z && p.z - RADIUS < b.max.z) { blocked = true; break; }
    }
    if (!blocked) p.x = Math.max(-32, Math.min(32, nx));
    const nz = p.z + dz;
    blocked = false;
    for (const b of world.colliders) {
      if (p.x + RADIUS > b.min.x && p.x - RADIUS < b.max.x && p.y + HEIGHT > b.min.y && p.y < b.max.y && nz + RADIUS > b.min.z && nz - RADIUS < b.max.z) { blocked = true; break; }
    }
    if (!blocked) p.z = Math.max(-22, Math.min(22, nz));
    return blocked;
  }

  function followPath(bot, dt, speed) {
    if (bot.path.length === 0) return true;
    const node = nodeById(world, bot.path[0]);
    if (!node) { bot.path.shift(); return bot.path.length === 0; }
    const dx = node.x - bot.pos.x;
    const dz = node.z - bot.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.4) { bot.path.shift(); return bot.path.length === 0; }
    const stepLen = Math.min(d, speed * dt);
    const beforeX = bot.pos.x;
    const beforeZ = bot.pos.z;
    moveCollide(bot, (dx / d) * stepLen, (dz / d) * stepLen);
    bot.yaw = yawTo(bot.pos, node.x, node.z);
    // Stuck against cover: skip the waypoint.
    if (Math.hypot(bot.pos.x - beforeX, bot.pos.z - beforeZ) < stepLen * 0.2) bot.path.shift();
    return false;
  }

  function canSee(bot, player) {
    if (!player.alive) return false;
    _v.copy(player.pos).sub(bot.pos);
    const dist = Math.hypot(_v.x, _v.z);
    if (dist > VISION_RANGE) return false;
    const facing = yawTo(bot.pos, player.pos.x, player.pos.z);
    let diff = Math.abs(facing - bot.yaw);
    if (diff > Math.PI) diff = Math.PI * 2 - diff;
    if (diff > VISION_HALF) return false;
    _eye.set(bot.pos.x, bot.pos.y + EYE_Y, bot.pos.z);
    _targetEye.set(player.pos.x, player.pos.y + (player.crouching ? 1.02 : 1.6), player.pos.z);
    return hasLOS(_eye, _targetEye, world, state.smokes);
  }

  function step(dt, w, combat, player, rng) {
    const rngFn = rng || Math.random;
    const fw = (combat && combat.fireWeapon) || fireWeapon;

    // On plant: 2 nearest alive bots retake; nearest of them defuses.
    if (state.bomb.state === 'planted' && !state.bots.some((b) => b.mode === 'retake' || b.mode === 'defuse')) {
      const alive = bots.filter((b) => b.alive);
      const site = state.bomb.site === 'B' ? 'siteB' : 'siteA';
      const sitePos = world.sites[state.bomb.site === 'B' ? 'B' : 'A'];
      alive.sort((a, b) => a.pos.distanceToSquared(_v.set(sitePos.x, 0, sitePos.z)) - b.pos.distanceToSquared(_v2.set(sitePos.x, 0, sitePos.z)));
      const retakers = alive.slice(0, 2);
      for (const b of retakers) {
        b.mode = 'retake';
        const from = nearestNode(world, b.pos.x, b.pos.z);
        b.path = findPath(world, from.id, site);
      }
      if (retakers[0]) retakers[0].defuser = true;
    }

    for (const bot of bots) {
      // Death fall-over (rotate x -90 over 0.4s).
      if (!bot.alive) {
        if (bot.fall < 1) {
          bot.fall = Math.min(1, bot.fall + dt / FALL_TIME);
          bot.group.rotation.x = -bot.fall * 1.45;
          bot.group.position.y = -bot.fall * 0.08;
        }
        continue;
      }
      const playerAlive = player.alive;
      const seen = canSee(bot, player);
      if (seen) {
        bot.lastSeen.copy(player.pos);
        bot.seenT = state.time;
        if (bot.mode !== 'engage' && bot.reactT <= 0 && bot.mode !== 'defuse') bot.reactT = 0.25 + rngFn() * 0.2;
      }
      if (bot.reactT > 0) {
        bot.reactT -= dt;
        if (bot.reactT <= 0 && seen && bot.mode !== 'defuse') {
          bot.mode = 'engage';
          bot.burstLeft = 3 + Math.floor(rngFn() * 3);
          bot.fireT = 0;
        }
      }
      // Hearing: fresh gunshot noise within 30m -> investigate.
      if (bot.mode !== 'engage' && bot.mode !== 'defuse' && bot.mode !== 'retake') {
        for (const n of state.noise) {
          if (state.time - n.t > 1.5) continue;
          if (bot.pos.distanceToSquared(_v.copy(n.pos)) > HEAR_RANGE * HEAR_RANGE) continue;
          bot.mode = 'hunt';
          bot.lastSeen.copy(n.pos);
          const from = nearestNode(world, bot.pos.x, bot.pos.z);
          const to = nearestNode(world, n.pos.x, n.pos.z);
          bot.path = findPath(world, from.id, to.id);
          break;
        }
      }

      if (bot.mode === 'route') {
        if (followPath(bot, dt, BOT_SPEED)) {
          bot.mode = 'hold';
          bot.yaw = bot.holdYaw;
        }
      } else if (bot.mode === 'hold') {
        bot.yaw = bot.holdYaw;
        if (seen && bot.reactT <= 0 && bot.mode !== 'engage') {
          bot.mode = 'engage';
          bot.burstLeft = 3 + Math.floor(rngFn() * 3);
          bot.fireT = 0;
        }
      } else if (bot.mode === 'hunt') {
        if (followPath(bot, dt, BOT_SPEED)) {
          bot.holdT += dt;
          bot.yaw += dt * 0.8;
          if (bot.holdT > 3) {
            bot.holdT = 0;
            routeTo(bot, bot.holdWp);
          }
        } else {
          bot.holdT = 0;
        }
        if (seen && bot.reactT <= 0) {
          bot.mode = 'engage';
          bot.burstLeft = 3 + Math.floor(rngFn() * 3);
          bot.fireT = 0;
        }
      } else if (bot.mode === 'retake') {
        const sitePos = world.sites[state.bomb.site === 'B' ? 'B' : 'A'];
        const dBomb = Math.hypot(bot.pos.x - sitePos.x, bot.pos.z - sitePos.z);
        if (bot.defuser && dBomb < DEFUSE_RANGE) {
          bot.mode = 'defuse';
          bot.defuseT = 0;
        } else if (followPath(bot, dt, BOT_SPEED)) {
          // Arrived at the site: walk straight at the bomb if close enough.
          if (dBomb < 4) {
            const dx = sitePos.x - bot.pos.x;
            const dz = sitePos.z - bot.pos.z;
            const d = Math.hypot(dx, dz) || 1;
            moveCollide(bot, (dx / d) * BOT_SPEED * dt, (dz / d) * BOT_SPEED * dt);
            bot.yaw = yawTo(bot.pos, sitePos.x, sitePos.z);
          }
        }
        if (seen && bot.reactT <= 0) {
          bot.mode = 'engage';
          bot.burstLeft = 3 + Math.floor(rngFn() * 3);
          bot.fireT = 0;
        }
      } else if (bot.mode === 'defuse') {
        // 5s hold within 1.6m of the planted bomb; seeing the player breaks it.
        const sitePos = world.sites[state.bomb.site === 'B' ? 'B' : 'A'];
        const dBomb = Math.hypot(bot.pos.x - sitePos.x, bot.pos.z - sitePos.z);
        if (seen) {
          bot.mode = 'engage';
          bot.defuseT = 0;
          state.bomb.defuseT = 0;
          bot.burstLeft = 3 + Math.floor(rngFn() * 3);
          bot.fireT = 0;
        } else if (dBomb > DEFUSE_RANGE || state.bomb.state !== 'planted') {
          bot.mode = 'retake';
          bot.defuseT = 0;
          state.bomb.defuseT = 0;
        } else {
          bot.defuseT += dt;
          state.bomb.defuseT = bot.defuseT;
          if (bot.defuseT >= DEFUSE_TIME) state.bomb.state = 'defused';
        }
      }

      if (bot.mode === 'engage') {
        if (!playerAlive || (state.time - bot.seenT > 2.5 && !seen)) {
          bot.mode = 'hunt';
          const from = nearestNode(world, bot.pos.x, bot.pos.z);
          const to = nearestNode(world, bot.lastSeen.x, bot.lastSeen.z);
          bot.path = findPath(world, from.id, to.id);
        } else {
          // Face the player, strafe perpendicular, fire in bursts.
          bot.yaw = yawTo(bot.pos, player.pos.x, player.pos.z);
          bot.strafeT -= dt;
          if (bot.strafeT <= 0) {
            bot.strafeDir *= -1;
            bot.strafeT = 0.7 + rngFn() * 0.7;
          }
          const px = Math.sin(bot.yaw);
          const pz = Math.cos(bot.yaw);
          moveCollide(bot, px * bot.strafeDir * STRAFE_SPEED * dt, pz * bot.strafeDir * STRAFE_SPEED * dt);
          if (bot.reactT <= 0 && seen) {
            bot.fireT -= dt;
            if (bot.burstLeft > 0 && bot.fireT <= 0) {
              _muzzle.set(bot.pos.x, bot.pos.y + 1.35, bot.pos.z);
              _aim.set(player.pos.x, player.pos.y + 1.2, player.pos.z).sub(_muzzle).normalize();
              const dist = bot.pos.distanceTo(player.pos);
              const speed = player.vel ? Math.hypot(player.vel.x, player.vel.z) : 0;
              const inacc = 0.02 + dist * 0.0006 + speed * 0.004;
              fw(state, 'bot:' + bot.id, _muzzle, _aim, inacc, rngFn);
              bot.burstLeft -= 1;
              bot.fireT = WEAPONS[bot.weapon].gap;
              if (bot.burstLeft === 0) bot.fireT = 0.4 + rngFn() * 0.4;
            } else if (bot.burstLeft === 0 && bot.fireT <= 0) {
              bot.burstLeft = 3 + Math.floor(rngFn() * 3);
            }
          }
        }
      }

      bot.group.position.copy(bot.pos);
      bot.group.rotation.y = bot.yaw;
    }
  }

  // Damage one bot; returns true if the hit killed it.
  function damage(bot, part, amount) {
    if (!bot || !bot.alive) return false;
    bot.hp -= amount;
    if (bot.hp > 0) return false;
    bot.hp = 0;
    bot.alive = false;
    bot.fall = 0;
    return true;
  }

  reset();
  return { bots, hitMeshes, damage, step, reset };
}
