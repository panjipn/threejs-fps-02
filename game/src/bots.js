// The nine bots: four Vanguard teammates and five Wardens. Each one walks the waypoint
// graph to its lane, holds an angle, and shoots what it can see. Perception is a field of
// view plus a line-of-sight ray against the world and the smoke; gunfire noise pulls nearby
// bots to investigate. The carrier plants, the Wardens rotate to defuse.
import * as THREE from 'three';
import { createWeaponState } from './weapons.js';
import { findRoute } from './world.js';
import { PALETTE } from './palette.js';
import { range, pick, chance } from './rng.js';

const NAMES = {
  vanguard: ['Rook', 'Pip', 'Marlowe', 'Sable'],
  wardens: ['Kestrel', 'Bram', 'Noor', 'Tamsin', 'Odo'],
};
const PERCEIVE_TICK = 0.12;
const LOS_RANGE = 42;

export function createBots(scene, world, ctx) {
  const eye = new THREE.Vector3();
  const chest = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const forward = new THREE.Vector3();

  function buildMesh(team) {
    const group = new THREE.Group();
    const teamColor = team === 'vanguard' ? PALETTE.ember : PALETTE.teal;
    const suit = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x2a3138), roughness: 0.8, metalness: 0.1 });
    const teamMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(teamColor), roughness: 0.55, metalness: 0.15 });
    const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color(0xc9a689), roughness: 0.7 });
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.78, 0.18), suit);
    legL.position.set(-0.11, 0.39, 0);
    const legR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.78, 0.18), suit);
    legR.position.set(0.11, 0.39, 0);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.72, 0.3), suit);
    torso.position.y = 1.14;
    const vest = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.4, 0.34), teamMat);
    vest.position.y = 1.18;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), skin);
    head.position.y = 1.62;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.07, 0.05), teamMat);
    visor.position.set(0, 1.64, -0.14);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.62), suit);
    gun.position.set(0.24, 1.24, -0.32);
    group.add(legL, legR, torso, vest, head, visor, gun);
    group.traverse((mesh) => {
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    return { group, legL, legR, torso, head, gun };
  }

  const bots = [];
  for (const team of ['vanguard', 'wardens']) {
    for (let i = 0; i < NAMES[team].length; i += 1) {
      const parts = buildMesh(team);
      scene.add(parts.group);
      const bot = {
        id: `${team}-${i}`,
        team,
        name: NAMES[team][i],
        parts,
        group: parts.group,
        body: { position: new THREE.Vector3(), velocity: new THREE.Vector3(), radius: 0.34, height: 1.72, onGround: true },
        health: 100,
        alive: false,
        weapon: null,
        speed: 0,
        yaw: 0,
        walkPhase: 0,
        ai: {
          mode: 'hold',
          route: [],
          routePos: 0,
          holdUntil: 0,
          holdYaw: 0,
          target: null,
          targetKind: null,
          lastSeen: new THREE.Vector3(),
          reaction: 0,
          burstLeft: 0,
          burstGap: 0,
          perceive: 0,
          plantProgress: 0,
          defuseProgress: 0,
          site: 'A',
          isCarrier: false,
          investigatePos: null,
          skill: 0.6,
        },
        hitMeshes: [],
        muzzleWorld() {
          return tmp.set(
            bot.body.position.x - Math.sin(bot.yaw) * 0.5,
            bot.body.position.y + 1.3,
            bot.body.position.z - Math.cos(bot.yaw) * 0.5,
          );
        },
      };
      parts.torso.userData = { bot, part: 'torso' };
      parts.head.userData = { bot, part: 'head' };
      parts.legL.userData = { bot, part: 'legs' };
      parts.legR.userData = { bot, part: 'legs' };
      bot.hitMeshes = [parts.torso, parts.head, parts.legL, parts.legR];
      bots.push(bot);
    }
  }

  function chestOf(bot) {
    return chest.set(bot.body.position.x, bot.body.position.y + 1.2, bot.body.position.z);
  }

  function eyeOf(bot) {
    return eye.set(bot.body.position.x, bot.body.position.y + 1.55, bot.body.position.z);
  }

  // The nearest enemy this bot can actually see: in range, inside its field of view, and
  // with a clear line past the world and the smoke.
  function perceive(bot, player, now) {
    const ai = bot.ai;
    let best = null;
    let bestDist = Infinity;
    const candidates = [];
    if (player.state.alive && player.team !== bot.team) {
      candidates.push({ kind: 'player', ref: player, pos: tmp.set(player.state.body.position.x, player.state.body.position.y + 1.2, player.state.body.position.z).clone(), dist: 0 });
    }
    for (const other of bots) {
      if (!other.alive || other.team === bot.team) continue;
      candidates.push({ kind: 'bot', ref: other, pos: chestOf(other).clone(), dist: 0 });
    }
    for (const candidate of candidates) {
      candidate.dist = candidate.pos.distanceTo(eyeOf(bot));
      if (candidate.dist > LOS_RANGE || candidate.dist >= bestDist) continue;
      // Field of view: 110 degrees ahead, or 360 when the target is very close.
      tmp.copy(candidate.pos).sub(eyeOf(bot)).normalize();
      forward.set(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
      if (candidate.dist > 3 && tmp.dot(forward) < 0.25) continue;
      if (!ctx.combat.hasLineOfSight(eyeOf(bot), candidate.pos)) continue;
      // Focus fire cap: at most two bots gang up on the player at once; the rest
      // hold their angles or fight the player's teammates instead.
      if (candidate.kind === 'player' && ai.targetKind !== 'player') {
        const focusing = bots.filter((b) => b.alive && b !== bot && b.ai.mode === 'engage' && b.ai.targetKind === 'player').length;
        if (focusing >= 2) continue;
      }
      best = candidate;
      bestDist = candidate.dist;
    }
    if (best) {
      ai.target = best.ref;
      ai.targetKind = best.kind;
      ai.lastSeen.copy(best.pos);
      if (ai.mode !== 'engage') {
        ai.mode = 'engage';
        ai.reaction = range(ctx.rng, 0.5, 0.95) / ai.skill;
        ai.burstLeft = 0;
        ai.burstGap = 0;
      }
    } else if (ai.mode === 'engage') {
      // Lost sight: hold the last seen spot briefly, then go back to the route.
      ai.mode = 'route';
      ai.holdUntil = now + 1.2;
    }
    return best;
  }

  function setRoute(bot, targetPos) {
    bot.ai.route = findRoute(world.waypoints, bot.body.position, targetPos);
    bot.ai.routePos = 0;
    bot.ai.mode = 'route';
  }

  function stepBot(bot, dt, now, player, match) {
    const ai = bot.ai;
    if (!bot.alive) return;
    bot.weapon.step(dt);
    ai.perceive -= dt;
    if (ai.perceive <= 0) {
      ai.perceive = PERCEIVE_TICK;
      if (now < (ai.blindUntil || 0)) {
        ai.target = null;
        if (ai.mode === 'engage') ai.mode = 'route';
      } else {
        perceive(bot, player, now);
      }
    }

    const body = bot.body;
    let moveTarget = null;
    let wantSpeed = 0;

    if (ai.mode === 'engage' && ai.target) {
      // Face the target; fire in bursts once the reaction time has passed.
      const targetPos = ai.targetKind === 'player'
        ? tmp.set(ai.target.state.body.position.x, ai.target.state.body.position.y + 1.2, ai.target.state.body.position.z)
        : chestOf(ai.target);
      const dx = targetPos.x - body.position.x;
      const dz = targetPos.z - body.position.z;
      bot.yaw = Math.atan2(-dx, -dz);
      const blinded = now < (ai.blindUntil || 0);
      if (ai.reaction > 0) {
        ai.reaction -= dt;
      } else if (!blinded && bot.weapon.ready()) {
        if (ai.burstLeft <= 0) {
          ai.burstLeft = 2 + Math.floor(ctx.rng() * 3);
          ai.burstGap = 0;
        }
        if (ai.burstGap <= 0) {
          const hit = ctx.combat.shootBot(bot, { kind: ai.targetKind, ref: ai.target }, targetPos.clone(), bot.weapon, ctx.rng);
          if (hit) ctx.audio.shot(bot.weapon.def.kind);
          bot.weapon.takeRound();
          bot.weapon.pullTrigger();
          match.addNoise(body.position, 20);
          ai.burstLeft -= 1;
          ai.burstGap = bot.weapon.def.gap + (ai.burstLeft <= 0 ? range(ctx.rng, 0.7, 1.2) : 0);
          if (bot.weapon.state.mag === 0) bot.weapon.reload();
        } else {
          ai.burstGap -= dt;
        }
      }
      // Strafe a little while engaging so nobody stands still to be shot.
      if (ai.burstLeft <= 0) {
        moveTarget = tmp.set(body.position.x + Math.cos(bot.yaw) * 1.5, 0, body.position.z - Math.sin(bot.yaw) * 1.5);
        wantSpeed = 1.6;
      }
    } else if (ai.mode === 'route') {
      if (ai.routePos < ai.route.length) {
        const node = world.waypoints[ai.route[ai.routePos]];
        moveTarget = node.pos;
        wantSpeed = 4.1;
        if (Math.hypot(node.pos.x - body.position.x, node.pos.z - body.position.z) < 0.9) {
          ai.routePos += 1;
        }
      } else {
        ai.mode = 'hold';
        ai.holdUntil = now + range(ctx.rng, 2, 5);
        ai.holdYaw = bot.yaw;
      }
    } else if (ai.mode === 'hold') {
      bot.yaw = ai.holdYaw;
      if (now >= ai.holdUntil) {
        // Wardens rotate between their site and mid; Vanguard push on.
        if (bot.team === 'wardens') {
          const site = world.sites[ai.site === 'A' ? 0 : 1];
          setRoute(bot, site.center);
        } else {
          const site = world.sites[ai.site === 'A' ? 0 : 1];
          setRoute(bot, site.center);
        }
      }
    }

    // Objective behaviour, checked every step.
    const bomb = match.bomb;
    if (bot.team === 'vanguard' && ai.isCarrier && bomb.state === 'carried' && bomb.carrier === bot) {
      const site = world.sites[ai.site === 'A' ? 0 : 1];
      if (body.position.distanceTo(site.center) < site.radius && ai.mode !== 'engage') {
        ai.plantProgress += dt;
        if (ai.plantProgress >= 3) {
          match.plantBomb(site.id, bot);
          ai.plantProgress = 0;
        }
      } else if (ai.mode === 'hold' || ai.mode === 'route') {
        setRoute(bot, site.center);
      }
    }
    if (bot.team === 'wardens' && bomb.state === 'planted') {
      const site = world.sites[bomb.site === 'A' ? 0 : 1];
      const dist = body.position.distanceTo(site.center);
      if (dist < 2.5 && ai.mode !== 'engage') {
        ai.defuseProgress += dt;
        ctx.audio.defuseBeep();
        if (ai.defuseProgress >= 5) {
          match.defuseBomb(bot);
          ai.defuseProgress = 0;
        }
      } else if (ai.mode === 'hold' || ai.mode === 'route') {
        setRoute(bot, site.center);
      }
    }
    if (bot.team === 'vanguard' && bomb.state === 'dropped' && !bomb.carrier) {
      if (body.position.distanceTo(bomb.dropPos) < 2) {
        bomb.carrier = bot;
        bomb.state = 'carried';
        ai.isCarrier = true;
        ai.site = bot.body.position.distanceTo(world.sites[0].center) < bot.body.position.distanceTo(world.sites[1].center) ? 'A' : 'B';
        setRoute(bot, world.sites[ai.site === 'A' ? 0 : 1].center);
      } else if (ai.mode === 'hold') {
        setRoute(bot, bomb.dropPos);
      }
    }
    // Low health: fall back toward the team's spawn.
    if (bot.health < 30 && ai.mode !== 'engage' && ai.mode !== 'route') {
      const spawn = world.spawns[bot.team][0];
      setRoute(bot, spawn);
    }

    // Steering: accelerate toward the move target, or damp to a stop.
    if (moveTarget) {
      const dx = moveTarget.x - body.position.x;
      const dz = moveTarget.z - body.position.z;
      const len = Math.hypot(dx, dz) || 1;
      if (ai.mode !== 'engage') bot.yaw = Math.atan2(-dx / len, -dz / len);
      body.velocity.x += ((dx / len) * wantSpeed - body.velocity.x) * Math.min(1, dt * 6);
      body.velocity.z += ((dz / len) * wantSpeed - body.velocity.z) * Math.min(1, dt * 6);
    } else {
      body.velocity.x *= Math.max(0, 1 - dt * 8);
      body.velocity.z *= Math.max(0, 1 - dt * 8);
    }
    ctx.physics.move(body, dt);
    bot.speed = Math.hypot(body.velocity.x, body.velocity.z);

    // Pose: face the yaw, swing the legs with the walk, lean into a strafe.
    bot.group.position.copy(body.position);
    bot.group.rotation.y = bot.yaw;
    bot.walkPhase += dt * bot.speed * 2.4;
    const swing = Math.min(1, bot.speed / 4) * 0.55;
    bot.parts.legL.rotation.x = Math.sin(bot.walkPhase) * swing;
    bot.parts.legR.rotation.x = -Math.sin(bot.walkPhase) * swing;
  }

  function reset(round, rng) {
    // Weapons: a mix per team, seeded per round so no two rounds play the same.
    const vanguardLoadout = ['ar77', 'vex9', 'ar77', 'longbow'];
    const wardensLoadout = ['ar77', 'vex9', 'ar77', 'breach', 'longbow'];
    for (const bot of bots) {
      bot.alive = true;
      bot.health = 100;
      bot.ai.plantProgress = 0;
      bot.ai.defuseProgress = 0;
      bot.ai.target = null;
      bot.ai.isCarrier = false;
      bot.ai.skill = range(rng, 0.55, 0.9);
      const loadout = bot.team === 'vanguard' ? vanguardLoadout : wardensLoadout;
      const weaponId = loadout[bots.indexOf(bot) % loadout.length];
      bot.weapon = createWeaponState(weaponId);
      const spawnList = world.spawns[bot.team];
      const spawn = spawnList[bots.filter((b) => b.team === bot.team).indexOf(bot) % spawnList.length];
      bot.body.position.set(spawn.x, 0, spawn.z);
      bot.body.velocity.set(0, 0, 0);
      bot.yaw = bot.team === 'vanguard' ? 0 : Math.PI;
      bot.group.position.copy(bot.body.position);
      bot.group.rotation.set(0, bot.yaw, 0);
      bot.group.visible = true;
      bot.parts.legL.rotation.x = 0;
      bot.parts.legR.rotation.x = 0;
      // Wardens split: two hold A, two hold B, one holds mid. Vanguard pick a site.
      if (bot.team === 'wardens') {
        const index = bots.filter((b) => b.team === 'wardens').indexOf(bot);
        bot.ai.site = index < 2 ? 'A' : index < 4 ? 'B' : 'A';
        const site = world.sites[bot.ai.site === 'A' ? 0 : 1];
        const hold = index === 4 ? world.waypoints[7] : site;
        setRoute(bot, hold.center || hold.pos);
        bot.ai.holdYaw = bot.team === 'wardens' ? Math.PI : 0;
      } else {
        bot.ai.site = chance(rng, 0.5) ? 'A' : 'B';
        const site = world.sites[bot.ai.site === 'A' ? 0 : 1];
        setRoute(bot, site.center);
      }
    }
    // The carrier is one Vanguard bot; the player carries only if the bot dies and drops it.
    const carriers = bots.filter((b) => b.team === 'vanguard');
    const carrier = pick(rng, carriers);
    carrier.ai.isCarrier = true;
  }

  return {
    bots,
    reset,
    step(dt, now, player, match) {
      for (const bot of bots) stepBot(bot, dt, now, player, match);
    },
    aliveCounts() {
      let vanguard = 0;
      let wardens = 0;
      for (const bot of bots) {
        if (!bot.alive) continue;
        if (bot.team === 'vanguard') vanguard += 1;
        else wardens += 1;
      }
      return { vanguard, wardens };
    },
  };
}
