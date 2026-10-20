// Builds the 3D scene for a job: ground, items (instanced), depots, decoration.
import * as THREE from 'three';
import { mulberry32 } from './rng.js';

export const SORT_COLORS = [0xc8553d, 0x3d6fc8, 0xe0b23a, 0x4f9a5a];
export const SORT_NAMES = ['red', 'blue', 'yellow', 'green'];

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, ...extra });

export function buildWorld(job, layout) {
  const group = new THREE.Group();
  const disposables = [];
  const track = (o) => { disposables.push(o); return o; };
  const { items } = layout;
  const rng = mulberry32(job.seed + 1);

  // Each item -> (mesh, instance index). Original matrices kept for un-hiding.
  const meshes = [];
  const ref = new Int32Array(items.length * 2);
  const base = [];
  const tmp = new THREE.Object3D();

  function instanced(geo, material, list, place) {
    track(geo); track(material);
    const m = new THREE.InstancedMesh(geo, material, Math.max(1, list.length));
    m.count = list.length;
    m.castShadow = true; m.receiveShadow = true;
    const mi = meshes.length;
    meshes.push(m);
    list.forEach((i, k) => {
      place(items[i], tmp);
      tmp.updateMatrix();
      m.setMatrixAt(k, tmp.matrix);
      base[i] = tmp.matrix.clone();
      ref[i * 2] = mi; ref[i * 2 + 1] = k;
    });
    m.instanceMatrix.needsUpdate = true;
    group.add(m);
    return m;
  }

  const all = items.map((_, i) => i);
  let env;
  const ground = (size, color) => {
    const g = new THREE.Mesh(track(new THREE.PlaneGeometry(size, size)), track(mat(color)));
    g.rotation.x = -Math.PI / 2; g.receiveShadow = true;
    group.add(g);
    return g;
  };

  if (job.id === 'weeds') {
    env = { sky: 0xbfd6e3, fog: 0xc9dbe2, hemiGround: 0x5a6b3a };
    ground(400, 0x7d9a52);
    const { w, h } = layout.size;
    const soil = new THREE.Mesh(track(new THREE.PlaneGeometry(w + 2, h + 2)), track(mat(0x6b4f36)));
    soil.rotation.x = -Math.PI / 2; soil.position.y = 0.01; soil.receiveShadow = true;
    group.add(soil);
    // furrows
    const furrowMat = track(mat(0x5d4430));
    const furrowGeo = track(new THREE.BoxGeometry(w + 2, 0.06, 0.25));
    for (let z = -h / 2; z <= h / 2; z += 1.2) {
      const f = new THREE.Mesh(furrowGeo, furrowMat);
      f.position.set(0, 0.02, z); f.receiveShadow = true;
      group.add(f);
    }
    const weedGeo = new THREE.DodecahedronGeometry(0.22, 0);
    weedGeo.scale(1, 0.75, 1); weedGeo.translate(0, 0.14, 0);
    const wm = instanced(weedGeo, mat(0xffffff, { flatShading: true }), all, (it, o) => {
      o.position.set(it.x, 0, it.z);
      o.rotation.set(0, it.rot, 0);
      o.scale.setScalar(it.size);
    });
    const c = new THREE.Color();
    all.forEach((i, k) => { c.setHSL(0.24 + rng() * 0.08, 0.45 + rng() * 0.2, 0.25 + rng() * 0.12); wm.setColorAt(k, c); });
    wm.instanceColor.needsUpdate = true;
    // compost heap: a wooden crib with a mound inside
    const d = layout.depots[0];
    const crib = new THREE.Group();
    const plank = track(new THREE.BoxGeometry(3.4, 0.25, 0.12));
    const wood = track(mat(0x8a6a45));
    for (let y = 0; y < 4; y++) for (let s = 0; s < 4; s++) {
      const p = new THREE.Mesh(plank, wood);
      const a = (s * Math.PI) / 2;
      p.position.set(Math.cos(a) * 1.65, 0.15 + y * 0.3, Math.sin(a) * 1.65);
      p.rotation.y = a + Math.PI / 2; p.castShadow = true;
      crib.add(p);
    }
    const mound = new THREE.Mesh(track(new THREE.SphereGeometry(1.5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2)), track(mat(0x4a3a22, { flatShading: true })));
    mound.scale.y = 0.5; crib.add(mound);
    crib.position.set(d.x, 0, d.z);
    group.add(crib);
    env.depotMeshes = [mound];
    // a few trees far away
    addTrees(group, track, rng, 50, 90, 60);
  } else if (job.id === 'sorting') {
    env = { sky: 0x9aa3a8, fog: 0xa3abb0, hemiGround: 0x555a5e };
    ground(400, 0x6d7276);
    const S = layout.size.w;
    const floor = new THREE.Mesh(track(new THREE.PlaneGeometry(S + 8, S + 8)), track(mat(0xb9b6ae)));
    floor.rotation.x = -Math.PI / 2; floor.position.y = 0.01; floor.receiveShadow = true;
    group.add(floor);
    // floor tiles lines
    const lineMat = track(new THREE.MeshBasicMaterial({ color: 0xa8a59d }));
    const lg = track(new THREE.PlaneGeometry(S + 8, 0.04));
    for (let k = -(S + 8) / 2; k <= (S + 8) / 2; k += 2) {
      const a = new THREE.Mesh(lg, lineMat); a.rotation.x = -Math.PI / 2; a.position.set(0, 0.015, k); group.add(a);
      const b = new THREE.Mesh(lg, lineMat); b.rotation.x = -Math.PI / 2; b.rotation.z = Math.PI / 2; b.position.set(k, 0.015, 0); group.add(b);
    }
    // low walls
    const wallMat = track(mat(0xd8d4ca));
    const wallGeo = track(new THREE.BoxGeometry(S + 8, 1.2, 0.3));
    for (let s = 0; s < 4; s++) {
      const wl = new THREE.Mesh(wallGeo, wallMat);
      const a = (s * Math.PI) / 2, r = (S + 8) / 2;
      wl.position.set(Math.sin(a) * r, 0.6, Math.cos(a) * r);
      wl.rotation.y = a; wl.castShadow = wl.receiveShadow = true;
      group.add(wl);
    }
    const geos = [
      new THREE.BoxGeometry(0.32, 0.32, 0.32).translate(0, 0.16, 0),
      new THREE.CylinderGeometry(0.15, 0.15, 0.36, 10).translate(0, 0.18, 0),
      new THREE.SphereGeometry(0.19, 12, 8).translate(0, 0.19, 0),
      new THREE.ConeGeometry(0.2, 0.38, 4).translate(0, 0.19, 0),
    ];
    for (let t = 0; t < 4; t++) {
      instanced(geos[t], mat(SORT_COLORS[t], { roughness: 0.6 }), all.filter((i) => items[i].type === t), (it, o) => {
        o.position.set(it.x, 0, it.z); o.rotation.set(0, it.rot, 0); o.scale.setScalar(it.size);
      });
    }
    env.depotMeshes = layout.depots.map((d, k) => {
      const bin = new THREE.Group();
      const m = track(mat(SORT_COLORS[k], { roughness: 0.7 }));
      const side = track(new THREE.BoxGeometry(2.0, 1.0, 0.1));
      for (let s = 0; s < 4; s++) {
        const p = new THREE.Mesh(side, m);
        const a = (s * Math.PI) / 2;
        p.position.set(Math.sin(a) * 0.95, 0.5, Math.cos(a) * 0.95); p.rotation.y = a; p.castShadow = true;
        bin.add(p);
      }
      const bottom = new THREE.Mesh(track(new THREE.BoxGeometry(1.9, 0.05, 1.9)), track(mat(0x333333)));
      bottom.position.y = 0.05; bin.add(bottom);
      const icon = new THREE.Mesh(geos[k], m);
      icon.scale.setScalar(2.2); icon.position.y = 1.15; bin.add(icon);
      bin.position.set(d.x, 0, d.z);
      group.add(bin);
      return icon;
    });
    geos.forEach(track);
  } else {
    env = { sky: 0x6f7f8c, fog: 0x7b8792, hemiGround: 0x3d3a30 };
    ground(400, 0x5b5a40);
    const R = layout.size.radius;
    const clearing = new THREE.Mesh(track(new THREE.CircleGeometry(R + 3, 64)), track(mat(0x6e6748)));
    clearing.rotation.x = -Math.PI / 2; clearing.position.y = 0.01; clearing.receiveShadow = true;
    group.add(clearing);
    const logGeo = new THREE.CylinderGeometry(0.13, 0.15, 1.1, 7);
    logGeo.rotateZ(Math.PI / 2); logGeo.translate(0, 0.14, 0);
    const lm = instanced(logGeo, mat(0xffffff, { flatShading: true }), all, (it, o) => {
      o.position.set(it.x, 0, it.z); o.rotation.set(0, it.rot, 0); o.scale.set(it.size, 1, 1);
    });
    const c = new THREE.Color();
    all.forEach((i, k) => { c.setHSL(0.07 + rng() * 0.03, 0.35 + rng() * 0.15, 0.28 + rng() * 0.1); lm.setColorAt(k, c); });
    lm.instanceColor.needsUpdate = true;
    // the core
    const core = new THREE.Group();
    const base = new THREE.Mesh(track(new THREE.CylinderGeometry(2.3, 2.6, 0.6, 24)), track(mat(0x3b3836)));
    base.position.y = 0.3; base.castShadow = base.receiveShadow = true; core.add(base);
    const orb = new THREE.Mesh(track(new THREE.IcosahedronGeometry(1.25, 2)),
      track(new THREE.MeshStandardMaterial({ color: 0xff8a3c, emissive: 0xff5a1a, emissiveIntensity: 1.6, flatShading: true })));
    orb.position.y = 1.9; core.add(orb);
    const light = new THREE.PointLight(0xff7a30, 40, 30, 1.6);
    light.position.y = 2.2; core.add(light);
    group.add(core);
    env.depotMeshes = [orb];
    env.coreLight = light;
    addTrees(group, track, rng, R + 4, R + 30, 260);
  }

  function setPicked(i, picked) {
    const m = meshes[ref[i * 2]], k = ref[i * 2 + 1];
    if (picked) m.setMatrixAt(k, ZERO); else m.setMatrixAt(k, base[i]);
    m.instanceMatrix.needsUpdate = true;
  }

  function dispose() {
    group.removeFromParent();
    disposables.forEach((d) => d.dispose?.());
    meshes.forEach((m) => m.dispose());
  }

  return { group, env, setPicked, dispose };
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

function addTrees(group, track, rng, r0, r1, n) {
  const trunk = track(new THREE.CylinderGeometry(0.18, 0.25, 1.6, 6).translate(0, 0.8, 0));
  const crown = track(new THREE.ConeGeometry(1.4, 4, 7).translate(0, 3.4, 0));
  const tm = new THREE.InstancedMesh(trunk, track(mat(0x5a4330)), n);
  const cm = new THREE.InstancedMesh(crown, track(mat(0x3e5a36, { flatShading: true })), n);
  const o = new THREE.Object3D();
  for (let k = 0; k < n; k++) {
    const a = rng() * Math.PI * 2, r = r0 + rng() * (r1 - r0);
    o.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    o.scale.setScalar(0.8 + rng() * 0.9);
    o.updateMatrix();
    tm.setMatrixAt(k, o.matrix); cm.setMatrixAt(k, o.matrix);
  }
  tm.castShadow = cm.castShadow = true;
  group.add(tm, cm);
}

// A plain worker figure. carry(n, kind) shows what's in their hands.
export function makeWorker(job, { ghost = false } = {}) {
  const g = new THREE.Group();
  const opts = ghost ? { transparent: true, opacity: 0.55 } : {};
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.7, 4, 10), mat(ghost ? 0xffffff : 0x46607a, opts));
  body.position.y = 0.62; body.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), mat(ghost ? 0xffffff : 0xe2b896, opts));
  head.position.y = 1.32; head.castShadow = true;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xb34a30, opts));
  cap.position.y = 1.36;
  const torso = new THREE.Group();
  torso.add(body, head, cap);
  g.add(torso);

  const carry = new THREE.Group();
  torso.add(carry);
  let carryKind = null, carryN = -1;
  function setCarry(n, type = 0) {
    if (n === carryN && type === carryKind) return;
    carryN = n; carryKind = type;
    carry.clear();
    if (!n) return;
    if (job.id === 'weeds') {
      const bag = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), mat(0xcfc3a0, opts));
      const s = 0.45 + 0.75 * (n / job.params.cap);
      bag.scale.set(s, s * 1.1, s);
      bag.position.set(0, 0.75, -0.35); bag.castShadow = true;
      carry.add(bag);
    } else if (job.id === 'sorting') {
      const geo = [new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.CylinderGeometry(0.14, 0.14, 0.34, 10),
        new THREE.SphereGeometry(0.18, 12, 8), new THREE.ConeGeometry(0.19, 0.36, 4)][type];
      const m = new THREE.Mesh(geo, mat(SORT_COLORS[type], opts));
      m.position.set(0, 0.85, 0.38); m.castShadow = true;
      carry.add(m);
    } else {
      for (let k = 0; k < n; k++) {
        const log = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 1.0, 7), mat(0x7a5535, opts));
        log.rotation.z = Math.PI / 2;
        log.position.set(0, 0.8 + k * 0.27, 0.36); log.castShadow = true;
        carry.add(log);
      }
    }
  }

  let phase = 0;
  function animate(dt, moving, working, speed = 1) {
    if (moving) phase += dt * 9 * speed;
    torso.position.y = moving ? Math.abs(Math.sin(phase)) * 0.06 : 0;
    const bend = working ? 0.55 + Math.sin(performance.now() / 160) * 0.06 : 0;
    torso.rotation.x += (bend - torso.rotation.x) * Math.min(1, dt * 10);
  }
  return { group: g, setCarry, animate };
}
