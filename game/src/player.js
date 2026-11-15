// The player's body: acceleration, friction, gravity, crouch and jump, resolved by the
// shared physics mover so the player and the bots collide with the map the same way.
import * as THREE from 'three';

const RADIUS = 0.34;
const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.4;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 9;
const FRICTION = 9;
const JUMP_SPEED = 6.2;

export function createPlayer(physics, spawn) {
  const body = {
    position: new THREE.Vector3(spawn.x, 0, spawn.z),
    velocity: new THREE.Vector3(),
    radius: RADIUS,
    height: STAND_HEIGHT,
    onGround: true,
  };
  const state = {
    body,
    yaw: 0,
    pitch: 0,
    eye: STAND_EYE,
    crouching: false,
    health: 100,
    alive: true,
  };
  const wish = new THREE.Vector3();

  return {
    state,
    team: 'vanguard',
    reset(spawnPoint, yaw = 0) {
      body.position.set(spawnPoint.x, 0, spawnPoint.z);
      body.velocity.set(0, 0, 0);
      state.yaw = yaw;
      state.pitch = 0;
      state.eye = STAND_EYE;
      state.crouching = false;
      state.health = 100;
      state.alive = true;
    },
    look(dx, dy, sensitivity = 0.0022) {
      state.yaw -= dx * sensitivity;
      state.pitch = Math.max(-1.45, Math.min(1.45, state.pitch - dy * sensitivity));
    },
    recoil(pitchKick, yawKick) {
      state.pitch = Math.min(1.45, state.pitch + pitchKick);
      state.yaw += yawKick;
    },
    groundSpeed() {
      return Math.hypot(body.velocity.x, body.velocity.z);
    },
    step(dt, keys) {
      if (!state.alive) return;
      const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
      if (crouching && !state.crouching) {
        state.crouching = true;
        body.height = CROUCH_HEIGHT;
      } else if (!crouching && state.crouching && !physics.overlaps(body.position.x, body.position.y, body.position.z, RADIUS, STAND_HEIGHT, 0.02)) {
        state.crouching = false;
        body.height = STAND_HEIGHT;
      }
      const eyeTarget = state.crouching ? CROUCH_EYE : STAND_EYE;
      state.eye += (eyeTarget - state.eye) * Math.min(1, dt * 12);

      const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
      const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
      wish.set(0, 0, 0);
      if (forward || strafe) {
        const sin = Math.sin(state.yaw);
        const cos = Math.cos(state.yaw);
        wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe).normalize();
      }
      const speed = state.crouching ? CROUCH_SPEED : WALK_SPEED;
      const blend = Math.min(1, (body.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt / speed);
      body.velocity.x += (wish.x * speed - body.velocity.x) * blend;
      body.velocity.z += (wish.z * speed - body.velocity.z) * blend;
      if (body.onGround && !wish.lengthSq()) {
        const damp = Math.max(0, 1 - FRICTION * dt);
        body.velocity.x *= damp;
        body.velocity.z *= damp;
      }
      if (keys.has('Space') && body.onGround) {
        body.velocity.y = JUMP_SPEED;
        body.onGround = false;
      }
      physics.move(body, dt);
    },
  };
}
