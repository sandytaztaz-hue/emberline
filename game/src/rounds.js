// Round flow for EMBERLINE: phase machine, economy, buy menu, plant/defuse.
// Owns timers and win checks; main.js renders and feeds it input.
import { WEAPONS } from './weapons.js';

export const BUY_ITEMS = [
  { key: '1', id: 'rifle', name: 'VK-47 Rifle', price: 2700 },
  { key: '2', id: 'smg', name: 'Kestrel-9 SMG', price: 1500 },
  { key: '3', id: 'sniper', name: 'Lance .50 Sniper', price: 4750 },
  { key: '4', id: 'pistol', name: 'P9 Sidearm', price: 0 },
  { key: '5', id: 'frag', name: 'FRAG-2 Grenade', price: 300 },
  { key: '6', id: 'smoke', name: 'SMK-1 Smoke', price: 300 },
  { key: '7', id: 'armor', name: 'Combat Armor', price: 650 },
];

const BUY_TIME = 15;
const LIVE_TIME = 100;
const FUSE_TIME = 40;
const END_TIME = 4;
const PLANT_TIME = 3;
const DEFUSE_TIME = 5;
const PLANT_RANGE = 2.2;
const DEFUSE_RANGE = 1.6;
const WIN_SCORE = 7;
const MAX_ROUNDS = 13;
const SITES = { A: { x: -22, z: -14 }, B: { x: 22, z: -14 } };
const SPAWN_V = { x: 0, z: 18 };
const SPAWN_S = { x: 0, z: -8 };
const BOT_OFF = [[-2, 0], [2, 0], [-4, 2], [4, 2], [0, 3]];
const EMPTY_KEYS = new Set();

