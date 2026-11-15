// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the display's rate.
// ?shot=start|play|buy|end with &seed=N sets up a deterministic frame for a capture, renders
// it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './rng.js';
import { createPhysics } from './physics.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { createWorld } from './world.js';
import { createPlayer } from './player.js';
import { createWeaponState, createViewModel, WEAPONS } from './weapons.js';
import { createBots } from './bots.js';
import { createCombat } from './combat.js';
import { createEconomy } from './economy.js';
import { createHud } from './hud.js';
import { createMatch } from './match.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const random = mulberry32(shot ? seed : (Date.now() % 100000) + 1);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 24, 60);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 140);
scene.add(camera);

const world = createWorld(scene);
const physics = createPhysics(world.colliders);
const player = createPlayer(physics, world.spawns.vanguard[4]);
const economy = createEconomy();
const audio = createAudio();
const hud = createHud();

// The match is built after combat; the combat hooks close over the `match` binding and only
// run once the loop starts, by which time it is assigned.
let match = null;
const combat = createCombat(scene, world, {
  audio,
  addNoise: (pos, radius) => match && match.addNoise(pos, radius),
  damageBot: (bot, amount, part, attacker) => match.damageBot(bot, amount, part, attacker),
  damagePlayer: (amount, bot) => match.damagePlayer(amount, bot),
  radialDamage: (pos, radius, damage, owner) => match.radialDamage(pos, radius, damage, owner),
  flashEffect: (pos, owner) => match.flashEffect(pos, owner),
});

const ctx = {
  world, bots: null, player, economy, audio, hud, combat, rng: random, physics, now: 0,
};
const bots = createBots(scene, world, ctx);
ctx.bots = bots;
match = createMatch(ctx);

const viewModel = createViewModel(camera);
const weaponStates = { p9: createWeaponState('p9') };
let currentWeapon = weaponStates.p9;
let selectedGrenade = 'frag';
let wasFiring = false;
let frozen = false;
let started = false;
let accumulator = 0;
let lastTime = performance.now();
let elapsed = 0;

const direction = new THREE.Vector3();
const muzzle = new THREE.Vector3();

hud.setAmmo(currentWeapon.state.mag, currentWeapon.state.reserve, currentWeapon.def.name, false);
hud.setMoney(economy.state.money);
hud.setHealth(100);
hud.setGrenades(economy.state.grenades, selectedGrenade);

const input = createInput(renderer.domElement, onLockChange);
hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (match.state.phase === 'menu' || match.state.phase === 'matchEnd') {
    match.startMatch();
    hud.hideOverlay();
  }
  input.requestLock();
});
hud.onBuy((kind, id) => buyItem(kind, id));

function buyItem(kind, id) {
  const result = economy.buy(kind, id);
  if (result === 'bought') {
    audio.buy();
    if (kind === 'weapon') {
      if (!weaponStates[id]) weaponStates[id] = createWeaponState(id);
      currentWeapon = weaponStates[id];
    }
    hud.setMoney(economy.state.money);
    hud.updateBuy(economy.state.money, economy.state.owned, economy.state.grenades, economy.state.armor);
    hud.setAmmo(currentWeapon.state.mag, currentWeapon.state.reserve, currentWeapon.def.name, false);
  } else if (result === 'poor') {
    audio.denied();
  } else {
    audio.click();
  }
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
    hud.closeBuy();
  } else if (match.state.phase === 'live' || match.state.phase === 'buy') {
    hud.showOverlay('paused');
  }
}

