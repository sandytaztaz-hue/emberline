// Player movement: accel/friction/gravity/jump, resolved as an AABB against the
// world colliders one axis at a time. Operates on the shared player object from
// state.js (pos/vel), so main.js wires one object through state and player.
import * as THREE from 'three';

const RADIUS = 0.34;
const STAND_H = 1.72;
const CROUCH_H = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const WALK = 5.2;
const CROUCH_SPEED = 2.4;
const ACCEL_GROUND = 42;
const ACCEL_AIR = 9;
const FRICTION = 9;
const GRAVITY = 20;
const JUMP = 6.2;
const STEP_UP = 0.45;

export function createPlayer(colliders, playerObj) {
  const p = playerObj;
  const probe = new THREE.Box3();
  const wish = new THREE.Vector3();

  // lift trims the probe top/bottom so standing on the floor is not read as
  // walking into a wall, and low steps do not snag the feet.
  function overlaps(x, y, z, height, lift) {
    probe.min.set(x - RADIUS, y + lift, z - RADIUS);
    probe.max.set(x + RADIUS, y + height - lift, z + RADIUS);
    for (const c of colliders) if (probe.intersectsBox(c)) return c;
    return null;
  }

  function look(dx, dy, sensitivity) {
    p.yaw -= dx * (sensitivity || 0.0022);
    p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch - dy * (sensitivity || 0.0022)));
  }

  function recoil(pitchKick, yawKick) {
    p.pitch = Math.min(1.45, p.pitch + pitchKick);
    p.yaw += yawKick;
  }

  function step(dt, keys, ads) {
    p.ads = !!ads;
    const crouchKey = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (crouchKey && !p.crouching) {
      p.crouching = true;
      p.height = CROUCH_H;
    } else if (!crouchKey && p.crouching && !overlaps(p.pos.x, p.pos.y, p.pos.z, STAND_H, 0.02)) {
      p.crouching = false;
      p.height = STAND_H;
    }
    const eyeTarget = p.crouching ? CROUCH_EYE : STAND_EYE;
    p.eye += (eyeTarget - p.eye) * Math.min(1, dt * 12);

    const fwd = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const str = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    wish.set(0, 0, 0);
    if (fwd || str) {
      const sin = Math.sin(p.yaw);
      const cos = Math.cos(p.yaw);
      wish.set(-sin * fwd + cos * str, 0, -cos * fwd - sin * str).normalize();
    }

    let speed = p.crouching ? CROUCH_SPEED : WALK;
    if (p.ads) speed *= 0.65;
    const blend = Math.min(1, (p.onGround ? ACCEL_GROUND : ACCEL_AIR) * dt / speed);
    p.vel.x += (wish.x * speed - p.vel.x) * blend;
    p.vel.z += (wish.z * speed - p.vel.z) * blend;
    if (p.onGround && !wish.lengthSq()) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      p.vel.x *= damp;
      p.vel.z *= damp;
    }

    if (keys.has('Space') && p.onGround) {
      p.vel.y = JUMP;
      p.onGround = false;
    }
    p.vel.y -= GRAVITY * dt;

    // Axis-separated moves; a blocked horizontal step tries a small step-up
    // first (lets the player walk up the furnace-platform stairs).
    const nx = p.pos.x + p.vel.x * dt;
    if (!overlaps(nx, p.pos.y, p.pos.z, p.height, 0.04)) p.pos.x = nx;
    else if (!overlaps(nx, p.pos.y + STEP_UP, p.pos.z, p.height, 0.04)) {
      p.pos.x = nx;
      p.pos.y += STEP_UP;
    } else p.vel.x = 0;
    const nz = p.pos.z + p.vel.z * dt;
    if (!overlaps(p.pos.x, p.pos.y, nz, p.height, 0.04)) p.pos.z = nz;
    else if (!overlaps(p.pos.x, p.pos.y + STEP_UP, nz, p.height, 0.04)) {
      p.pos.z = nz;
      p.pos.y += STEP_UP;
    } else p.vel.z = 0;

    p.pos.y += p.vel.y * dt;
    p.onGround = false;
    const hit = overlaps(p.pos.x, p.pos.y, p.pos.z, p.height, 0);
    if (hit && p.vel.y <= 0) {
      p.pos.y = hit.max.y;
      p.vel.y = 0;
      p.onGround = true;
    } else if (hit) {
      p.pos.y = hit.min.y - p.height;
      p.vel.y = 0;
    }
    if (p.pos.y < 0) {
      p.pos.y = 0;
      p.vel.y = 0;
      p.onGround = true;
    }
    p.vel.y = Math.max(-30, p.vel.y);
  }

  return {
    state: p,
    step,
    look,
    recoil,
    groundSpeed() {
      return Math.hypot(p.vel.x, p.vel.z);
    },
  };
}
