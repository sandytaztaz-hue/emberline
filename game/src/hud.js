// DOM HUD for EMBERLINE. Never touches the sim; main.js pushes values in.
// Every write is cached: the DOM is touched only when a value changes.
import { BUY_ITEMS } from './rounds.js';

const COPY = {
  start: { title: 'EMBERLINE', copy: 'A round-based tactical FPS. Plant the charge at A or B — 5v1 against the Sentinel bots in the Yard 7 foundry.', action: 'Click to play' },
  paused: { title: 'Paused', copy: 'Click to resume.', action: 'Resume' },
};

function reasonText(reason) {
  if (reason === 'elimination') return 'Enemy team eliminated.';
  if (reason === 'timeout') return 'Time expired before the plant.';
  if (reason === 'explode') return 'The charge detonated.';
  if (reason === 'defuse') return 'The charge was defused.';
  return '';
}

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const healthBar = $('health-bar');
  const healthNum = $('health-num');
  const armorNum = $('armor-num');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const ammoBox = $('ammo');
  const weaponName = $('weapon-name');
  const moneyEl = $('money');
  const timerEl = $('timer');
  const scoreV = $('score-v');
  const scoreS = $('score-s');
  const aliveV = $('alive-v');
  const aliveS = $('alive-s');
  const killfeed = $('killfeed');
  const bombEl = $('bomb-status');
  const buyMenu = $('buy-menu');
  const buyRows = $('buy-rows');
  const overlay = $('overlay');
  const overlayTitle = $('overlay-title');
  const overlayCopy = $('overlay-copy');
  const aboutEl = $('about');
  const playBtn = $('play');
  const vignette = $('damage-vignette');
  const lowhp = $('lowhp');

  const rows = BUY_ITEMS.map((item) => {
    const row = document.createElement('div');
    row.className = 'buy-row';
    const key = document.createElement('span');
    key.className = 'buy-key';
    key.textContent = item.key;
    const name = document.createElement('span');
    name.className = 'buy-name';
    name.textContent = item.name;
    const price = document.createElement('span');
    price.className = 'buy-price';
    price.textContent = item.price === 0 ? 'OWNED' : '$' + item.price;
    const stateEl = document.createElement('span');
    stateEl.className = 'buy-state';
    row.append(key, name, price, stateEl);
    buyRows.appendChild(row);
    return { item, row, stateEl };
  });

  let lastHealth = -1;
  let lastArmor = -1;
  let lastMag = -1;
  let lastReserve = -1;
  let lastWeapon = '';
  let lastMoney = -1;
  let lastTimer = '';
  let lastScore = '';
  let lastAlive = '';
  let lastBomb = '';
  let lastGap = -1;
  let lastBuy = '';
  let lastOverlay = '';
  let hitTimer = 0;
  let dmgTimer = 0;

  return {
    setHealth(hp) {
      const v = Math.max(0, Math.ceil(hp));
      if (v === lastHealth) return;
      lastHealth = v;
      healthNum.textContent = String(v);
      healthBar.style.width = v + '%';
      healthBar.classList.toggle('low', v <= 30);
      lowhp.classList.toggle('on', v > 0 && v <= 30);
    },
    setArmor(v) {
      const n = Math.max(0, Math.ceil(v));
      if (n === lastArmor) return;
      lastArmor = n;
      armorNum.textContent = String(n);
    },
    setAmmo(mag, reserve) {
      if (mag === lastMag && reserve === lastReserve) return;
      lastMag = mag;
      lastReserve = reserve;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = '/ ' + reserve;
      ammoBox.classList.toggle('empty', mag === 0);
    },
    setWeapon(name) {
      if (name === lastWeapon) return;
      lastWeapon = name;
      weaponName.textContent = name;
    },
    setMoney(v) {
      if (v === lastMoney) return;
      lastMoney = v;
      moneyEl.textContent = '$' + v;
    },
    setTimer(sec) {
      const s = Math.max(0, Math.ceil(sec));
      const text = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
      if (text === lastTimer) return;
      lastTimer = text;
      timerEl.textContent = text;
    },
    setScore(v, s) {
      const text = v + '-' + s;
      if (text === lastScore) return;
      lastScore = text;
      scoreV.textContent = String(v);
      scoreS.textContent = String(s);
    },
    setAlive(v, s) {
      const text = v + '-' + s;
      if (text === lastAlive) return;
      lastAlive = text;
      aliveV.textContent = String(v);
      aliveS.textContent = String(s);
    },
    feed(text) {
      const line = document.createElement('div');
      line.className = 'feed-line';
      line.textContent = text;
      killfeed.appendChild(line);
      while (killfeed.children.length > 5) killfeed.removeChild(killfeed.firstChild);
    },
    clearFeed() {
      killfeed.textContent = '';
    },
    showBuy(open, money, owned) {
      const sig = (open ? '1' : '0') + '|' + money + '|' + owned.rifle + owned.smg + owned.sniper + owned.pistol + owned.frag + owned.smoke + owned.armor;
      if (sig === lastBuy) return;
      lastBuy = sig;
      buyMenu.hidden = !open;
      if (!open) return;
      for (const r of rows) {
        const it = r.item;
        let st = '';
        if (it.id === 'frag' || it.id === 'smoke') st = owned[it.id] > 0 ? 'x' + owned[it.id] : '';
        else if (owned[it.id]) st = 'OWNED';
        else if (money < it.price) st = '—';
        r.stateEl.textContent = st;
        r.row.classList.toggle('owned', st === 'OWNED' || st.startsWith('x'));
        r.row.classList.toggle('cant', money < it.price && !owned[it.id] && it.price > 0);
      }
    },
    showOverlay(mode, data) {
      const sig = mode + '|' + JSON.stringify(data || null);
      if (sig === lastOverlay) return;
      lastOverlay = sig;
      if (!mode) { overlay.hidden = true; return; }
      let title = '';
      let copy = '';
      let action = '';
      if (mode === 'start' || mode === 'paused') {
        title = COPY[mode].title;
        copy = COPY[mode].copy;
        action = COPY[mode].action;
      } else if (mode === 'roundEnd') {
        const win = data && data.winner === 'vanguard';
        title = win ? 'VANGUARD WINS THE ROUND' : 'SENTINEL WINS THE ROUND';
        copy = reasonText(data && data.reason) + ' Score ' + (data ? data.score.vanguard : 0) + '–' + (data ? data.score.sentinel : 0) + '.';
        action = '';
      } else if (mode === 'matchEnd') {
        const win = data && data.winner === 'vanguard';
        title = win ? 'VANGUARD TAKES THE MATCH' : 'SENTINEL TAKES THE MATCH';
        copy = 'Final score ' + (data ? data.score.vanguard : 0) + '–' + (data ? data.score.sentinel : 0) + '.';
        action = 'Play again';
      }
      overlayTitle.textContent = title;
      overlayCopy.textContent = copy;
      aboutEl.hidden = mode !== 'start';
      playBtn.hidden = action === '';
      playBtn.textContent = action;
      overlay.hidden = false;
      if (!playBtn.hidden) playBtn.focus();
    },
    hideOverlay() {
      lastOverlay = 'null|null';
      overlay.hidden = true;
    },
    onPlay(handler) {
      playBtn.addEventListener('click', handler);
    },
    hitmarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', !!killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFlash() {
      vignette.classList.add('on');
      clearTimeout(dmgTimer);
      dmgTimer = setTimeout(() => vignette.classList.remove('on'), 180);
    },
    setBomb(text) {
      if (text === lastBomb) return;
      lastBomb = text;
      bombEl.textContent = text;
    },
    setCrosshair(spread) {
      const gap = Math.max(3, Math.min(30, Math.round(3 + spread * 500)));
      if (gap === lastGap) return;
      lastGap = gap;
      crosshair.style.setProperty('--gap', gap + 'px');
    },
  };
}
