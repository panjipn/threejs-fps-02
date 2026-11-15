// Axis-separated AABB collision for anything that walks the map: the player and every bot
// share this one mover, so a wall never swallows anyone and nobody duplicates the test.
// A body is { position: Vector3 (feet), velocity: Vector3, radius, height, onGround }.
import * as THREE from 'three';

const GRAVITY = 20;

export function createPhysics(colliders) {
  const probe = new THREE.Box3();

  function overlaps(x, y, z, radius, height, lift) {
    probe.min.set(x - radius, y + lift, z - radius);
    probe.max.set(x + radius, y + height - lift, z + radius);
    for (let i = 0; i < colliders.length; i += 1) {
      if (probe.intersectsBox(colliders[i])) return colliders[i];
    }
    return null;
  }

  // Move one body for dt. Horizontal axes resolve one at a time (so sliding along a wall
  // works); the vertical axis lands on the floor or the top of a crate. Returns nothing.
  function move(body, dt) {
    body.velocity.y -= GRAVITY * dt;
    const nextX = body.position.x + body.velocity.x * dt;
    if (!overlaps(nextX, body.position.y, body.position.z, body.radius, body.height, 0.04)) {
      body.position.x = nextX;
    } else {
      body.velocity.x = 0;
    }
    const nextZ = body.position.z + body.velocity.z * dt;
    if (!overlaps(body.position.x, body.position.y, nextZ, body.radius, body.height, 0.04)) {
      body.position.z = nextZ;
    } else {
      body.velocity.z = 0;
    }
    body.position.y += body.velocity.y * dt;
    body.onGround = false;
    const hit = overlaps(body.position.x, body.position.y, body.position.z, body.radius, body.height, 0);
    if (hit && body.velocity.y <= 0) {
      body.position.y = hit.max.y;
      body.velocity.y = 0;
      body.onGround = true;
    } else if (hit) {
      body.position.y = hit.min.y - body.height;
      body.velocity.y = 0;
    }
    if (body.position.y < 0) {
      body.position.y = 0;
      body.velocity.y = 0;
      body.onGround = true;
    }
    if (body.velocity.y < -30) body.velocity.y = -30;
  }

  return { move, overlaps };
}
