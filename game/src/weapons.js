// EMBERLINE weapons: table, first-person view models, ammo, spread, recoil, grenades.
import * as THREE from 'three';

// Weapon table (binding numbers from DESIGN.md).
export const WEAPONS = {
  pistol: { name: 'P9 Sidearm', price: 0, mag: 12, reserve: 36, dmg: 26, head: 3, gap: 0.15, auto: false, semi: true, spreadStill: 0.004, move: 0.02, kick: 0.01, speed: 5.2, reload: 1.4 },
  smg: { name: 'Kestrel-9', price: 1500, mag: 32, reserve: 96, dmg: 24, head: 3, gap: 0.07, auto: true, spreadStill: 0.008, move: 0.03, kick: 0.007, speed: 5.4, reload: 1.9 },
  rifle: { name: 'VK-47', price: 2700, mag: 30, reserve: 90, dmg: 34, head: 3, gap: 0.1, auto: true, spreadStill: 0.003, move: 0.026, kick: 0.012, speed: 5.2, reload: 2.1 },
  sniper: { name: 'Lance .50', price: 4750, mag: 5, reserve: 15, dmg: 88, head: 2.5, gap: 1.1, auto: false, bolt: true, spreadStill: 0.001, move: 0.04, kick: 0.03, speed: 4.9, reload: 2.6, zoomFov: 30 },
  frag: { name: 'FRAG-2', price: 300, fuse: 1.6, radius: 6, dmg: 120, dmgMin: 20 },
  smoke: { name: 'SMK-1', price: 300, ttl: 14, radius: 3.2 },
};

const GUNS = ['pistol', 'smg', 'rifle', 'sniper'];
const FLASH_TIME = 0.06;
const BLOOM_PER_SHOT = 0.0015;
const BLOOM_MAX = 0.02;
const BLOOM_DECAY = 0.02;
const SWITCH_TIME = 0.26;
const THROW_SPEED = 13;
const THROW_UP = 2.5;

// Hip / ADS view-model anchor, muzzle z per gun (flash + tracer origin).
const HIP = { x: 0.24, y: -0.22, z: -0.45 };
const ADS = { x: 0, y: -0.145, z: -0.35 };
const MUZZLE_Z = { pistol: -0.42, smg: -0.62, rifle: -0.78, sniper: -0.98 };

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

// Distinct silhouette per gun, all from boxes + one scope cylinder.
function buildModel(id, mats) {
  const g = new THREE.Group();
  if (id === 'pistol') {
    g.add(box(0.07, 0.08, 0.26, mats.body, 0, 0, -0.05));
    g.add(box(0.05, 0.05, 0.1, mats.dark, 0, 0.01, -0.22));
    g.add(box(0.06, 0.14, 0.07, mats.grip, 0, -0.09, 0.06));
    g.add(box(0.02, 0.02, 0.02, mats.accent, 0, 0.05, -0.16));
  } else if (id === 'smg') {
    g.add(box(0.08, 0.1, 0.4, mats.body, 0, 0, -0.08));
    g.add(box(0.045, 0.045, 0.3, mats.dark, 0, 0.02, -0.4));
    g.add(box(0.05, 0.2, 0.06, mats.grip, 0, -0.13, -0.05));
    g.add(box(0.06, 0.09, 0.1, mats.grip, 0, -0.08, 0.14));
    g.add(box(0.02, 0.03, 0.12, mats.accent, 0, 0.06, -0.2));
  } else if (id === 'rifle') {
    g.add(box(0.09, 0.1, 0.44, mats.body, 0, 0, -0.1));
    g.add(box(0.045, 0.045, 0.42, mats.dark, 0, 0.025, -0.5));
    g.add(box(0.05, 0.16, 0.05, mats.grip, 0, -0.11, -0.12));
    g.add(box(0.075, 0.08, 0.24, mats.grip, 0, -0.02, 0.3));
    const mag = box(0.05, 0.18, 0.07, mats.grip, 0, -0.12, 0.02);
    mag.rotation.x = 0.25;
    g.add(mag);
    g.add(box(0.02, 0.03, 0.1, mats.accent, 0, 0.06, -0.28));
  } else {
    g.add(box(0.08, 0.09, 0.5, mats.body, 0, 0, -0.12));
    g.add(box(0.035, 0.035, 0.62, mats.dark, 0, 0.02, -0.62));
    g.add(box(0.07, 0.07, 0.2, mats.grip, 0, -0.02, 0.32));
    g.add(box(0.05, 0.14, 0.06, mats.grip, 0, -0.1, -0.05));
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 10), mats.dark);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.075, -0.1);
    g.add(scope);
    g.add(box(0.015, 0.02, 0.06, mats.accent, 0, 0.05, -0.3));
  }
  return g;
}

