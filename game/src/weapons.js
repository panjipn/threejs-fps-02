// The armoury: five guns and three grenades. Each gun owns its numbers — damage, magazine,
// fire gap, reload, spread — and a small state machine (cooldown, reload). Bots run the
// state machine without a view model; the player gets one too, built from boxes.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  p9: { id: 'p9', name: 'P9 Sidearm', kind: 'pistol', price: 0, damage: 34, headMult: 4, mag: 12, reserve: 36, gap: 0.14, reload: 1.3, spreadStill: 0.004, spreadMove: 0.02, auto: false, pellets: 1, barrel: 0.22, colour: 'hairline' },
  vex9: { id: 'vex9', name: 'Vex-9 SMG', kind: 'smg', price: 1500, damage: 26, headMult: 4, mag: 28, reserve: 84, gap: 0.075, reload: 1.7, spreadStill: 0.006, spreadMove: 0.022, auto: true, pellets: 1, barrel: 0.3, colour: 'ink' },
  ar77: { id: 'ar77', name: 'AR-77 Kite', kind: 'rifle', price: 2700, damage: 33, headMult: 4, mag: 30, reserve: 90, gap: 0.1, reload: 1.9, spreadStill: 0.0025, spreadMove: 0.028, auto: true, pellets: 1, barrel: 0.42, colour: 'ink' },
  longbow: { id: 'longbow', name: 'Longbow DMR', kind: 'dmr', price: 3300, damage: 71, headMult: 4, mag: 10, reserve: 30, gap: 0.45, reload: 2.4, spreadStill: 0.001, spreadMove: 0.03, auto: false, pellets: 1, barrel: 0.58, colour: 'accent' },
  breach: { id: 'breach', name: 'Breach-12', kind: 'shotgun', price: 1800, damage: 9, headMult: 4, mag: 6, reserve: 24, gap: 0.8, reload: 2.6, spreadStill: 0.032, spreadMove: 0.012, auto: false, pellets: 8, barrel: 0.4, colour: 'hairline' },
};

export const GRENADES = {
  frag: { id: 'frag', name: 'Sparker frag', price: 300, radius: 6, damage: 90 },
  smoke: { id: 'smoke', name: 'Veil smoke', price: 300, radius: 7, duration: 12 },
  flash: { id: 'flash', name: 'Glare flash', price: 200, radius: 18, duration: 2.5 },
};

export const BUY_LIST = [
  { key: '1', kind: 'weapon', id: 'vex9' },
  { key: '2', kind: 'weapon', id: 'ar77' },
  { key: '3', kind: 'weapon', id: 'longbow' },
  { key: '4', kind: 'weapon', id: 'breach' },
  { key: '5', kind: 'grenade', id: 'frag' },
  { key: '6', kind: 'grenade', id: 'smoke' },
  { key: '7', kind: 'grenade', id: 'flash' },
  { key: '8', kind: 'armor', id: 'armor' },
];
export const ARMOR_PRICE = 650;

// Damage falls off with range: full inside 18 m, down to 60% past 45 m.
export function damageAt(def, distance, part) {
  const falloff = distance <= 18 ? 1 : distance >= 45 ? 0.6 : 1 - (distance - 18) * (0.4 / 27);
  const partMult = part === 'head' ? def.headMult : part === 'legs' ? 0.75 : 1;
  return def.damage * falloff * partMult;
}

export function createWeaponState(id) {
  const def = WEAPONS[id];
  const state = { id, def, mag: def.mag, reserve: def.reserve, cooldown: 0, reloadLeft: 0, flash: 0, kick: 0 };
  return {
    state,
    def,
    step(dt) {
      state.cooldown = Math.max(0, state.cooldown - dt);
      state.flash = Math.max(0, state.flash - dt);
      state.kick += (0 - state.kick) * Math.min(1, dt * 14);
      if (state.reloadLeft > 0) {
        state.reloadLeft = Math.max(0, state.reloadLeft - dt);
        if (state.reloadLeft === 0) {
          const need = def.mag - state.mag;
          const take = Math.min(need, state.reserve);
          state.mag += take;
          state.reserve -= take;
        }
      }
    },
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    pullTrigger() {
      state.cooldown = def.gap;
      state.flash = 0.06;
      state.kick = 0.055;
    },
    reload() {
      if (state.reloadLeft > 0 || state.mag === def.mag || state.reserve === 0) return false;
      state.reloadLeft = def.reload;
      return true;
    },
    reloading() {
      return state.reloadLeft > 0;
    },
    spread(speed, airborne, crouching) {
      const move = Math.min(1, speed / 5.2);
      let spread = def.spreadStill + move * def.spreadMove;
      if (airborne) spread += 0.03;
      if (crouching) spread *= 0.7;
      return spread;
    },
    refill() {
      state.mag = def.mag;
      state.reserve = def.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
    },
  };
}

// The player's first-person gun: boxes on the camera, a muzzle flash and a light, kick and
// walk-bob. Rebuilt when the weapon changes; animated every frame from the weapon state.
export function createViewModel(camera) {
  const gripMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const accentMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.3 });

  const model = new THREE.Group();
  model.position.set(0.24, -0.2, -0.42);
  camera.add(model);
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.17, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  let currentId = '';
  let walkPhase = 0;

  function rebuild(id) {
    currentId = id;
    while (model.children.length > 0) model.remove(model.children[0]);
    const def = WEAPONS[id];
    const main = def.colour === 'accent' ? accentMat : def.colour === 'ink' ? bodyMat : gripMat;
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.42), main);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, def.barrel), gripMat);
    barrel.position.set(0, 0.025, -0.21 - def.barrel / 2);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.22), gripMat);
    stock.position.set(0, -0.02, 0.3);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.06), accentMat);
    sight.position.set(0, 0.075, -0.1);
    model.add(receiver, barrel, stock, sight);
    if (def.kind === 'shotgun') {
      const tube = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.34), bodyMat);
      tube.position.set(0, -0.03, -0.3);
      model.add(tube);
    }
  }

  return {
    rebuild,
    step(dt, weaponState, speed, crouching) {
      if (currentId !== weaponState.id) rebuild(weaponState.id);
      walkPhase += dt * (2 + speed * 1.6);
      const bob = Math.min(1, speed / 5.2) * (crouching ? 0.4 : 1);
      model.position.x = 0.24 + Math.sin(walkPhase) * 0.006 * bob;
      model.position.y = -0.2 + Math.abs(Math.cos(walkPhase)) * 0.008 * bob;
      model.position.z = -0.42 + weaponState.kick;
      let tilt = weaponState.kick * 2.2;
      if (weaponState.reloadLeft > 0) {
        const def = weaponState.def;
        tilt -= 0.55 * Math.min(1, (def.reload - weaponState.reloadLeft) * 2);
      }
      model.rotation.x = tilt;
      flash.visible = weaponState.flash > 0;
      flash.rotation.z = weaponState.flash * 30;
      flashLight.intensity = weaponState.flash > 0 ? 18 : 0;
    },
  };
}
