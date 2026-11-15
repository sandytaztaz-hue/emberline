// Single shared store. Plain object; rounds.js owns the phase machine, this file
// owns the shape and the round-scoped reset.
import * as THREE from 'three';

const SPAWN_V = [0, 18];
const SPAWN_S = [0, -8];
const BOT_ROLES = ['a', 'a', 'b', 'b', 'mid'];

function makeBot(id) {
  return {
    id, team: 'sentinel', role: BOT_ROLES[id],
    pos: new THREE.Vector3(SPAWN_S[0], 0, SPAWN_S[1]),
    yaw: Math.PI, hp: 100, alive: true, mode: 'hold', wp: 0, path: [],
    target: null, reactT: 0, burstLeft: 0, fireT: 0,
    weapon: 'smg', speed: 3.4,
  };
}

export function createState() {
  const state = {
    time: 0, phase: 'buy', round: 1, roundTime: 15,
    score: { vanguard: 0, sentinel: 0 },
    money: 800, losses: 0,
    bomb: { state: 'carried', site: null, plantT: 0, defuseT: 0, fuse: 0, carrier: 'player' },
    player: {
      pos: new THREE.Vector3(SPAWN_V[0], 0, SPAWN_V[1]), vel: new THREE.Vector3(),
      yaw: 0, pitch: 0, eye: 1.6, hp: 100, armor: 0, alive: true,
      crouching: false, onGround: true, height: 1.72, weapon: 'rifle', ads: false,
    },
    bots: [0, 1, 2, 3, 4].map(makeBot),
    feed: [], shots: [], smokes: [], frags: [], noise: [],
    stats: { kills: 0, deaths: 0, plants: 0, defuses: 0, shotsFired: 0, shotsHit: 0 },
  };

  // Reset round-scoped fields. Weapon/money/score survive; rounds.js repositions
  // bots to their hold points and sets buy-phase weapons after this runs.
  state.resetRound = () => {
    state.phase = 'buy';
    state.roundTime = 15;
    const b = state.bomb;
    b.state = 'carried'; b.site = null; b.plantT = 0; b.defuseT = 0; b.fuse = 0;
    b.carrier = 'player';
    const p = state.player;
    p.pos.set(SPAWN_V[0], 0, SPAWN_V[1]); p.vel.set(0, 0, 0);
    p.yaw = 0; p.pitch = 0; p.eye = 1.6; p.hp = 100; p.alive = true;
    p.crouching = false; p.onGround = true; p.height = 1.72; p.ads = false;
    for (const bot of state.bots) {
      bot.pos.set(SPAWN_S[0], 0, SPAWN_S[1]); bot.yaw = Math.PI;
      bot.hp = 100; bot.alive = true; bot.mode = 'hold'; bot.wp = 0; bot.path = [];
      bot.target = null; bot.reactT = 0; bot.burstLeft = 0; bot.fireT = 0;
    }
    state.feed.length = 0; state.shots.length = 0; state.smokes.length = 0;
    state.frags.length = 0; state.noise.length = 0;
  };

  state.aliveBots = (team) => state.bots.filter((bot) => bot.team === team && bot.alive);

  // Vanguard count includes the player; sentinel count is bots only.
  state.aliveCount = (team) => {
    let n = state.aliveBots(team).length;
    if (team === 'vanguard' && state.player.alive) n += 1;
    return n;
  };

  return state;
}
