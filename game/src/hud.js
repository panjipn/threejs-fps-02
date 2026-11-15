// The DOM HUD: health, ammo, money, timer, score, kill feed, crosshair, banners, the buy
// menu and the overlays. It never touches the simulation; main.js and match.js push numbers
// in and read the play callback out.
import { WEAPONS, GRENADES, BUY_LIST, ARMOR_PRICE } from './weapons.js';

const COPY = {
  start: {
    title: 'EMBER<em>LINE</em>',
    copy: 'A tactical round-based shooter in the Foundry Yards. Vanguard plants the charge at Site A or B; the Wardens hold the yard and defuse it. Win by elimination, detonation or defusal — first to 8 rounds.',
    action: 'Click to play',
  },
  paused: {
    title: 'EMBER<em>LINE</em>',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  roundEnd: {
    title: 'Round over',
    copy: '',
    action: 'Next round',
  },
  matchEnd: {
    title: 'Match over',
    copy: '',
    action: 'Play again',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const healthFill = $('health-fill');
  const healthNum = $('health-num');
  const healthBox = $('health');
  const weaponName = $('weapon-name');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const ammoBox = $('ammo');
  const reloadLabel = $('reload-label');
  const nadesLabel = $('nades-label');
  const moneyValue = $('money-value');
  const timerEl = $('timer');
  const roundLabel = $('round-label');
  const scoreVanguard = $('score-vanguard');
  const scoreWardens = $('score-wardens');
  const aliveVanguard = $('alive-vanguard');
  const aliveWardens = $('alive-wardens');
  const feed = $('feed');
  const banner = $('banner');
  const bannerBig = $('banner-big');
  const bannerSmall = $('banner-small');
  const bombEl = $('bomb');
  const bombSite = $('bomb-site');
  const bombTimer = $('bomb-timer');
  const plantEl = $('plant');
  const plantLabel = $('plant-label');
  const plantFill = $('plant-fill');
  const hitmarker = $('hitmarker');
  const damageEl = $('damage');
  const flashEl = $('flashbang');
  const crosshair = $('crosshair');
  const buyEl = $('buy');
  const buySub = $('buy-sub');
  const buyItems = $('buy-items');

  let hitTimer = 0;
  let lastMag = -1;
  let lastReserve = -1;
  let lastHealth = -1;
  let lastMoney = -1;
  let lastTimer = '';
  let lastScore = '';
  let buyHandler = null;
  let flashFade = 0;

  function fmtTime(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  return {
    setHealth(hp) {
      const value = Math.max(0, Math.round(hp));
      if (value === lastHealth) return;
      lastHealth = value;
      healthFill.style.width = `${value}%`;
      healthNum.textContent = String(value);
      healthBox.classList.toggle('low', value <= 30);
    },
    setAmmo(mag, reserve, name, reloading) {
      if (mag !== lastMag || reserve !== lastReserve) {
        lastMag = mag;
        lastReserve = reserve;
        ammoMag.textContent = String(mag);
        ammoReserve.textContent = `/ ${reserve}`;
        ammoBox.classList.toggle('empty', mag === 0);
      }
      weaponName.textContent = name.toUpperCase();
      reloadLabel.textContent = reloading ? 'RELOADING…' : '';
    },
    setGrenades(counts, selected) {
      nadesLabel.innerHTML = `Frag <b>${counts.frag}</b> · Smoke <b>${counts.smoke}</b> · Flash <b>${counts.flash}</b> · <b>[${selected}]</b>`;
    },
    setMoney(amount) {
      if (amount === lastMoney) return;
      lastMoney = amount;
      moneyValue.textContent = `$${amount}`;
    },
    setTimer(seconds) {
      const text = fmtTime(seconds);
      if (text === lastTimer) return;
      lastTimer = text;
      timerEl.textContent = text;
      timerEl.classList.toggle('urgent', seconds <= 10);
    },
    setRound(round, firstTo) {
      roundLabel.textContent = `ROUND ${round} · FIRST TO ${firstTo}`;
    },
    setScore(vanguard, wardens) {
      const key = `${vanguard}-${wardens}`;
      if (key === lastScore) return;
      lastScore = key;
      scoreVanguard.textContent = String(vanguard);
      scoreWardens.textContent = String(wardens);
    },
    setAlive(vanguard, wardens) {
      aliveVanguard.textContent = String(vanguard);
      aliveWardens.textContent = String(wardens);
    },
    feed(html) {
      const div = document.createElement('div');
      div.innerHTML = html;
      feed.prepend(div);
      while (feed.children.length > 5) feed.removeChild(feed.lastChild);
      setTimeout(() => {
        div.style.opacity = '0.25';
      }, 5000);
    },
    hitMarker(kill, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', kill);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        hitmarker.classList.remove('on');
        hitmarker.classList.remove('kill');
      }, holdMs);
    },
    damageFlash() {
      damageEl.style.opacity = '1';
      setTimeout(() => { damageEl.style.opacity = '0'; }, 140);
    },
    flashWhite(strength) {
      flashEl.style.opacity = String(Math.min(1, strength));
      flashFade = strength;
    },
    stepFlash(dt) {
      if (flashFade <= 0) return;
      flashFade = Math.max(0, flashFade - dt * 0.6);
      flashEl.style.opacity = String(flashFade);
    },
    crosshair(spread) {
      crosshair.style.setProperty('--gap', `${Math.round(2 + spread * 260)}px`);
    },
    showBanner(big, small, cls) {
      bannerBig.textContent = big;
      bannerSmall.textContent = small;
      banner.className = cls || '';
      banner.hidden = false;
    },
    hideBanner() {
      banner.hidden = true;
    },
    showBomb(site, seconds) {
      bombEl.hidden = false;
      bombSite.textContent = site;
      bombTimer.textContent = String(Math.ceil(seconds));
    },
    hideBomb() {
      bombEl.hidden = true;
    },
    showPlant(label, progress) {
      plantEl.hidden = false;
      plantLabel.textContent = label;
      plantFill.style.width = `${Math.round(progress * 100)}%`;
    },
    hidePlant() {
      plantEl.hidden = true;
    },
    showOverlay(mode, score) {
      const text = COPY[mode];
      if (mode === 'roundEnd') {
        title.textContent = 'Round over';
        copy.textContent = score;
      } else if (mode === 'matchEnd') {
        title.textContent = 'Match over';
        copy.textContent = score;
      } else {
        title.innerHTML = text.title;
        copy.textContent = text.copy;
      }
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
    openBuy(money, owned, grenades, armor) {
      buyEl.hidden = false;
      buySub.textContent = `You have $${money}. Press a number or click. B closes.`;
      buyItems.innerHTML = '';
      for (const item of BUY_LIST) {
        const div = document.createElement('div');
        const name = item.kind === 'weapon' ? WEAPONS[item.id].name
          : item.kind === 'grenade' ? GRENADES[item.id].name : 'Plating armor';
        const price = item.kind === 'weapon' ? WEAPONS[item.id].price
          : item.kind === 'grenade' ? GRENADES[item.id].price : ARMOR_PRICE;
        const isOwned = item.kind === 'weapon' ? owned[item.id] : item.kind === 'armor' ? armor : false;
        const cant = !isOwned && money < price;
        div.className = `item${isOwned ? ' owned' : ''}${cant ? ' cant' : ''}`;
        div.innerHTML = `<span><span class="key">${item.key}</span>${name}${isOwned ? ' — owned' : ''}</span><span class="price">$${price}</span>`;
        if (!cant) {
          div.addEventListener('click', () => buyHandler && buyHandler(item.kind, item.id));
        }
        buyItems.appendChild(div);
      }
    },
    updateBuy(money, owned, grenades, armor) {
      buySub.textContent = `You have $${money}. Press a number or click. B closes.`;
      const rows = buyItems.children;
      for (let i = 0; i < rows.length; i += 1) {
        const item = BUY_LIST[i];
        const price = item.kind === 'weapon' ? WEAPONS[item.id].price
          : item.kind === 'grenade' ? GRENADES[item.id].price : ARMOR_PRICE;
        const isOwned = item.kind === 'weapon' ? owned[item.id] : item.kind === 'armor' ? armor : false;
        rows[i].classList.toggle('owned', isOwned);
        rows[i].classList.toggle('cant', !isOwned && money < price);
      }
    },
    closeBuy() {
      buyEl.hidden = true;
    },
    onBuy(handler) {
      buyHandler = handler;
    },
  };
}
