// The match: rounds, phases, the charge, and who wins. One state machine, owned here.
// Phases: menu -> buy (15 s freeze, buy menu open) -> live (100 s) -> end (banner) ->
// next round, or matchEnd at first to 8. The charge starts on a Vanguard bot's back; if
// that bot dies it drops, and the player or another Vanguard picks it up to plant.
import * as THREE from 'three';
import { findRoute } from './world.js';

const FIRST_TO = 8;
const MAX_ROUNDS = 15;
const BUY_SECONDS = 15;
const ROUND_SECONDS = 100;
const PLANT_SECONDS = 3;
const BOMB_SECONDS = 35;
const DEFUSE_SECONDS = 5;
const END_SECONDS = 4.5;

export function createMatch(ctx) {
  const { world, bots, player, economy, audio, hud, combat } = ctx;
  const share = new THREE.Vector3();

  const state = {
    phase: 'menu',
    round: 0,
    phaseTime: 0,
    roundTime: ROUND_SECONDS,
    score: { vanguard: 0, wardens: 0 },
    winner: null,
    reason: '',
    lossStreak: 0,
  };
  const bomb = {
    state: 'idle', // idle | carried | dropped | planted
    carrier: null, // a bot, or the string 'player'
    site: null,
    dropPos: null,
    timer: BOMB_SECONDS,
    plantProgress: 0,
    lastBeep: -1,
  };

  function teamName(team) {
    return team === 'vanguard' ? 'Vanguard' : 'Wardens';
  }

  function feedKill(killerName, killerTeam, victimName, victimTeam, headshot) {
    hud.feed(`<b class="${killerTeam}">${killerName}</b> ▸ <b class="${victimTeam}">${victimName}</b>${headshot ? ' <b>◎</b>' : ''}`);
  }

  function startRound() {
    state.round += 1;
    state.phase = 'buy';
    state.phaseTime = BUY_SECONDS;
    state.roundTime = ROUND_SECONDS;
    state.winner = null;
    state.reason = '';
    bomb.state = 'carried';
    bomb.carrier = null;
    bomb.site = null;
    bomb.dropPos = null;
    bomb.timer = BOMB_SECONDS;
    bomb.plantProgress = 0;
    bomb.lastBeep = -1;
    combat.clear();
    player.reset(world.spawns.vanguard[4]);
    bots.reset(state.round, ctx.rng);
    const carrier = bots.bots.find((b) => b.ai.isCarrier);
    if (carrier) {
      bomb.carrier = carrier;
      bomb.site = carrier.ai.site;
    }
    hud.setRound(state.round, FIRST_TO);
    hud.setScore(state.score.vanguard, state.score.wardens);
    hud.setHealth(100);
    hud.hideBanner();
    hud.hideBomb();
    hud.hidePlant();
    hud.openBuy(economy.state.money, economy.state.owned, economy.state.grenades, economy.state.armor);
    hud.setTimer(BUY_SECONDS);
  }

  function startMatch() {
    state.score = { vanguard: 0, wardens: 0 };
    state.round = 0;
    economy.reset();
    startRound();
  }

  function endRound(winner, reason) {
    if (state.phase === 'end' || state.phase === 'matchEnd') return;
    state.phase = 'end';
    state.phaseTime = END_SECONDS;
    state.winner = winner;
    state.reason = reason;
    state.score[winner] += 1;
    const playerWon = winner === 'vanguard';
    economy.roundEnd(playerWon);
    hud.closeBuy();
    hud.hidePlant();
    hud.setScore(state.score.vanguard, state.score.wardens);
    hud.setMoney(economy.state.money);
    const reasonText = {
      elimination: `${teamName(winner)} wiped out the other team`,
      detonation: 'The charge detonated at the site',
      defusal: 'The Wardens defused the charge',
      time: 'Time ran out — the charge never went off',
    }[reason];
    const big = playerWon ? 'ROUND WON' : 'ROUND LOST';
    hud.showBanner(big, `${reasonText}. Vanguard ${state.score.vanguard} — ${state.score.wardens} Wardens.`, playerWon ? 'win' : 'lose');
    if (playerWon) audio.roundWin();
    else audio.roundLose();
  }

  function endMatch() {
    state.phase = 'matchEnd';
    hud.closeBuy();
    hud.hideBanner();
    const winner = state.score.vanguard > state.score.wardens ? 'vanguard' : 'wardens';
    const playerWon = winner === 'vanguard';
    hud.showOverlay('matchEnd', playerWon
      ? `Vanguard takes the match ${state.score.vanguard} — ${state.score.wardens}. The yard is yours.`
      : `Wardens take the match ${state.score.wardens} — ${state.score.vanguard}. The yard holds.`);
    if (playerWon) audio.roundWin();
    else audio.roundLose();
  }

  function plantBomb(siteId, carrier) {
    bomb.state = 'planted';
    bomb.site = siteId;
    bomb.timer = BOMB_SECONDS;
    bomb.lastBeep = -1;
    hud.showBomb(siteId, BOMB_SECONDS);
    audio.plantBeep(true);
    addNoise(world.sites[siteId === 'A' ? 0 : 1].center, 30);
    hud.feed(`<b class="vanguard">${carrier === 'player' ? 'You' : carrier.name}</b> planted the charge at Site ${siteId}`);
  }

  function defuseBomb(bot) {
    if (bomb.state !== 'planted') return;
    bomb.state = 'idle';
    hud.hideBomb();
    hud.feed(`<b class="wardens">${bot.name}</b> defused the charge`);
    endRound('wardens', 'defusal');
  }

  function dropBomb(pos) {
    bomb.state = 'dropped';
    bomb.carrier = null;
    bomb.dropPos = pos.clone();
    bomb.plantProgress = 0;
  }

  function damageBot(bot, amount, part, attacker) {
    if (!bot.alive) return false;
    bot.health -= amount;
    if (bot.health > 0) return false;
    bot.alive = false;
    bot.health = 0;
    bot.group.rotation.x = -1.35;
    bot.group.position.y = 0.25;
    const killerName = attacker === 'player' ? 'You' : attacker.name;
    const killerTeam = attacker === 'player' ? 'vanguard' : attacker.team;
    feedKill(killerName, killerTeam, bot.name, bot.team, part === 'head');
    if (attacker === 'player') {
      economy.addKill();
      hud.setMoney(economy.state.money);
      audio.hit(true);
      hud.hitMarker(true);
    }
    if (bot.ai.isCarrier && bomb.carrier === bot) {
      bot.ai.isCarrier = false;
      dropBomb(bot.body.position);
      hud.feed('The charge dropped — pick it up.');
    }
    return true;
  }

  function damagePlayer(amount, attacker) {
    if (!player.state.alive) return;
    if (economy.state.armor) amount *= 0.5;
    player.state.health -= amount;
    hud.setHealth(player.state.health);
    hud.damageFlash();
    audio.hurt();
    if (player.state.health > 0) return;
    player.state.health = 0;
    player.state.alive = false;
    feedKill(attacker.name, attacker.team, 'You', 'vanguard', false);
    hud.showBanner('YOU ARE DOWN', 'Your team fights on — next round you are back.', 'lose');
    if (bomb.carrier === 'player') dropBomb(player.state.body.position);
  }

  function radialDamage(pos, radius, damage, owner) {
    // Distance falloff; a wall between the blast and the victim halves it.
    const all = [{ kind: 'player', pos: player.state.body.position, alive: player.state.alive }];
    for (const bot of bots.bots) all.push({ kind: 'bot', ref: bot, pos: bot.body.position, alive: bot.alive });
    for (const entry of all) {
      if (!entry.alive) continue;
      share.copy(entry.pos);
      share.y += 1;
      const dist = share.distanceTo(pos);
      if (dist > radius) continue;
      let amount = damage * (1 - dist / radius * 0.7);
      if (!combat.hasLineOfSight(pos, share)) amount *= 0.5;
      if (entry.kind === 'player') damagePlayer(amount, { name: 'Blast', team: owner === 'player' ? 'vanguard' : 'wardens' });
      else damageBot(entry.ref, amount, 'torso', owner === 'player' ? 'player' : { name: 'Blast', team: 'wardens' });
    }
  }

  function flashEffect(pos, owner) {
    // The player: blinded when facing the pop, scaled by distance and angle.
    if (player.state.alive) {
      share.copy(pos).sub(player.state.body.position);
      const dist = share.length();
      if (dist < 18) {
        share.normalize();
        const forward = new THREE.Vector3(-Math.sin(player.state.yaw), 0, -Math.cos(player.state.yaw));
        const facing = share.dot(forward);
        if (facing > 0.2 && combat.hasLineOfSight(player.state.body.position, pos)) {
          hud.flashWhite((1 - dist / 18) * facing);
        }
      }
    }
    for (const bot of bots.bots) {
      if (!bot.alive) continue;
      share.copy(pos).sub(bot.body.position);
      const dist = share.length();
      if (dist > 18) continue;
      share.normalize();
      const facing = share.dot(new THREE.Vector3(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw)));
      if (facing > 0.2) bot.ai.blindUntil = ctx.now + 2.5;
    }
  }

  function addNoise(pos, radius) {
    for (const bot of bots.bots) {
      if (!bot.alive || bot.ai.mode === 'engage') continue;
      if (bot.body.position.distanceTo(pos) > radius) continue;
      bot.ai.route = findRoute(world.waypoints, bot.body.position, pos);
      bot.ai.routePos = 0;
      bot.ai.mode = 'route';
      bot.ai.holdUntil = ctx.now + 3;
    }
  }

  function checkWin(now) {
    if (state.phase !== 'live') return;
    const counts = bots.aliveCounts();
    const vanguardAlive = counts.vanguard + (player.state.alive ? 1 : 0);
    const wardensAlive = counts.wardens;
    if (bomb.state === 'planted') return; // only detonation or defusal ends it now
    if (wardensAlive === 0) endRound('vanguard', 'elimination');
    else if (vanguardAlive === 0) endRound('wardens', 'elimination');
  }

  function step(dt, input, now) {
    ctx.now = now;
    if (state.phase === 'buy') {
      state.phaseTime -= dt;
      hud.setTimer(state.phaseTime);
      if (state.phaseTime <= 0) {
        state.phase = 'live';
        state.roundTime = ROUND_SECONDS;
        hud.closeBuy();
        hud.setTimer(ROUND_SECONDS);
      }
      return;
    }
    if (state.phase === 'end') {
      state.phaseTime -= dt;
      if (state.phaseTime <= 0) {
        hud.hideBanner();
        if (state.score.vanguard >= FIRST_TO || state.score.wardens >= FIRST_TO || state.round >= MAX_ROUNDS) endMatch();
        else startRound();
      }
      return;
    }
    if (state.phase !== 'live') return;

    // The player planting: hold E inside a site while carrying the charge.
    if (bomb.state === 'carried' && bomb.carrier === 'player' && player.state.alive) {
      const site = world.sites.find((s) => player.state.body.position.distanceTo(s.center) < s.radius);
      if (site && input.state.keys.has('KeyE')) {
        bomb.plantProgress += dt;
        hud.showPlant('PLANTING CHARGE…', bomb.plantProgress / PLANT_SECONDS);
        if (bomb.plantProgress >= PLANT_SECONDS) {
          hud.hidePlant();
          plantBomb(site.id, 'player');
        }
      } else {
        bomb.plantProgress = 0;
        hud.hidePlant();
      }
    }
    // The player picking up a dropped charge.
    if (bomb.state === 'dropped' && player.state.alive && bomb.dropPos) {
      if (player.state.body.position.distanceTo(bomb.dropPos) < 1.5) {
        bomb.state = 'carried';
        bomb.carrier = 'player';
        bomb.dropPos = null;
        hud.feed('You picked up the charge — plant it at Site A or B.');
      }
    }

    if (bomb.state === 'planted') {
      bomb.timer -= dt;
      const second = Math.ceil(bomb.timer);
      if (second !== bomb.lastBeep) {
        bomb.lastBeep = second;
        audio.plantBeep(false);
      }
      hud.showBomb(bomb.site, bomb.timer);
      hud.setTimer(bomb.timer);
      if (bomb.timer <= 0) {
        audio.explosion();
        const site = world.sites[bomb.site === 'A' ? 0 : 1];
        radialDamage(new THREE.Vector3(site.center.x, 1, site.center.z), 14, 200, 'bomb');
        bomb.state = 'idle';
        hud.hideBomb();
        endRound('vanguard', 'detonation');
        return;
      }
    } else {
      state.roundTime -= dt;
      hud.setTimer(state.roundTime);
      if (state.roundTime <= 0) {
        endRound('wardens', 'time');
        return;
      }
    }
    checkWin(now);
  }

  return {
    state,
    bomb,
    startMatch,
    startRound,
    endRound,
    step,
    plantBomb,
    defuseBomb,
    damageBot,
    damagePlayer,
    radialDamage,
    flashEffect,
    addNoise,
    isBuyPhase() {
      return state.phase === 'buy';
    },
    isLive() {
      return state.phase === 'live';
    },
  };
}