export function createWeaponRig(camera, gameState = null) {
  const mats = {
    body: new THREE.MeshStandardMaterial({ color: 0x3a444c, roughness: 0.5, metalness: 0.4 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x22282e, roughness: 0.7, metalness: 0.25 }),
    grip: new THREE.MeshStandardMaterial({ color: 0x1a1e22, roughness: 0.85, metalness: 0.1 }),
    accent: new THREE.MeshStandardMaterial({ color: 0xf0a830, roughness: 0.4, metalness: 0.3, emissive: 0x664400 }),
  };
  const models = {};
  for (const id of GUNS) {
    const m = buildModel(id, mats);
    m.position.set(HIP.x, HIP.y, HIP.z);
    m.visible = false;
    camera.add(m);
    models[id] = m;
  }

  // One flash plane + light, re-parented to the active gun's muzzle.
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.16, 0.16),
    new THREE.MeshBasicMaterial({ color: 0xffc860, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.visible = false;
  const flashLight = new THREE.PointLight(0xffb840, 0, 6);
  const flashRig = new THREE.Group();
  flashRig.add(flash, flashLight);
  flashRig.position.set(0, 0.02, MUZZLE_Z.rifle);
  models.rifle.add(flashRig);

  const ammo = {};
  for (const id of GUNS) ammo[id] = { mag: 0, reserve: 0 };
  ammo.pistol = { mag: WEAPONS.pistol.mag, reserve: WEAPONS.pistol.reserve };

  const state = {
    weapon: 'rifle', mag: 0, reserve: 0, cooldown: 0, reloadLeft: 0,
    flash: 0, kick: 0, bloom: 0, fragCount: 0, smokeCount: 0,
    switching: false, switchT: 0,
  };
  let pendingWeapon = null;
  let adsBlend = 0;
  let activeModel = models.rifle;
  const pendingThrows = [];
  const _v = new THREE.Vector3();

  function showModel(id) {
    for (const key of GUNS) models[key].visible = key === id;
    activeModel = models[id];
    flashRig.position.set(0, 0.02, MUZZLE_Z[id]);
    models[id].add(flashRig);
  }
  showModel('rifle');

  function loadAmmo(id) {
    state.mag = ammo[id].mag;
    state.reserve = ammo[id].reserve;
  }
  function saveAmmo() {
    ammo[state.weapon].mag = state.mag;
    ammo[state.weapon].reserve = state.reserve;
  }
  loadAmmo('rifle');

  function step(dt, moving, ads) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.bloom = Math.max(0, state.bloom - BLOOM_DECAY * dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    adsBlend += ((ads ? 1 : 0) - adsBlend) * Math.min(1, dt * 12);
    const def = WEAPONS[state.weapon];
    // Reload dip, then feed the mag.
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      if (state.reloadLeft === 0) {
        const need = def.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
        saveAmmo();
      }
    }
    // Lower / raise on weapon switch.
    if (state.switching) {
      state.switchT += dt;
      const half = SWITCH_TIME / 2;
      if (state.switchT >= half && pendingWeapon) {
        saveAmmo();
        state.weapon = pendingWeapon;
        pendingWeapon = null;
        showModel(state.weapon);
        loadAmmo(state.weapon);
        state.reloadLeft = 0;
      }
      if (state.switchT >= SWITCH_TIME) {
        state.switching = false;
        state.switchT = 0;
      }
    }
    const dip = state.switching
      ? (state.switchT < SWITCH_TIME / 2 ? state.switchT / (SWITCH_TIME / 2) : 1 - (state.switchT - SWITCH_TIME / 2) / (SWITCH_TIME / 2))
      : 0;
    const reloadDip = state.reloadLeft > 0 ? Math.sin(Math.min(1, (def.reload - state.reloadLeft) / def.reload) * Math.PI) * 0.5 : 0;
    const bob = moving ? Math.sin(performance.now() * 0.011) * 0.006 : 0;
    const px = HIP.x + (ADS.x - HIP.x) * adsBlend;
    const py = HIP.y + (ADS.y - HIP.y) * adsBlend - dip * 0.22 - reloadDip * 0.12 + bob;
    const pz = HIP.z + (ADS.z - HIP.z) * adsBlend + state.kick;
    activeModel.position.set(px, py, pz);
    activeModel.rotation.x = state.kick * 2.2 - reloadDip * 0.55 - dip * 0.9;
    activeModel.rotation.z = ads ? 0 : 0.02;
    flash.visible = state.flash > 0;
    if (state.flash > 0) flash.rotation.z = state.flash * 40;
    flashLight.intensity = state.flash > 0 ? 16 : 0;
  }

  return {
    state,
    models,
    pendingThrows,
    step,
    currentDef() { return WEAPONS[state.weapon]; },
    ready() {
      return state.mag > 0 && state.cooldown <= 0 && state.reloadLeft <= 0 && !state.switching;
    },
    pullTrigger() {
      const def = WEAPONS[state.weapon];
      state.cooldown = def.gap;
      state.flash = FLASH_TIME;
      state.kick = def.kick * 4.5;
      state.bloom = Math.min(BLOOM_MAX, state.bloom + BLOOM_PER_SHOT);
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      saveAmmo();
      return true;
    },
    reload() {
      const def = WEAPONS[state.weapon];
      if (state.reloadLeft > 0 || state.mag >= def.mag || state.reserve === 0 || state.switching) return;
      state.reloadLeft = def.reload;
    },
    spread(speed, ads, crouching) {
      const def = WEAPONS[state.weapon];
      let s = def.spreadStill + Math.min(1, speed / 5.2) * def.move;
      if (ads) s *= 0.45;
      if (crouching) s *= 0.6;
      return s + state.bloom;
    },
    refill(weaponId) {
      const def = WEAPONS[weaponId];
      if (!def || def.mag === undefined) return;
      ammo[weaponId] = { mag: def.mag, reserve: def.reserve };
      if (weaponId === state.weapon) loadAmmo(weaponId);
    },
    switchTo(id) {
      if (!GUNS.includes(id)) return false;
      if (id === state.weapon) {
        if (!state.switching) return false;
        // A switch away is in flight; cancel it and stay on this weapon.
        pendingWeapon = null;
        state.switching = false;
        state.switchT = 0;
        state.reloadLeft = 0;
        return true;
      }
      // Retargeting mid-switch restarts the dip so the newest request always wins
      // (a buy/round-reset that arrives during a switch used to be silently dropped).
      pendingWeapon = id;
      state.switching = true;
      state.switchT = 0;
      state.reloadLeft = 0;
      return true;
    },
    // Grenade throw: decrements the count, pushes a live frag to game state.
    // from/dir are world-space; gameState defaults to the rig's bound state.
    throw(kind, from, dir) {
      if (kind === 'frag' && state.fragCount <= 0) return false;
      if (kind === 'smoke' && state.smokeCount <= 0) return false;
      if (kind === 'frag') state.fragCount -= 1;
      if (kind === 'smoke') state.smokeCount -= 1;
      const def = WEAPONS[kind];
      const entry = {
        pos: from.clone(),
        vel: dir.clone().normalize().multiplyScalar(THROW_SPEED).add(_v.set(0, THROW_UP, 0)),
        t: 0, fuse: def.fuse || 1.6, kind,
      };
      if (gameState && gameState.frags) gameState.frags.push(entry);
      else pendingThrows.push(entry);
      return true;
    },
    addThrowables(kind, n) {
      if (kind === 'frag') state.fragCount += n;
      if (kind === 'smoke') state.smokeCount += n;
    },
    resetAmmo() {
      for (const id of GUNS) ammo[id] = { mag: 0, reserve: 0 };
      ammo.pistol = { mag: WEAPONS.pistol.mag, reserve: WEAPONS.pistol.reserve };
      loadAmmo(state.weapon);
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.bloom = 0;
      state.switching = false;
      state.switchT = 0;
      pendingWeapon = null;
    },
  };
}