export function createRounds(state, hooks = {}) {
  const owned = { rifle: false, smg: false, sniper: false, pistol: true, frag: 0, smoke: 0, armor: false };
  const prevKeys = new Set();
  const api = { owned, buyOpen: true, resetCount: 0, step, registerKill, registerDeath, restartMatch, resetRound };

  function pushFeed(text) {
    state.feed.push({ text, t: state.time });
    while (state.feed.length > 5) state.feed.shift();
  }

  function aliveSentinels() {
    let n = 0;
    for (const b of state.bots) if (b.alive) n += 1;
    return n;
  }

  function siteNear(x, z, range) {
    for (const id of ['A', 'B']) {
      const s = SITES[id];
      const dx = x - s.x;
      const dz = z - s.z;
      if (dx * dx + dz * dz <= range * range) return id;
    }
    return null;
  }

  function buy(item) {
    const p = state.player;
    if (item.id === 'pistol') { p.weapon = 'pistol'; return true; }
    if (item.id === 'armor') {
      if (p.armor >= 100 || state.money < item.price) return false;
      state.money -= item.price;
      p.armor = 100;
      owned.armor = true;
      return true;
    }
    if (item.id === 'frag' || item.id === 'smoke') {
      if (owned[item.id] >= 2 || state.money < item.price) return false;
      state.money -= item.price;
      owned[item.id] += 1;
      return true;
    }
    if (owned[item.id]) { p.weapon = item.id; return true; }
    if (state.money < item.price) return false;
    state.money -= item.price;
    owned[item.id] = true;
    p.weapon = item.id;
    return true;
  }

  function onKey(key) {
    if (state.phase !== 'buy') return;
    if (key === 'KeyB') { api.buyOpen = !api.buyOpen; return; }
    if (key.startsWith('Digit')) {
      const i = Number(key.slice(5)) - 1;
      if (i >= 0 && i < BUY_ITEMS.length) buy(BUY_ITEMS[i]);
    }
  }

  function plantStep(dt, keys) {
    const b = state.bomb;
    const p = state.player;
    if (!p.alive || b.state !== 'carried' || b.carrier !== 'player') { b.plantT = 0; return; }
    const site = siteNear(p.pos.x, p.pos.z, PLANT_RANGE);
    const speed = Math.hypot(p.vel.x, p.vel.z);
    if (!site || !keys.has('KeyE') || speed > 0.5) { b.plantT = 0; return; }
    b.plantT += dt;
    if (b.plantT < PLANT_TIME) return;
    b.state = 'planted';
    b.site = site;
    b.fuse = FUSE_TIME;
    b.plantT = 0;
    state.phase = 'planted';
    state.roundTime = FUSE_TIME;
    state.money += 300;
    state.stats.plants += 1;
    pushFeed('Charge planted at site ' + site);
    if (hooks.onPlant) hooks.onPlant({ site });
  }

  function defuseStep(dt) {
    const b = state.bomb;
    const site = SITES[b.site];
    if (!site) return;
    let defusing = false;
    for (const bot of state.bots) {
      if (!bot.alive || bot.mode !== 'defuse') continue;
      const dx = bot.pos.x - site.x;
      const dz = bot.pos.z - site.z;
      if (dx * dx + dz * dz <= DEFUSE_RANGE * DEFUSE_RANGE) { defusing = true; break; }
    }
    if (!defusing) { b.defuseT = 0; return; }
    b.defuseT += dt;
    if (b.defuseT < DEFUSE_TIME) return;
    b.state = 'defused';
    b.defuseT = 0;
    state.stats.defuses += 1;
    pushFeed('Charge defused');
    if (hooks.onDefuse) hooks.onDefuse({ site: b.site });
    endRound('sentinel', 'defuse');
  }

  function endRound(winner, reason) {
    if (state.phase === 'roundEnd' || state.phase === 'matchEnd') return;
    api.keptAlive = state.player.alive;
    state.score[winner] += 1;
    if (winner === 'vanguard') {
      state.money += 3250;
      state.losses = 0;
    } else {
      state.money += Math.min(1900 + 500 * state.losses, 2900);
      state.losses += 1;
    }
    state.phase = 'roundEnd';
    state.roundTime = END_TIME;
    api.buyOpen = false;
    state.bomb.plantT = 0;
    state.bomb.defuseT = 0;
    pushFeed(winner === 'vanguard' ? 'Vanguard wins the round' : 'Sentinel wins the round');
    if (hooks.onRoundEnd) hooks.onRoundEnd({ winner, reason, score: { vanguard: state.score.vanguard, sentinel: state.score.sentinel }, round: state.round });
  }

  function nextRound() {
    const v = state.score.vanguard;
    const s = state.score.sentinel;
    if (v >= WIN_SCORE || s >= WIN_SCORE || state.round >= MAX_ROUNDS) {
      state.phase = 'matchEnd';
      state.roundTime = 0;
      api.buyOpen = false;
      const winner = v >= s ? 'vanguard' : 'sentinel';
      if (hooks.onMatchEnd) hooks.onMatchEnd({ winner, score: { vanguard: v, sentinel: s } });
      return;
    }
    state.round += 1;
    resetRound();
  }

  function resetRound() {
    const p = state.player;
    const kept = api.keptAlive !== false;
    if (!kept) {
      owned.rifle = false;
      owned.smg = false;
      owned.sniper = false;
      owned.frag = 0;
      owned.smoke = 0;
      owned.armor = false;
      p.armor = 0;
      p.weapon = 'pistol';
    }
    p.pos.set(SPAWN_V.x, 0, SPAWN_V.z);
    p.vel.set(0, 0, 0);
    p.yaw = 0;
    p.pitch = 0;
    p.hp = 100;
    p.alive = true;
    p.crouching = false;
    p.onGround = true;
    state.bots.forEach((bot, i) => {
      const o = BOT_OFF[i % BOT_OFF.length];
      bot.pos.set(SPAWN_S.x + o[0], 0, SPAWN_S.z + o[1]);
      bot.yaw = Math.PI;
      bot.hp = 100;
      bot.alive = true;
      bot.mode = 'route';
      bot.wp = 0;
      bot.path = [];
      bot.target = null;
      bot.reactT = 0;
      bot.burstLeft = 0;
      bot.fireT = 0;
      bot.weapon = state.round >= 3 ? 'rifle' : 'smg';
    });
    state.bomb.state = 'carried';
    state.bomb.site = null;
    state.bomb.plantT = 0;
    state.bomb.defuseT = 0;
    state.bomb.fuse = 0;
    state.bomb.carrier = 'player';
    state.shots.length = 0;
    state.smokes.length = 0;
    state.frags.length = 0;
    state.noise.length = 0;
    state.phase = 'buy';
    state.roundTime = BUY_TIME;
    api.buyOpen = true;
    api.keptAlive = true;
    api.resetCount += 1;
  }

  // NOTE: stats.kills is incremented by combat.fireWeapon on the killing shot;
  // registerKill only pays the bounty + feed so a kill is never counted twice.
  function registerKill(target) {
    state.money += 300;
    const id = target && target.id !== undefined ? target.id : '';
    pushFeed('You eliminated Sentinel ' + id);
    if (hooks.onKill) hooks.onKill({ target, money: state.money });
  }

  function registerDeath(killer) {
    state.stats.deaths += 1;
    pushFeed(killer ? 'Sentinel ' + killer.id + ' eliminated you' : 'You were eliminated');
  }

  function restartMatch() {
    state.score.vanguard = 0;
    state.score.sentinel = 0;
    state.round = 1;
    state.money = 800;
    state.losses = 0;
    state.stats.kills = 0;
    state.stats.deaths = 0;
    state.stats.plants = 0;
    state.stats.defuses = 0;
    state.stats.shotsFired = 0;
    state.stats.shotsHit = 0;
    state.feed.length = 0;
    api.keptAlive = false;
    resetRound();
  }

  function step(dt, input) {
    const keys = (input && input.keys) || EMPTY_KEYS;
    state.time += dt;
    for (const k of keys) if (!prevKeys.has(k)) onKey(k);
    prevKeys.clear();
    for (const k of keys) prevKeys.add(k);
    if (state.phase === 'buy') {
      state.roundTime -= dt;
      if (state.roundTime <= 0) {
        state.phase = 'live';
        state.roundTime = LIVE_TIME;
        api.buyOpen = false;
      }
      return;
    }
    if (state.phase === 'live') {
      state.roundTime -= dt;
      plantStep(dt, keys);
      if (state.phase !== 'live') return;
      if (aliveSentinels() === 0) { endRound('vanguard', 'elimination'); return; }
      if (!state.player.alive) { endRound('sentinel', 'elimination'); return; }
      if (state.roundTime <= 0) endRound('sentinel', 'timeout');
      return;
    }
    if (state.phase === 'planted') {
      state.bomb.fuse -= dt;
      state.roundTime = Math.max(0, state.bomb.fuse);
      defuseStep(dt);
      if (state.phase !== 'planted') return;
      if (state.bomb.fuse <= 0) {
        state.bomb.state = 'exploded';
        if (hooks.onExplode) hooks.onExplode();
        endRound('vanguard', 'explode');
      }
      return;
    }
    if (state.phase === 'roundEnd') {
      state.roundTime -= dt;
      if (state.roundTime <= 0) nextRound();
    }
  }

  return api;
}
