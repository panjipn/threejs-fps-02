// The map: the Foundry Yards, a 44 x 36 m industrial yard at dusk. Three lanes run north
// from the Vanguard spawn to two charge sites; the Wardens spawn behind the sites. Every
// box is a collider for players and bots and a surface a bullet stops on. The waypoint
// graph below is what the bots walk: nodes sit in open ground, edges never cross a box.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Waypoint graph: [x, z] nodes, edges by node index. Routes: spawn -> lane -> hall -> site.
const NODES = [
  [-6, 14], [0, 15], [6, 14], // 0-2 Vanguard spawn
  [-2, 8], [2, 8], // 3-4 mid entries
  [-16, 7], [16, 7], // 5-6 lane mids
  [-2, 0], [2, 0], // 7-8 Foundry Hall
  [-16, -3], [16, -3], // 9-10 lane north
  [-4, -6], [4, -6], // 11-12 hall north
  [-13, -5], [13, -5], // 13-14 site approaches
  [-14, -10], [14, -10], // 15-16 sites A and B
  [-4, -14], [4, -14], // 17-18 Wardens spawn
  [-19, -14], [19, -14], // 19-20 far corners
  [-8, 2], [8, 2], // 21-22 mid holds
];
const EDGES = [
  [0, 3], [1, 3], [1, 4], [2, 4], [0, 5], [2, 6],
  [3, 7], [4, 8], [3, 21], [4, 22], [5, 9], [6, 10],
  [7, 8], [7, 11], [8, 12], [7, 21], [8, 22],
  [9, 13], [10, 14], [9, 19], [10, 20], [9, 21], [10, 22],
  [11, 13], [12, 14], [11, 17], [12, 18], [11, 12],
  [13, 15], [14, 16], [13, 19], [14, 20], [13, 17], [14, 18],
  [15, 17], [16, 18], [17, 18], [15, 19], [16, 20],
  [5, 21], [6, 22], [5, 3], [6, 4],
];

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of ['canvas', 'surface', 'hairline', 'ink', 'muted', 'floor', 'wall', 'crate', 'container', 'pipe']) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'container' || name === 'pipe' ? 0.55 : 0.92,
      metalness: name === 'container' || name === 'pipe' ? 0.35 : 0.03,
    });
  }
  const emberMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ember), roughness: 0.6, emissive: new THREE.Color(PALETTE.ember), emissiveIntensity: 0.35 });
  const tealMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.teal), roughness: 0.6, emissive: new THREE.Color(PALETTE.teal), emissiveIntensity: 0.35 });
  const glowMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.glow), emissive: new THREE.Color(PALETTE.glow), emissiveIntensity: 1.6 });

  const colliders = [];
  const shootables = [];

  function box(w, h, d, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[material] || material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Floor and perimeter, 5 m walls, open to a dusk sky.
  box(44.4, 0.4, 36.4, 0, -0.2, 0, 'floor');
  box(0.4, 5, 36.4, -22.2, 2.5, 0, 'wall');
  box(0.4, 5, 36.4, 22.2, 2.5, 0, 'wall');
  box(44.4, 5, 0.4, 0, 2.5, -18.2, 'wall');
  box(44.4, 5, 0.4, 0, 2.5, 18.2, 'wall');

  // Painted lane lines on the floor (flat, no collision).
  function stripe(w, d, x, z, mat) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, d), mat);
    mesh.position.set(x, 0.01, z);
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  stripe(0.3, 26, -16, 1, emberMat);
  stripe(0.3, 26, 16, 1, tealMat);
  stripe(0.3, 12, 0, 12, materials.hairline);

  // The furnace at the north of the hall: the yard's landmark, glowing.
  box(4, 3.5, 3, 0, 1.75, -4, 'surface');
  const furnaceMouth = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.4, 0.2), glowMat);
  furnaceMouth.position.set(0, 1.1, -2.45);
  group.add(furnaceMouth);
  box(5.2, 0.4, 4.2, 0, 3.7, -4, 'hairline');
  // Hall pillars.
  box(1, 4.4, 1, -5, 2.2, 0, 'wall');
  box(1, 4.4, 1, 5, 2.2, 0, 'wall');
  box(1, 4.4, 1, -5, 2.2, -8, 'wall');
  box(1, 4.4, 1, 5, 2.2, -8, 'wall');

  // Containers guarding the site approaches.
  box(5, 2.6, 2.4, -9.5, 1.3, -12, 'container');
  box(5, 2.6, 2.4, 9.5, 1.3, -12, 'container');
  box(2.4, 2.6, 5, -19.5, 1.3, -7, 'container');
  box(2.4, 2.6, 5, 19.5, 1.3, -7, 'container');
  // Mid-lane crates to crouch behind.
  box(1.2, 1.1, 1.2, -3.4, 0.55, 5, 'crate');
  box(1.2, 1.1, 1.2, 3.4, 0.55, 5, 'crate');
  box(1.2, 0.7, 1.2, -3.4, 0.35, 11, 'crate');
  box(1.2, 0.7, 1.2, 3.4, 0.35, 11, 'crate');
  // Lane crates.
  box(1.2, 1.1, 1.2, -18.6, 0.55, 1, 'crate');
  box(1.2, 1.1, 1.2, -13.4, 0.55, 3, 'crate');
  box(1.2, 1.1, 1.2, 18.6, 0.55, 1, 'crate');
  box(1.2, 1.1, 1.2, 13.4, 0.55, 3, 'crate');
  box(1.2, 0.7, 1.2, -18.6, 0.35, -9, 'crate');
  box(1.2, 0.7, 1.2, 18.6, 0.35, -9, 'crate');
  // Site cover: low walls inside each site so a planted charge has somewhere to hide behind.
  box(3, 1.1, 0.6, -16.5, 0.55, -12.5, 'hairline');
  box(0.6, 1.1, 3, -11.5, 0.55, -8, 'hairline');
  box(3, 1.1, 0.6, 16.5, 0.55, -12.5, 'hairline');
  box(0.6, 1.1, 3, 11.5, 0.55, -8, 'hairline');
  // Spawn cover.
  box(2, 1.1, 1, -9, 0.55, 15.5, 'hairline');
  box(2, 1.1, 1, 9, 0.55, 15.5, 'hairline');

  // Pipes along the side walls, above head height (visual only).
  const pipeGeo = new THREE.CylinderGeometry(0.22, 0.22, 34, 10);
  for (const x of [-21.7, 21.7]) {
    const pipe = new THREE.Mesh(pipeGeo, materials.pipe);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(x, 3.6, 0);
    pipe.castShadow = true;
    group.add(pipe);
  }
  // Barrel clusters (colliders).
  const barrelGeo = new THREE.CylinderGeometry(0.45, 0.45, 1.1, 12);
  const barrelMat = materials.container;
  for (const [x, z] of [[-7, -14.5], [-6, -14.2], [7, -14.5], [6, -14.2], [-20, 12], [20, 12]]) {
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.position.set(x, 0.55, z);
    barrel.castShadow = true;
    barrel.receiveShadow = true;
    group.add(barrel);
    colliders.push(new THREE.Box3().setFromObject(barrel));
    shootables.push(barrel);
  }

  // Charge sites: a glowing floor ring, a light beam and a floating letter.
  const sites = [];
  const beacons = [];
  for (const [id, x, z, mat, css] of [['A', -14, -10, emberMat, PALETTE.ember], ['B', 14, -10, tealMat, PALETTE.teal]]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.6, 3, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(css), transparent: true, opacity: 0.75, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.03, z);
    group.add(ring);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.9, 7, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(css), transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }),
    );
    beam.position.set(x, 3.5, z);
    group.add(beam);
    const label = makeLabel(`SITE ${id}`, css);
    label.position.set(x, 5.4, z);
    group.add(label);
    const light = new THREE.PointLight(new THREE.Color(css), 12, 12);
    light.position.set(x, 2.5, z);
    scene.add(light);
    sites.push({ id, center: new THREE.Vector3(x, 0, z), radius: 3, ring, beam });
    beacons.push(ring);
  }

  function makeLabel(text, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 96;
    const g = canvas.getContext('2d');
    g.fillStyle = color;
    g.font = 'bold 64px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 128, 48);
    const texture = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
    sprite.scale.set(4.4, 1.65, 1);
    return sprite;
  }

  // Light: dusk key from the south-east, cool fill, and a warm furnace glow.
  const sky = new THREE.HemisphereLight(new THREE.Color(PALETTE.surface), new THREE.Color(PALETTE.canvas), 1.3);
  scene.add(sky);
  const key = new THREE.DirectionalLight(new THREE.Color('#ffd9a0'), 2.6);
  key.position.set(16, 20, 14);
  key.target.position.set(0, 0, -4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -26;
  key.shadow.camera.right = 26;
  key.shadow.camera.top = 26;
  key.shadow.camera.bottom = -26;
  key.shadow.camera.far = 60;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.muted), 0.5);
  fill.position.set(-14, 12, 12);
  scene.add(fill);
  const furnaceLight = new THREE.PointLight(new THREE.Color(PALETTE.glow), 20, 16);
  furnaceLight.position.set(0, 1.6, -2);
  scene.add(furnaceLight);

  const waypoints = NODES.map(([x, z], index) => ({ index, pos: new THREE.Vector3(x, 0, z), edges: [] }));
  for (const [a, b] of EDGES) {
    waypoints[a].edges.push(b);
    waypoints[b].edges.push(a);
  }

  return {
    colliders,
    shootables,
    sites,
    waypoints,
    spawns: {
      vanguard: [new THREE.Vector3(-6, 0, 14), new THREE.Vector3(-2, 0, 15), new THREE.Vector3(2, 0, 15), new THREE.Vector3(6, 0, 14), new THREE.Vector3(0, 0, 16)],
      wardens: [new THREE.Vector3(-4, 0, -14), new THREE.Vector3(-1, 0, -15), new THREE.Vector3(2, 0, -15), new THREE.Vector3(5, 0, -14), new THREE.Vector3(-9, 0, -14)],
    },
    group,
    update(time) {
      // Site rings breathe; the furnace glow flickers like a foundry should.
      for (let i = 0; i < beacons.length; i += 1) {
        beacons[i].material.opacity = 0.55 + Math.sin(time * 2 + i * 2.4) * 0.2;
      }
      furnaceLight.intensity = 18 + Math.sin(time * 7.3) * 2 + Math.sin(time * 13.7) * 1.5;
    },
  };
}

// Breadth-first route over the waypoint graph, from the node nearest `from` to the
// node nearest `to`. Returns node indices, excluding the start node.
export function findRoute(waypoints, from, to) {
  let start = 0;
  let goal = 0;
  let bestStart = Infinity;
  let bestGoal = Infinity;
  for (const node of waypoints) {
    const ds = (node.pos.x - from.x) ** 2 + (node.pos.z - from.z) ** 2;
    const dg = (node.pos.x - to.x) ** 2 + (node.pos.z - to.z) ** 2;
    if (ds < bestStart) { bestStart = ds; start = node.index; }
    if (dg < bestGoal) { bestGoal = dg; goal = node.index; }
  }
  const prev = new Map([[start, -1]]);
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === goal) break;
    for (const next of waypoints[current].edges) {
      if (!prev.has(next)) {
        prev.set(next, current);
        queue.push(next);
      }
    }
  }
  if (!prev.has(goal)) return [];
  const path = [];
  let node = goal;
  while (node !== start && node !== -1) {
    path.unshift(node);
    node = prev.get(node);
  }
  return path;
}