function syncCamera() {
  camera.position.set(player.state.body.position.x, player.state.body.position.y + player.state.eye, player.state.body.position.z);
  camera.rotation.set(player.state.pitch, player.state.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const body = player.state.body;
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + player.state.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  player.state.yaw = Math.atan2(-dx, -dz);
  player.state.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function shoot() {
  if (!currentWeapon.takeRound()) {
    audio.dryFire();
    return;
  }
  camera.getWorldDirection(direction);
  const spread = currentWeapon.spread(player.groundSpeed(), !player.state.body.onGround, player.state.crouching);
  const result = combat.shootPlayer(camera.position, direction, currentWeapon, bots.bots, random, spread);
  if (result.hit) {
    audio.hit(result.killed);
    hud.hitMarker(result.killed);
  }
  audio.shot(currentWeapon.def.kind);
  currentWeapon.pullTrigger();
  player.recoil(0.009 + random() * 0.004, (random() * 2 - 1) * 0.004);
  match.addNoise(player.state.body.position, 22);
  hud.setAmmo(currentWeapon.state.mag, currentWeapon.state.reserve, currentWeapon.def.name, false);
}

function throwSelectedGrenade() {
  const count = economy.state.grenades[selectedGrenade];
  if (count <= 0) {
    audio.denied();
    return;
  }
  economy.state.grenades[selectedGrenade] -= 1;
  camera.getWorldDirection(direction);
  muzzle.copy(camera.position).addScaledVector(direction, 0.5);
  muzzle.y -= 0.1;
  combat.throwGrenade(muzzle, direction, selectedGrenade, 'player');
  hud.setGrenades(economy.state.grenades, selectedGrenade);
}

function cycleGrenade() {
  const kinds = ['frag', 'smoke', 'flash'];
  const index = kinds.indexOf(selectedGrenade);
  for (let i = 1; i <= kinds.length; i += 1) {
    const next = kinds[(index + i) % kinds.length];
    if (economy.state.grenades[next] > 0) {
      selectedGrenade = next;
      break;
    }
  }
  hud.setGrenades(economy.state.grenades, selectedGrenade);
}

function step(dt) {
  elapsed += dt;
  ctx.now = elapsed;
  const phase = match.state.phase;
  if (phase === 'live' && player.state.alive) {
    const look = input.takeLook();
    player.look(look.x, look.y);
    player.step(dt, input.state.keys);
    // Fire: automatics hold the trigger; semi-automatics fire on the press edge.
    const firing = input.state.firing && currentWeapon.ready();
    if (firing && (currentWeapon.def.auto || !wasFiring)) shoot();
    wasFiring = input.state.firing;
    if (input.takePressed('KeyR') && currentWeapon.reload()) audio.reload();
    if (input.takePressed('Digit1')) {
      currentWeapon = weaponStates.p9;
      hud.setAmmo(currentWeapon.state.mag, currentWeapon.state.reserve, currentWeapon.def.name, false);
    }
    if (input.takePressed('Digit2')) {
      const primary = Object.keys(weaponStates).find((id) => id !== 'p9');
      if (primary) {
        currentWeapon = weaponStates[primary];
        hud.setAmmo(currentWeapon.state.mag, currentWeapon.state.reserve, currentWeapon.def.name, false);
      }
    }
    if (input.takePressed('KeyQ')) cycleGrenade();
    if (input.takePressed('KeyG')) throwSelectedGrenade();
  }
  if (input.takePressed('KeyM')) audio.toggleMute();
  if (input.takePressed('KeyB') && match.isBuyPhase()) {
    hud.openBuy(economy.state.money, economy.state.owned, economy.state.grenades, economy.state.armor);
    input.releaseLock();
  }
  if (match.isBuyPhase()) {
    for (const key of ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8']) {
      if (input.takePressed(key)) {
        const index = Number(key.slice(-1)) - 1;
        const item = [
          { kind: 'weapon', id: 'vex9' }, { kind: 'weapon', id: 'ar77' },
          { kind: 'weapon', id: 'longbow' }, { kind: 'weapon', id: 'breach' },
          { kind: 'grenade', id: 'frag' }, { kind: 'grenade', id: 'smoke' },
          { kind: 'grenade', id: 'flash' }, { kind: 'armor', id: 'armor' },
        ][index];
        if (item) buyItem(item.kind, item.id);
      }
    }
  }
  currentWeapon.step(dt);
  viewModel.step(dt, currentWeapon.state, player.groundSpeed(), player.state.crouching);
  if (phase === 'live') bots.step(dt, elapsed, player, match);
  match.step(dt, input, elapsed);
  combat.step(dt);
  world.update(elapsed);
  hud.stepFlash(dt);
  // HUD readouts, every step (cheap setters skip unchanged values).
  hud.setHealth(player.state.health);
  hud.setAmmo(currentWeapon.state.mag, currentWeapon.state.reserve, currentWeapon.def.name, currentWeapon.reloading());
  hud.crosshair(currentWeapon.spread(player.groundSpeed(), !player.state.body.onGround, player.state.crouching));
  hud.setGrenades(economy.state.grenades, selectedGrenade);
  const counts = bots.aliveCounts();
  hud.setAlive(counts.vanguard + (player.state.alive ? 1 : 0), counts.wardens);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function runShot(name) {
  // A capture never needs the pointer lock; the game is posed, rendered twice, frozen.
  match.startMatch();
  hud.hideOverlay();
  if (name === 'play') {
    match.state.phase = 'live';
    match.state.roundTime = 87;
    hud.closeBuy();
    player.state.body.position.set(3, 0, 9);
    player.state.yaw = 0;
    settle(60);
    // Aim at the nearest Warden and fire twice, so the frame shows a tracer and a
    // hit marker; then let the bots keep moving for a beat.
    const target = bots.bots.filter((b) => b.team === 'wardens' && b.alive)[0];
    if (target) {
      aimAt(new THREE.Vector3(target.body.position.x, 1.2, target.body.position.z));
      shoot();
      settle(8);
      shoot();
      settle(10);
    }
    hud.setTimer(87);
  } else if (name === 'buy') {
    player.state.body.position.set(0, 0, 14);
    player.state.yaw = 0;
    economy.state.money = 4700;
    buyItem('weapon', 'ar77');
    hud.setMoney(economy.state.money);
    hud.openBuy(economy.state.money, economy.state.owned, economy.state.grenades, economy.state.armor);
    settle(40);
    aimAt(new THREE.Vector3(0, 1.5, -4));
    hud.setTimer(12);
  } else if (name === 'end') {
    match.state.phase = 'live';
    match.state.roundTime = 60;
    hud.closeBuy();
    player.state.body.position.set(0, 0, 14);
    player.state.yaw = 0;
    settle(120);
    match.endRound('vanguard', 'elimination');
    settle(20);
  } else {
    // start: the menu over a quiet yard at spawn.
    hud.closeBuy();
    player.state.body.position.set(0.6, 0, 15.5);
    player.state.yaw = 0;
    settle(30);
    aimAt(new THREE.Vector3(0, 1.5, -4));
    hud.showOverlay('start');
    hud.setTimer(100);
  }
  hud.setScore(match.state.score.vanguard, match.state.score.wardens);
  hud.setAmmo(currentWeapon.state.mag, currentWeapon.state.reserve, currentWeapon.def.name, false);
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
