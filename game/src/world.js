// "Yard 7" — decommissioned orbital foundry yard, dusk. Boxes only, no textures,
// no external assets. Every box is a collider and a surface bullets stop on.
// Bounds x -32..32, z -22..22, walls h=5. A = furnace hall NW, B = dock NE.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Nav graph: undirected edges, listed both ways. Hold points are defender waits.
const WAYPOINTS = [
  { id: 'spawnV', x: 0, z: 18, edges: ['mid1', 'alongA1', 'alongB1'] },
  { id: 'spawnS', x: 0, z: -8, edges: ['mid3', 'holdMid'] },
  { id: 'mid1', x: 0, z: 10, edges: ['spawnV', 'mid2', 'alongA1', 'alongB1'] },
  { id: 'mid2', x: 0, z: 0, edges: ['mid1', 'mid3', 'linkW', 'linkE'] },
  { id: 'mid3', x: 0, z: -8, edges: ['mid2', 'spawnS', 'holdMid'] },
  { id: 'alongA1', x: -20, z: 10, edges: ['spawnV', 'alongA2', 'mid1'] },
  { id: 'alongA2', x: -20, z: 0, edges: ['alongA1', 'alongA3', 'linkW'] },
  { id: 'alongA3', x: -20, z: -10, edges: ['alongA2', 'siteA', 'holdA1'] },
  { id: 'alongB1', x: 20, z: 10, edges: ['spawnV', 'alongB2', 'mid1'] },
  { id: 'alongB2', x: 20, z: 0, edges: ['alongB1', 'alongB3', 'linkE'] },
  { id: 'alongB3', x: 20, z: -10, edges: ['alongB2', 'siteB', 'holdB1'] },
  { id: 'linkW', x: -12, z: 0, edges: ['mid2', 'alongA2'] },
  { id: 'linkE', x: 12, z: 0, edges: ['mid2', 'alongB2'] },
  { id: 'siteA', x: -22, z: -14, edges: ['alongA3', 'holdA1', 'holdA2', 'platA'] },
  { id: 'siteB', x: 22, z: -14, edges: ['alongB3', 'holdB1', 'holdB2'] },
  { id: 'holdA1', x: -18, z: -10, edges: ['siteA', 'alongA3'] },
  { id: 'holdA2', x: -26, z: -10, edges: ['siteA'] },
  { id: 'holdB1', x: 18, z: -10, edges: ['siteB', 'alongB3'] },
  { id: 'holdB2', x: 26, z: -10, edges: ['siteB'] },
  { id: 'holdMid', x: -3, z: -4, edges: ['mid3', 'spawnS'] },
  { id: 'platA', x: -22, z: -16, edges: ['siteA'] },
];

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);
  scene.background = new THREE.Color(PALETTE.canvas);
  scene.fog = new THREE.Fog(new THREE.Color('#2b333d'), 48, 115);

  // Dusk sky dome: procedural vertical gradient (indigo -> violet -> amber
  // horizon) + a low sun disc, so the top half of the frame reads as dusk
  // instead of flat dark. CanvasTexture is generated at runtime; no assets.
  function skyTexture() {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 512;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0.0, '#141a2e');
    grad.addColorStop(0.45, '#3a3050');
    grad.addColorStop(0.68, '#8a4a3a');
    grad.addColorStop(0.78, '#e08a3c');
    grad.addColorStop(0.86, '#5a3a28');
    grad.addColorStop(1.0, '#1a232b');
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 512);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(110, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false }),
  );
  group.add(skyDome);
  // Low sun disc + halo, set low in the north-west sky so it sits in the
  // spawn view down mid, where the cover shots look.
  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(7, 32),
    new THREE.MeshBasicMaterial({ color: 0xffd9a0, fog: false }),
  );
  sunDisc.position.set(-58, 15, -88);
  sunDisc.lookAt(0, 2, 0);
  group.add(sunDisc);
  const sunHalo = new THREE.Mesh(
    new THREE.CircleGeometry(15, 32),
    new THREE.MeshBasicMaterial({ color: 0xe08a3c, transparent: true, opacity: 0.28, fog: false }),
  );
  sunHalo.position.set(-58, 15, -88);
  sunHalo.lookAt(0, 2, 0);
  group.add(sunHalo);

  // Glowing site letters (A amber, B blue) floating above each site, so the
  // map reads at a glance from any lane.
  function letterTexture(letter, color) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const g = c.getContext('2d');
    g.font = 'bold 190px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = color;
    g.shadowBlur = 28;
    g.fillStyle = color;
    g.fillText(letter, 128, 136);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  function siteLetter(letter, color, x, z) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(2.8, 2.8),
      new THREE.MeshBasicMaterial({ map: letterTexture(letter, color), transparent: true, side: THREE.DoubleSide, depthWrite: false }),
    );
    m.position.set(x, 4.2, z);
    group.add(m);
    return m;
  }
  const letterA = siteLetter('A', '#f0a830', -22, -14);
  const letterB = siteLetter('B', '#4da6ff', 22, -14);

  const mats = {};
  for (const name of Object.keys(PALETTE)) {
    mats[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' ? 0.55 : 0.92,
      metalness: 0.04,
    });
  }
  // Furnace face: hot amber emissive, animated in update().
  const furnaceMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#3a2a12'),
    emissive: new THREE.Color(PALETTE.accent),
    emissiveIntensity: 1.2,
    roughness: 0.6,
    metalness: 0.2,
  });

  const colliders = [];
  const shootables = [];

  function box(w, h, d, x, y, z, mat, collide) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide !== false) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  // Floor + perimeter walls (h=5).
  box(64.4, 0.4, 44.4, 0, -0.2, 0, mats.canvas);
  box(0.4, 5, 44.4, -32.2, 2.5, 0, mats.surface);
  box(0.4, 5, 44.4, 32.2, 2.5, 0, mats.surface);
  box(64.4, 5, 0.4, 0, 2.5, -22.2, mats.surface);
  box(64.4, 5, 0.4, 0, 2.5, 22.2, mats.surface);

  // A-long containers (west lane runs x~-20; containers sit off-lane at x=-25).
  box(3, 2.4, 6, -25, 1.2, 2, mats.hairline);
  box(3, 2.4, 6, -25, 1.2, -6, mats.muted);
  box(3, 2.4, 6, -25, 1.2, -14, mats.hairline);
  // B-long containers (east lane x~20; off-lane at x=25).
  box(3, 2.4, 6, 25, 1.2, 2, mats.muted);
  box(3, 2.4, 6, 25, 1.2, -6, mats.hairline);
  box(3, 2.4, 6, 25, 1.2, -14, mats.muted);

  // Mid cover: crates off the central lane so mid1/mid2/mid3 stay clear.
  box(1.6, 1.6, 1.6, -6, 0.8, 4, mats.hairline);
  box(1.6, 1.6, 1.6, -6, 2.4, 4, mats.surface);
  box(1.6, 1.6, 1.6, 6, 0.8, 6, mats.hairline);
  box(1.2, 1.2, 1.2, -6, 0.6, -2, mats.surface);
  box(1.4, 1.4, 1.4, 6, 0.7, -2, mats.hairline);
  box(1.6, 1.6, 1.6, -5, 0.8, 15, mats.hairline);
  box(1.6, 1.6, 1.6, 5, 0.8, 15, mats.surface);
  box(1.6, 1.6, 1.6, -5, 0.8, -11, mats.hairline);
  box(1.6, 1.6, 1.6, 5, 0.8, -11, mats.surface);

  // Mid-link doorways: walls at x=+-12 with a 4m gap at z=0 (linkW/linkE).
  box(0.4, 2.2, 5, -12, 1.1, -4.5, mats.surface);
  box(0.4, 2.2, 5, -12, 1.1, 4.5, mats.surface);
  box(0.4, 2.2, 5, 12, 1.1, -4.5, mats.surface);
  box(0.4, 2.2, 5, 12, 1.1, 4.5, mats.surface);

  // A site: furnace hall. Raised platform (h=1.2) + 4-step stair on its south edge.
  box(8, 1.2, 6, -22, 0.6, -16, mats.surface);
  box(3, 0.3, 0.8, -22, 0.15, -12.4, mats.hairline);
  box(3, 0.6, 0.8, -22, 0.3, -12.9, mats.hairline);
  box(3, 0.9, 0.8, -22, 0.45, -13.4, mats.hairline);
  // Furnace block + chimney against the NW wall, glow light above the platform.
  box(3, 2, 2.5, -27, 1.0, -18, furnaceMat);
  box(1, 5, 1, -27, 2.5, -18, mats.hairline);
  box(1.6, 1.6, 1.6, -17, 0.8, -18, mats.hairline);
  // A hall side walls with a door gap at z -16..-12.
  box(0.4, 3, 4, -14, 1.5, -18, mats.surface);
  box(0.4, 3, 4, -14, 1.5, -10, mats.surface);

  // B site: loading dock crates, kept off siteB (22,-14).
  box(2, 1.2, 2, 26, 0.6, -17, mats.hairline);
  box(1.6, 1.6, 1.6, 19, 0.8, -18, mats.surface);
  box(1.6, 1.6, 1.6, 19, 2.4, -18, mats.hairline);
  box(2.4, 1.2, 1.2, 27, 0.6, -11, mats.surface);
  box(1.2, 1.2, 1.2, 24, 0.6, -19.5, mats.hairline);

  // Pipes along the north and south walls.
  box(20, 0.6, 0.6, 0, 0.3, -20.5, mats.hairline);
  box(16, 0.6, 0.6, -8, 0.3, 20.5, mats.hairline);

  // Painted ground markings (flat, non-colliding): tinted site zones, a mid
  // lane stripe, and hazard strips flanking the mid-link door gaps.
  const zoneA = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.siteA), transparent: true, opacity: 0.14, roughness: 0.9 });
  const zoneB = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.siteB), transparent: true, opacity: 0.14, roughness: 0.9 });
  box(8, 0.02, 6, -22, 0.01, -14, zoneA, false);
  box(8, 0.02, 6, 22, 0.01, -14, zoneB, false);
  box(0.35, 0.02, 22, 0, 0.01, 1, mats.lane, false);
  box(0.5, 0.02, 1.2, -12, 0.01, -2.6, mats.hazard, false);
  box(0.5, 0.02, 1.2, -12, 0.01, 2.6, mats.hazard, false);
  box(0.5, 0.02, 1.2, 12, 0.01, -2.6, mats.hazard, false);
  box(0.5, 0.02, 1.2, 12, 0.01, 2.6, mats.hazard, false);

  // Barrels (cylinders with box colliders) and a storage silo at the north
  // edge, kept clear of every waypoint so bot routes stay open.
  const barrelGeo = new THREE.CylinderGeometry(0.55, 0.55, 1.3, 12);
  const barrelRust = new THREE.MeshStandardMaterial({ color: 0x7a4a22, roughness: 0.7, metalness: 0.3 });
  const barrelGreen = new THREE.MeshStandardMaterial({ color: 0x2e4a3a, roughness: 0.7, metalness: 0.3 });
  function barrel(x, z, mat) {
    const m = new THREE.Mesh(barrelGeo, mat);
    m.position.set(x, 0.65, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    colliders.push(new THREE.Box3().setFromObject(m));
    shootables.push(m);
  }
  barrel(-8, 8, barrelRust);
  barrel(-8.9, 8.6, barrelGreen);
  barrel(9, 9, barrelGreen);
  barrel(9.9, 8.4, barrelRust);
  barrel(-27, 4, barrelGreen);
  barrel(27, 6, barrelRust);
  box(2.2, 5.5, 2.2, -8, 2.75, -20.5, mats.hairline);
  box(2.2, 0.4, 2.2, -8, 5.7, -20.5, mats.surface);

  // Floodlight mast over the B dock: emissive head + a cool point light so
  // the east side stops reading as a black void.
  const headMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xbfd9ff, emissiveIntensity: 2.2 });
  box(0.22, 6.5, 0.22, 28, 3.25, -19, mats.hairline);
  box(0.9, 0.3, 0.4, 28, 6.5, -19, headMat);
  const dockLight = new THREE.PointLight(new THREE.Color('#9cc4ff'), 1.6, 22, 2);
  dockLight.position.set(26, 6, -17);
  scene.add(dockLight);

  // Light: cool hemisphere, warm low sun with shadows, amber furnace point light.
  const sky = new THREE.HemisphereLight(new THREE.Color(PALETTE.muted), new THREE.Color(PALETTE.canvas), 1.7);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffe0b0'), 3.2);
  sun.position.set(18, 26, 10);
  sun.target.position.set(0, 0, -3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -36;
  sun.shadow.camera.right = 36;
  sun.shadow.camera.top = 36;
  sun.shadow.camera.bottom = -36;
  sun.shadow.camera.far = 80;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.muted), 0.9);
  fill.position.set(-10, 9, 12);
  scene.add(fill);
  const furnaceLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 2.0, 20, 2);
  furnaceLight.position.set(-22, 2.6, -15);
  scene.add(furnaceLight);

  // Push a feet-anchored AABB out of any intersecting collider along the
  // smallest-penetration axis. Bots call this after integrating their move.
  // Low steps (top within 0.45m of the feet) are climbed onto instead of
  // treated as walls, so bots can use the furnace-platform stairs.
  const probe = new THREE.Box3();
  const STEP = 0.45;
  function collideMove(pos, radius, height) {
    let hit = false;
    probe.min.set(pos.x - radius, pos.y, pos.z - radius);
    probe.max.set(pos.x + radius, pos.y + height, pos.z + radius);
    for (const c of colliders) {
      if (!probe.intersectsBox(c)) continue;
      hit = true;
      const ox = Math.min(probe.max.x - c.min.x, c.max.x - probe.min.x);
      const oy = Math.min(probe.max.y - c.min.y, c.max.y - probe.min.y);
      const oz = Math.min(probe.max.z - c.min.z, c.max.z - probe.min.z);
      if (c.max.y > pos.y && c.max.y - pos.y <= STEP) {
        pos.y = c.max.y;
      } else if (oy <= ox && oy <= oz) {
        pos.y += (probe.min.y + probe.max.y) / 2 < (c.min.y + c.max.y) / 2 ? -oy : oy;
      } else if (ox <= oz) {
        pos.x += (probe.min.x + probe.max.x) / 2 < (c.min.x + c.max.x) / 2 ? -ox : ox;
      } else {
        pos.z += (probe.min.z + probe.max.z) / 2 < (c.min.z + c.max.z) / 2 ? -oz : oz;
      }
      probe.min.set(pos.x - radius, pos.y, pos.z - radius);
      probe.max.set(pos.x + radius, pos.y + height, pos.z + radius);
    }
    return hit;
  }

  let t = 0;
  function update(dt) {
    t += dt;
    furnaceLight.intensity = 1.9 + Math.sin(t * 7.3) * 0.3 + Math.sin(t * 13.7) * 0.18;
    furnaceMat.emissiveIntensity = 1.15 + Math.sin(t * 9.1) * 0.22;
    // Site beacons breathe gently so the letters catch the eye without flashing.
    const pulse = 0.85 + Math.sin(t * 2.2) * 0.15;
    letterA.material.opacity = pulse;
    letterB.material.opacity = pulse;
  }

  return {
    colliders,
    shootables,
    sites: { A: { x: -22, z: -14 }, B: { x: 22, z: -14 } },
    spawns: { vanguard: [0, 18], sentinel: [0, -8] },
    waypoints: WAYPOINTS,
    collideMove,
    update,
  };
}
