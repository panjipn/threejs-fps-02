// Shooting, grenades and the charge: the raycasts, the damage, and the things you see when
// a shot lands. Tracers and impact sparks come from fixed pools, so a firefight allocates
// nothing per frame. Smoke clouds block sight (bots and the player's own line checks) but
// never bullets; a flash blinds whoever faces it.
import * as THREE from 'three';
import { damageAt, GRENADES } from './weapons.js';
import { PALETTE } from './palette.js';

const TRACER_POOL = 24;
const IMPACT_POOL = 16;

export function createCombat(scene, world, hooks) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 90;
  const dir = new THREE.Vector3();
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const tmpC = new THREE.Vector3();

  // Tracer pool: one line each, reused.
  const tracers = [];
  for (let i = 0; i < TRACER_POOL; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0 }));
    line.frustumCulled = false;
    line.visible = false;
    scene.add(line);
    tracers.push({ line, ttl: 0 });
  }
  let tracerNext = 0;
  function spawnTracer(from, to) {
    const tracer = tracers[tracerNext];
    tracerNext = (tracerNext + 1) % TRACER_POOL;
    const attr = tracer.line.geometry.getAttribute('position');
    attr.setXYZ(0, from.x, from.y, from.z);
    attr.setXYZ(1, to.x, to.y, to.z);
    attr.needsUpdate = true;
    tracer.line.material.opacity = 0.85;
    tracer.line.visible = true;
    tracer.ttl = 0.09;
  }

  // Impact pool: small spheres that pop and fade.
  const impacts = [];
  const impactMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0 });
  for (let i = 0; i < IMPACT_POOL; i += 1) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), impactMat.clone());
    mesh.visible = false;
    scene.add(mesh);
    impacts.push({ mesh, ttl: 0 });
  }
  let impactNext = 0;
  function spawnImpact(point) {
    const impact = impacts[impactNext];
    impactNext = (impactNext + 1) % IMPACT_POOL;
    impact.mesh.position.copy(point);
    impact.mesh.scale.setScalar(1);
    impact.mesh.material.opacity = 0.95;
    impact.mesh.visible = true;
    impact.ttl = 0.16;
  }

  const smokeClouds = [];
  const smokeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.muted), transparent: true, opacity: 0.55, roughness: 1, depthWrite: false });
  const grenades = [];

  function segmentHitsSmoke(a, b) {
    for (const cloud of smokeClouds) {
      if (cloud.ttl <= 0) continue;
      tmpA.copy(b).sub(a);
      tmpB.copy(cloud.pos).sub(a);
      const lenSq = tmpA.lengthSq();
      const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, tmpB.dot(tmpA) / lenSq));
      tmpC.copy(a).addScaledVector(tmpA, t);
      if (tmpC.distanceTo(cloud.pos) < cloud.radius) return true;
    }
    return false;
  }

  function hasLineOfSight(a, b) {
    dir.copy(b).sub(a);
    const distance = dir.length();
    if (distance < 0.01) return true;
    dir.normalize();
    raycaster.set(a, dir);
    raycaster.far = distance;
    if (raycaster.intersectObjects(world.shootables, false).length > 0) return false;
    return !segmentHitsSmoke(a, b);
  }

  // The player's shot: one ray per pellet against the world and every living bot.
  // `spread` is the shooter's current spread, worked out by the caller.
  function shootPlayer(origin, direction, weaponState, bots, random, spread) {
    const def = weaponState.def;
    let anyHit = false;
    let killed = false;
    for (let p = 0; p < def.pellets; p += 1) {
      dir.copy(direction);
      dir.x += (random() * 2 - 1) * spread;
      dir.y += (random() * 2 - 1) * spread;
      dir.z += (random() * 2 - 1) * spread;
      dir.normalize();
      raycaster.set(origin, dir);
      raycaster.far = 90;
      const targets = [];
      for (const bot of bots) if (bot.alive) targets.push(...bot.hitMeshes);
      const hits = raycaster.intersectObjects(world.shootables.concat(targets), false);
      const hit = hits[0];
      if (!hit) continue;
      spawnTracer(origin, hit.point);
      if (hit.object.userData.bot) {
        const bot = hit.object.userData.bot;
        const amount = damageAt(def, hit.distance, hit.object.userData.part);
        if (hooks.damageBot(bot, amount, hit.object.userData.part, 'player')) killed = true;
        anyHit = true;
      } else {
        spawnImpact(hit.point);
      }
    }
    return { hit: anyHit, killed };
  }

  // A bot's shot at a target: the world can stop it, and the spread plus an aim error by
  // skill decides whether the round finds the body at that range. The aim error grows
  // with distance, so a bot is dangerous up close but a stationary player at long range
  // has time to react and take cover. Damage lands on the target, never on bystanders.
  function shootBot(bot, target, targetPoint, weaponState, random) {
    const def = weaponState.def;
    tmpA.copy(bot.muzzleWorld());
    dir.copy(targetPoint).sub(tmpA);
    const distance = dir.length();
    dir.normalize();
    const spread = weaponState.spread(bot.speed, false, false);
    const aimError = (1.3 - bot.ai.skill) * 1.2 * (0.5 + distance / 30);
    const deviation = (random() * 2 - 1) * (spread * distance + aimError);
    const hit = Math.abs(deviation) < 0.42;
    raycaster.set(tmpA, dir);
    raycaster.far = distance;
    let blocked = false;
    if (raycaster.intersectObjects(world.shootables, false).length > 0) blocked = true;
    const end = tmpB.copy(targetPoint);
    if (hit && !blocked) {
      tmpC.copy(targetPoint).addScaledVector(dir, deviation);
      end.copy(tmpC);
    }
    spawnTracer(tmpA, end);
    if (hit && !blocked) {
      const part = deviation < 0.12 ? 'head' : 'torso';
      const amount = damageAt(def, distance, part);
      if (target.kind === 'player') hooks.damagePlayer(amount, bot);
      else hooks.damageBot(target.ref, amount, part, bot);
      return true;
    }
    return false;
  }

  function throwGrenade(from, direction, kind, owner) {
    const def = GRENADES[kind];
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 10, 8),
      new THREE.MeshStandardMaterial({ color: kind === 'smoke' ? 0x9aa4ae : kind === 'flash' ? 0xffe9a8 : 0x3a464f, roughness: 0.5, metalness: 0.4 }),
    );
    mesh.position.copy(from);
    scene.add(mesh);
    const velocity = direction.clone().multiplyScalar(13);
    velocity.y += 4.5;
    grenades.push({ mesh, velocity, kind, def, owner, fuse: 1.6, bounced: 0 });
    hooks.audio.grenadePin();
  }

  function detonate(grenade) {
    const pos = grenade.mesh.position;
    scene.remove(grenade.mesh);
    hooks.audio.explosion();
    hooks.addNoise(pos, 26);
    if (grenade.kind === 'frag') {
      spawnImpact(pos);
      hooks.radialDamage(pos, grenade.def.radius, grenade.def.damage, grenade.owner);
    } else if (grenade.kind === 'smoke') {
      const group = new THREE.Group();
      for (let i = 0; i < 7; i += 1) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(1.6, 10, 8), smokeMat.clone());
        puff.position.set((Math.random() * 2 - 1) * 2.2, 1 + Math.random() * 1.4, (Math.random() * 2 - 1) * 2.2);
        group.add(puff);
      }
      group.position.copy(pos);
      group.position.y = 0;
      scene.add(group);
      smokeClouds.push({ pos: pos.clone(), radius: grenade.def.radius, ttl: grenade.def.duration, group });
    } else if (grenade.kind === 'flash') {
      hooks.flashEffect(pos, grenade.owner);
    }
  }

  function step(dt) {
    for (const tracer of tracers) {
      if (tracer.ttl <= 0) continue;
      tracer.ttl -= dt;
      tracer.line.material.opacity = Math.max(0, tracer.ttl / 0.09) * 0.85;
      if (tracer.ttl <= 0) tracer.line.visible = false;
    }
    for (const impact of impacts) {
      if (impact.ttl <= 0) continue;
      impact.ttl -= dt;
      impact.mesh.scale.setScalar(1 + (0.16 - impact.ttl) * 14);
      impact.mesh.material.opacity = Math.max(0, impact.ttl / 0.16) * 0.95;
      if (impact.ttl <= 0) impact.mesh.visible = false;
    }
    for (let i = grenades.length - 1; i >= 0; i -= 1) {
      const g = grenades[i];
      g.velocity.y -= 20 * dt;
      g.mesh.position.addScaledVector(g.velocity, dt);
      if (g.mesh.position.y < 0.09) {
        g.mesh.position.y = 0.09;
        if (Math.abs(g.velocity.y) > 2 && g.bounced < 2) {
          g.velocity.y *= -0.35;
          g.velocity.x *= 0.6;
          g.velocity.z *= 0.6;
          g.bounced += 1;
        } else {
          g.velocity.set(0, 0, 0);
        }
      }
      g.fuse -= dt;
      if (g.fuse <= 0) {
        detonate(g);
        grenades.splice(i, 1);
      }
    }
    for (let i = smokeClouds.length - 1; i >= 0; i -= 1) {
      const cloud = smokeClouds[i];
      cloud.ttl -= dt;
      cloud.group.traverse((child) => {
        if (child.isMesh) child.material.opacity = Math.max(0, Math.min(0.55, cloud.ttl * 0.08));
      });
      if (cloud.ttl <= 0) {
        scene.remove(cloud.group);
        smokeClouds.splice(i, 1);
      }
    }
  }

  return {
    shootPlayer,
    shootBot,
    throwGrenade,
    hasLineOfSight,
    segmentHitsSmoke,
    step,
    clear() {
      for (const g of grenades) scene.remove(g.mesh);
      grenades.length = 0;
      for (const cloud of smokeClouds) scene.remove(cloud.group);
      smokeClouds.length = 0;
    },
  };
}
