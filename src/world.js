// Builds the 3D scene for a job: ground, items (instanced), depots, decoration, ambience.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './rng.js';
import { textures, windy, windTime } from './fx.js';

export const SORT_COLORS = [0xc8553d, 0x3d6fc8, 0xe0b23a, 0x4f9a5a];
export const SORT_NAMES = ['red', 'blue', 'yellow', 'green'];

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, ...o });
const lam = (o = {}) => new THREE.MeshLambertMaterial(o);

// ---------- shared geometry builders ----------
function solidColor(geo, hex) {
  const c = new THREE.Color(hex), n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}
function gradientColor(geo, bottom, top, y0, y1) {
  const a = new THREE.Color(bottom), b = new THREE.Color(top), c = new THREE.Color();
  const p = geo.attributes.position, arr = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    c.copy(a).lerp(b, THREE.MathUtils.clamp((p.getY(i) - y0) / (y1 - y0), 0, 1));
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}
// keep only position/normal/color so geometries can be merged; stay indexed when all inputs are
function clean(geo, indexed) {
  const g = geo.index && !indexed ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}
function merge(list) {
  const indexed = list.every((g) => g.index);
  return mergeGeometries(list.map((g) => clean(g, indexed)));
}

// A leaf / blade: a strip along +z rising by `lift`, drooping by `droop`, with a slight V fold.
function leafGeo(len, width, lift, droop, base, tip, segs = 5) {
  const pos = [], col = [], idx = [];
  const cb = new THREE.Color(base), ct = new THREE.Color(tip), c = new THREE.Color();
  for (let s = 0; s <= segs; s++) {
    const t = s / segs;
    const w = width * Math.pow(Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.95)), 0.7) * (s === segs ? 0.05 : 1);
    const y = lift * t - droop * t * t, z = len * t;
    pos.push(-w, y, z, 0, y + w * 0.3, z, w, y, z);
    c.copy(cb).lerp(ct, t);
    for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
    if (s < segs) {
      const r = s * 3, n = r + 3;
      idx.push(r, n, r + 1, r + 1, n, n + 1, r + 1, n + 1, r + 2, r + 2, n + 1, n + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function rosetteGeo(rng, leaves, len, width) {
  const parts = [];
  for (let k = 0; k < leaves; k++) {
    const l = leafGeo(len * (0.75 + rng() * 0.5), width * (0.8 + rng() * 0.4), len * 0.45, len * 0.4, 0x2f4a1c, 0x6f9a3e);
    l.rotateY((k / leaves) * Math.PI * 2 + rng() * 0.4);
    parts.push(l);
  }
  // inner upright leaves
  for (let k = 0; k < 3; k++) {
    const l = leafGeo(len * 0.6, width * 0.7, len * 0.8, len * 0.2, 0x34521f, 0x84ad4c);
    l.rotateY(rng() * Math.PI * 2);
    parts.push(l);
  }
  return merge(parts);
}

function tuftGeo(rng, blades, len) {
  const parts = [];
  for (let k = 0; k < blades; k++) {
    const L = len * (0.6 + rng() * 0.6);
    const b = leafGeo(L * 0.35, 0.022, L, L * 0.25, 0x3a5520, 0x9cb85a, 4);
    b.translate(0, 0, -0.02);
    b.rotateY(rng() * Math.PI * 2);
    parts.push(b);
  }
  return merge(parts);
}

function flowerGeo(head, headColor) {
  const stem = solidColor(new THREE.CylinderGeometry(0.006, 0.008, 0.34, 4).translate(0, 0.17, 0), 0x4c7a2c);
  let h;
  if (head === 'puff') h = solidColor(new THREE.IcosahedronGeometry(0.06, 1).translate(0, 0.36, 0), headColor);
  else h = solidColor(new THREE.SphereGeometry(0.045, 8, 5).scale(1, 0.55, 1).translate(0, 0.35, 0), headColor);
  return merge([stem, h]);
}

function bladeGeo(rng, n) {
  const parts = [];
  for (let k = 0; k < n; k++) {
    const L = 0.35 + rng() * 0.25;
    const b = leafGeo(L * 0.3, 0.03, L, L * 0.2, 0x3b5a22, 0x9db55c, 2);
    b.translate((rng() - 0.5) * 0.12, 0, (rng() - 0.5) * 0.12);
    b.rotateY(rng() * Math.PI * 2);
    parts.push(b);
  }
  return merge(parts);
}

function pineGeo(rng) {
  const parts = [gradientColor(new THREE.CylinderGeometry(0.12, 0.22, 2.2, 6).translate(0, 1.1, 0), 0x3a2a1c, 0x5a4330, 0, 2)];
  let y = 1.3, r = 1.7;
  for (let k = 0; k < 4; k++) {
    const h = 2.4 - k * 0.35;
    const c = new THREE.ConeGeometry(r, h, 8).translate(0, y + h / 2, 0);
    parts.push(gradientColor(c, 0x22381f, k === 3 ? 0x557a45 : 0x3f6338, y, y + h));
    y += h * 0.55; r *= 0.74;
  }
  return merge(parts);
}

function broadleafGeo(rng) {
  const parts = [gradientColor(new THREE.CylinderGeometry(0.14, 0.25, 2.4, 7).translate(0, 1.2, 0), 0x3b2c20, 0x5c4532, 0, 2.4)];
  for (let k = 0; k < 6; k++) {
    const r = 1.0 + rng() * 0.8;
    const b = new THREE.IcosahedronGeometry(r, 1);
    b.translate((rng() - 0.5) * 2.2, 2.8 + rng() * 1.6, (rng() - 0.5) * 2.2);
    parts.push(gradientColor(b, 0x2e4a22, 0x6f9446, 1.8, 4.8));
  }
  return merge(parts);
}

function rockGeo(rng) {
  const g = new THREE.DodecahedronGeometry(0.5, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const f = 0.8 + rng() * 0.4;
    p.setXYZ(i, p.getX(i) * f, Math.max(-0.1, p.getY(i) * f * 0.6), p.getZ(i) * f);
  }
  g.computeVertexNormals();
  return gradientColor(g, 0x55574f, 0x8a8a7e, -0.1, 0.35);
}

export function sortGeometry(t) {
  return [
    () => new THREE.BoxGeometry(0.32, 0.32, 0.32).translate(0, 0.16, 0),
    () => new THREE.CylinderGeometry(0.15, 0.15, 0.36, 16).translate(0, 0.18, 0),
    () => new THREE.SphereGeometry(0.19, 20, 14).translate(0, 0.19, 0),
    () => new THREE.ConeGeometry(0.2, 0.38, 4).translate(0, 0.19, 0),
  ][t]();
}
const SORT_MAT = [
  { roughness: 0.75 },              // red crates
  { roughness: 0.3, metalness: 0.7 }, // blue cans
  { roughness: 0.2 },               // yellow balls
  { roughness: 0.5 },               // green pyramids
];

let _logMats = null;
export function logMaterials() {
  if (!_logMats) {
    const bark = textures.bark(), end = textures.endgrain();
    _logMats = [std(0xffffff, { map: bark, roughness: 0.95 }), std(0xffffff, { map: end, roughness: 0.8 }), std(0xffffff, { map: end, roughness: 0.8 })];
  }
  return _logMats;
}

// ---------- the orb shader for the core ----------
const ORB_VERT = /* glsl */`
  varying vec3 vPos; varying vec3 vNormal; varying vec3 vView;
  uniform float uTime;
  void main() {
    vPos = position; vNormal = normalize(normalMatrix * normal);
    vec3 p = position * (1.0 + 0.04 * sin(uTime * 2.0 + position.y * 4.0));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
const ORB_FRAG = /* glsl */`
  varying vec3 vPos; varying vec3 vNormal; varying vec3 vView;
  uniform float uTime; uniform float uFill; uniform float uFlash;
  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise(vec3 x) {
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
  void main() {
    vec3 p = vPos * 1.6;
    float n = fbm(p + vec3(0.0, -uTime * 0.6, uTime * 0.2));
    n = fbm(p + n * 1.8 + vec3(uTime * 0.15));
    float heat = smoothstep(0.25, 0.85, n);
    vec3 col = mix(vec3(0.35, 0.03, 0.0), vec3(1.0, 0.35, 0.05), heat);
    col = mix(col, vec3(1.0, 0.85, 0.5), smoothstep(0.7, 0.95, n));
    float fres = pow(1.0 - max(0.0, dot(vNormal, vView)), 2.5);
    col += vec3(1.0, 0.5, 0.15) * fres * 1.5;
    float power = 1.6 + uFill * 1.8 + uFlash * 3.0;
    gl_FragColor = vec4(col * power, 1.0);
  }`;

// ---------- the world ----------
export function buildWorld(job, layout, { fx, quality = 1 } = {}) {
  const group = new THREE.Group();
  const { items } = layout;
  const rng = mulberry32(job.seed + 1);
  const updaters = [];

  // item -> list of [mesh, instance]
  const parts = items.map(() => []);
  const base = [];
  const meshes = [];
  const tmp = new THREE.Object3D();

  function instanced(geo, material, list, place, { shadow = true } = {}) {
    const m = new THREE.InstancedMesh(geo, material, Math.max(1, list.length));
    m.count = list.length;
    m.castShadow = shadow; m.receiveShadow = true;
    meshes.push(m);
    list.forEach((i, k) => {
      place(items[i], tmp, i);
      tmp.updateMatrix();
      m.setMatrixAt(k, tmp.matrix);
      parts[i].push([m, k, tmp.matrix.clone()]);
    });
    m.instanceMatrix.needsUpdate = true;
    group.add(m);
    return m;
  }
  // decoration instancing (not items)
  function scatter(geo, material, n, place, { shadow = true, receive = true, colors = null } = {}) {
    const m = new THREE.InstancedMesh(geo, material, n);
    const c = new THREE.Color();
    for (let k = 0; k < n; k++) {
      tmp.position.set(0, 0, 0); tmp.rotation.set(0, 0, 0); tmp.scale.set(1, 1, 1);
      place(tmp, k);
      tmp.updateMatrix(); m.setMatrixAt(k, tmp.matrix);
      if (colors) { colors(c, k); m.setColorAt(k, c); }
    }
    m.castShadow = shadow; m.receiveShadow = receive;
    group.add(m);
    return m;
  }
  const add = (geo, material, x = 0, y = 0, z = 0, { shadow = true } = {}) => {
    const o = new THREE.Mesh(geo, material);
    o.position.set(x, y, z); o.castShadow = shadow; o.receiveShadow = true;
    group.add(o); return o;
  };
  const plane = (w, h, material, y = 0) => {
    const o = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
    o.rotation.x = -Math.PI / 2; o.position.y = y; o.receiveShadow = true;
    group.add(o); return o;
  };

  const all = items.map((_, i) => i);
  let env, onPick, onDrop, setFill;
  const depotMeshes = [];

  if (job.id === 'weeds') {
    env = {
      outdoor: true, sky: { turbidity: 3, rayleigh: 1.4, mieCoefficient: 0.004, mieDirectionalG: 0.85 },
      fogDay: 0xc6d5df, fogDusk: 0xe7b48d, fogDensity: 0.0055,
      hemi: [0xdfeaf2, 0x5c6b3a, 1.0], sun: 2.6, bloom: [0.22, 0.5, 0.92], exposure: 0.95, shadow: 26,
    };
    const { w: W, h: H } = layout.size;
    const furrow = (z) => 0.035 * (1 + Math.cos((2 * Math.PI * z) / 1.2));

    plane(500, 500, lam({ map: textures.grass(80) }), -0.01);
    // furrowed soil
    const soilGeo = new THREE.PlaneGeometry(W + 2, H + 2, 8, Math.round((H + 2) * 7));
    soilGeo.rotateX(-Math.PI / 2);
    const sp = soilGeo.attributes.position;
    for (let i = 0; i < sp.count; i++) {
      const x = sp.getX(i), z = sp.getZ(i);
      const edge = Math.min(1, (W / 2 + 1 - Math.abs(x)) * 2, (H / 2 + 1 - Math.abs(z)) * 2);
      sp.setY(i, furrow(z) * edge + 0.01);
    }
    soilGeo.computeVertexNormals();
    const soil = new THREE.Mesh(soilGeo, std(0xffffff, { map: textures.soil((W + 2) / 5) }));
    soil.receiveShadow = true; group.add(soil);
    // a dirt path to the compost
    const d = layout.depots[0];
    const path = plane(Math.abs(d.x) - W / 2 + 2, 3.2, std(0xd8c8b0, { map: textures.soil(2) }), 0.004);
    path.position.x = (d.x - W / 2) / 2;

    // weeds: two rosette shapes, one grassy tuft; a third carry a flower
    const geos = [rosetteGeo(rng, 7, 0.32, 0.075), rosetteGeo(rng, 5, 0.42, 0.06), tuftGeo(rng, 11, 0.5)];
    const weedMat = windy(std(0xffffff, { vertexColors: true, side: THREE.DoubleSide, roughness: 0.8 }), 0.35);
    const variant = all.map((i) => (i * 2654435761 >>> 0) % 3);
    const tint = new THREE.Color();
    geos.forEach((g, v) => {
      const m = instanced(g, weedMat, all.filter((i) => variant[i] === v), (it, o) => {
        o.position.set(it.x, furrow(it.z), it.z); o.rotation.set(0, it.rot, 0); o.scale.setScalar(it.size);
      });
      for (let k = 0; k < m.count; k++) { tint.setHSL(0.22 + rng() * 0.08, 0.5 + rng() * 0.3, 0.42 + rng() * 0.2); m.setColorAt(k, tint); }
    });
    const flowerAt = all.filter((i) => variant[i] !== 2 && ((i * 40503) >>> 0) % 10 < 3);
    const puffs = flowerAt.filter((i) => i % 3 === 0), yellows = flowerAt.filter((i) => i % 3 !== 0);
    const flowerMat = windy(std(0xffffff, { vertexColors: true, roughness: 0.7 }), 0.6);
    const placeFlower = (it, o) => { o.position.set(it.x + 0.04, furrow(it.z), it.z); o.rotation.set(0, it.rot, 0); o.scale.setScalar(it.size); };
    instanced(flowerGeo('head', 0xf2c21b), flowerMat, yellows, placeFlower);
    instanced(flowerGeo('puff', 0xf3efe2), flowerMat, puffs, placeFlower);

    // meadow grass around the field
    const grassN = Math.round(30000 * quality);
    const blade = bladeGeo(rng, 4);
    const ex = W / 2 + 1.2, ez = H / 2 + 1.2;
    const grassMat = windy(lam({ vertexColors: true, side: THREE.DoubleSide }), 0.4);
    scatter(blade, grassMat, grassN, (o) => {
      let x, z;
      do {
        const a = rng() * Math.PI * 2, r = 4 + Math.pow(rng(), 0.7) * 85;
        x = Math.cos(a) * (ex + r); z = Math.sin(a) * (ez + r) * 0.9;
        x = Math.max(-110, Math.min(110, x)); z = Math.max(-110, Math.min(110, z));
      } while ((Math.abs(x) < ex && Math.abs(z) < ez) || (x < -W / 2 && x > d.x - 2.5 && Math.abs(z) < 2.2) || Math.hypot(x - d.x, z - d.z) < 2.6);
      o.position.set(x, 0, z); o.rotation.y = rng() * 6.28; o.scale.set(1, 0.6 + rng() * 0.9, 1);
    }, { shadow: false, colors: (c) => c.setHSL(0.21 + rng() * 0.06, 0.35 + rng() * 0.2, 0.55 + rng() * 0.2) });
    // wildflowers
    const wild = new THREE.SphereGeometry(0.05, 6, 4).translate(0, 0.32, 0);
    const wildPal = [0xffffff, 0xb48ce0, 0xf2c21b, 0xe0607a];
    scatter(wild, lam(), Math.round(1800 * quality), (o) => {
      let x, z;
      do { x = (rng() - 0.5) * 180; z = (rng() - 0.5) * 160; } while (Math.abs(x) < ex + 1 && Math.abs(z) < ez + 1);
      o.position.set(x, 0, z); o.scale.setScalar(0.7 + rng() * 0.8);
    }, { shadow: false, colors: (c) => c.set(wildPal[Math.floor(rng() * 4)]) });

    // fence around the field, open towards the compost
    const fenceMat = std(0x8c7a62, { roughness: 0.95 });
    const fx0 = W / 2 + 1.6, fz0 = H / 2 + 1.6, posts = [];
    for (let x = -fx0; x <= fx0 + 0.01; x += 2.5) posts.push([x, -fz0], [x, fz0]);
    for (let z = -fz0 + 2.5; z < fz0 - 0.01; z += 2.5) { posts.push([fx0, z]); if (Math.abs(z) > 3) posts.push([-fx0, z]); }
    scatter(new THREE.BoxGeometry(0.12, 1.1, 0.12).translate(0, 0.55, 0), fenceMat, posts.length, (o, k) => {
      o.position.set(posts[k][0], 0, posts[k][1]); o.rotation.set((rng() - 0.5) * 0.06, rng(), (rng() - 0.5) * 0.06);
    });
    const rail = (x, z, len, rotY) => { for (const y of [0.45, 0.85]) { const r = add(new THREE.BoxGeometry(len, 0.07, 0.04), fenceMat, x, y, z); r.rotation.y = rotY; } };
    rail(0, -fz0, fx0 * 2, 0); rail(0, fz0, fx0 * 2, 0); rail(fx0, 0, fz0 * 2, Math.PI / 2);
    rail(-fx0, -(fz0 + 3) / 2, fz0 - 3, Math.PI / 2); rail(-fx0, (fz0 + 3) / 2, fz0 - 3, Math.PI / 2);

    // trees and bushes on the horizon
    const tree = broadleafGeo(rng);
    const treeMat = windy(std(0xffffff, { vertexColors: true, flatShading: true }), 0.02);
    scatter(tree, treeMat, 90, (o) => {
      const a = rng() * Math.PI * 2, r = 58 + rng() * 45;
      o.position.set(Math.cos(a) * r, 0, Math.sin(a) * r * 0.85); o.rotation.y = rng() * 6; o.scale.setScalar(0.9 + rng() * 0.9);
    }, { colors: (c) => c.setHSL(0.25, 0.2, 0.8 + rng() * 0.3) });
    const bush = merge([0, 1, 2].map(() => gradientColor(new THREE.IcosahedronGeometry(0.6 + rng() * 0.3, 1).translate((rng() - 0.5) * 0.8, 0.4, (rng() - 0.5) * 0.8), 0x2e4a22, 0x6a8f42, 0, 1)));
    scatter(bush, std(0xffffff, { vertexColors: true, flatShading: true }), 70, (o) => {
      const side = rng() < 0.5 ? -1 : 1;
      if (rng() < 0.5) o.position.set((rng() - 0.5) * (W + 8), 0, side * (fz0 + 1.5 + rng() * 3));
      else o.position.set(fx0 + 1.5 + rng() * 3, 0, (rng() - 0.5) * (H + 8));
      o.scale.setScalar(0.7 + rng() * 0.8); o.rotation.y = rng() * 6;
    });

    // compost crib: corner posts, slats with gaps, a heap that grows
    const wood = std(0x7d5f40, { map: textures.bark(), roughness: 0.95 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(new THREE.BoxGeometry(0.14, 1.25, 0.14).translate(0, 0.62, 0), wood, d.x + sx * 1.62, 0, d.z + sz * 1.62);
    const slat = new THREE.BoxGeometry(3.2, 0.2, 0.06);
    for (const [sx, sz, rot, front] of [[1.62, 0, Math.PI / 2, true], [-1.62, 0, Math.PI / 2], [0, 1.62, 0], [0, -1.62, 0]]) {
      for (let y = 0; y < 4; y++) {
        if (front && y > 1) continue; // lower towards the field so you can tip the bag in
        const p = add(slat, wood, d.x + sx, 0.18 + y * 0.28, d.z + sz);
        p.rotation.y = rot;
      }
    }
    const moundIdx = new THREE.SphereGeometry(1.45, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    const ip = moundIdx.attributes.position;
    for (let i = 0; i < ip.count; i++) { // lumpy, but shared vertices stay together
      const f = 1 + Math.sin(ip.getX(i) * 5.1) * Math.cos(ip.getZ(i) * 4.3) * 0.08;
      ip.setXYZ(i, ip.getX(i) * f, ip.getY(i) * f, ip.getZ(i) * f);
    }
    const moundGeo = moundIdx.toNonIndexed();
    const mp = moundGeo.attributes.position, mc = new Float32Array(mp.count * 3), cc = new THREE.Color();
    for (let i = 0; i < mp.count; i += 3) { // one colour per face: rotting leaves and earth
      cc.set(0x3f2e1e).lerp(new THREE.Color(0x56702e), rng() < 0.3 ? 0.45 + rng() * 0.35 : rng() * 0.15).multiplyScalar(0.85 + rng() * 0.3);
      for (let k = 0; k < 3; k++) cc.toArray(mc, (i + k) * 3);
    }
    moundGeo.setAttribute('color', new THREE.BufferAttribute(mc, 3));
    moundGeo.computeVertexNormals();
    const mound = add(moundGeo, std(0xffffff, { vertexColors: true, flatShading: true }), d.x, 0, d.z);
    mound.scale.set(1, 0.18, 1);
    depotMeshes.push(mound);
    setFill = (k, f) => { mound.scale.y = 0.18 + 0.7 * f; mound.userData.base = null; };

    onPick = (it) => {
      fx.soft.emit(it.x, 0.1, it.z, 12, { color: [0x4a3424, 0x5e4330, 0x3a281b], speed: 1.6, spread: 0.5, up: 1.2, gravity: 7, size: 0.07, life: 0.9, jitter: 0.1 });
      fx.soft.emit(it.x, 0.2, it.z, 5, { color: [0x5c8a3a, 0x7aa64a], speed: 1, spread: 0.6, up: 0.8, gravity: 3, drag: 2, size: 0.06, life: 1.2 });
    };
    onDrop = (k) => {
      fx.soft.emit(d.x, 0.9, d.z, 40, { color: [0x5c8a3a, 0x7aa64a, 0x3c2c1c, 0x4a3424], speed: 2.2, spread: 0.6, up: 1.5, gravity: 6, size: 0.08, life: 1.2, jitter: 0.5 });
    };
  } else if (job.id === 'sorting') {
    env = {
      outdoor: false, background: 0x24221f,
      fogDay: 0x3b3833, fogDusk: 0x3e3530, fogDensity: 0.006,
      hemi: [0xfff3e0, 0x4a4640, 0.75], sun: 2.2, bloom: [0.45, 0.6, 0.85], exposure: 1.05, shadow: 28, envMap: true,
    };
    const S = layout.size.w, R = S / 2 + 4;
    plane(R * 2 + 40, R * 2 + 40, std(0x2a2724), -0.02);
    const floor = plane(R * 2, R * 2, std(0xffffff, { map: textures.concrete(3), roughness: 0.5, envMapIntensity: 0.8 }), 0);
    floor.receiveShadow = true;
    // painted floor markings
    const paint = (color, opacity = 0.9) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, transparent: opacity < 1, opacity, polygonOffset: true, polygonOffsetFactor: -2 });
    const yellow = paint(0xe2b23a);
    const line = (x, z, w, h, m) => { const p = plane(w, h, m, 0.006); p.position.x = x; p.position.z = z; return p; };
    const b = S / 2 + 0.7;
    line(0, -b, b * 2 + 0.12, 0.12, yellow); line(0, b, b * 2 + 0.12, 0.12, yellow);
    line(-b, 0, 0.12, b * 2, yellow); line(b, 0, 0.12, b * 2, yellow);
    layout.depots.forEach((dp, k) => {
      const m = paint(SORT_COLORS[k]), fill = paint(SORT_COLORS[k], 0.18);
      line(dp.x, dp.z, 3.6, 3.6, fill);
      line(dp.x, dp.z - 1.8, 3.6, 0.1, m); line(dp.x, dp.z + 1.8, 3.6, 0.1, m);
      line(dp.x - 1.8, dp.z, 0.1, 3.6, m); line(dp.x + 1.8, dp.z, 0.1, 3.6, m);
    });

    // walls with ribs and a band of high windows
    const wallMat = std(0xcfcac0, { roughness: 0.85 });
    const WH = 6.5;
    const winMat = new THREE.MeshBasicMaterial({ color: 0xe8f0ff });
    const frameMat = std(0x3a3a3a, { roughness: 0.6, metalness: 0.5 });
    const windows = [];
    for (let s = 0; s < 4; s++) {
      const a = (s * Math.PI) / 2;
      const nx = Math.sin(a), nz = Math.cos(a);
      // the wall towards the camera is cut away, like a doll's house
      if (s === 0) {
        const low = add(new THREE.BoxGeometry(R * 2 + 0.8, 0.9, 0.4), wallMat, nx * (R + 0.2), 0.45, nz * (R + 0.2));
        low.rotation.y = a;
        add(new THREE.BoxGeometry(R * 2 + 0.8, 0.06, 0.44), std(0xe2b23a), nx * (R + 0.2), 0.93, nz * (R + 0.2));
        continue;
      }
      const wall = add(new THREE.BoxGeometry(R * 2 + 0.8, WH, 0.4), wallMat, nx * (R + 0.2), WH / 2, nz * (R + 0.2));
      wall.rotation.y = a;
      // ribs
      for (let t = -R + 1; t <= R - 1; t += 2.4) {
        const rib = add(new THREE.BoxGeometry(0.14, WH, 0.12), std(0xb9b3a8), 0, WH / 2, 0);
        rib.position.set(nx * R + Math.cos(a) * t, WH / 2, nz * R - Math.sin(a) * t);
        rib.rotation.y = a;
      }
      // window band
      for (let t = -R + 3; t <= R - 3; t += 4) {
        const win = add(new THREE.PlaneGeometry(3.2, 1.3), winMat, 0, 0, 0, { shadow: false });
        win.position.set(nx * (R - 0.01) + Math.cos(a) * t, WH - 1.4, nz * (R - 0.01) - Math.sin(a) * t);
        win.rotation.y = a + Math.PI;
        const fr = add(new THREE.BoxGeometry(3.4, 0.08, 0.1), frameMat, win.position.x, WH - 0.72, win.position.z);
        fr.rotation.y = a;
        const fr2 = add(new THREE.BoxGeometry(3.4, 0.08, 0.1), frameMat, win.position.x, WH - 2.08, win.position.z);
        fr2.rotation.y = a;
        windows.push({ x: win.position.x, z: win.position.z, nx, nz, a });
      }
    }
    // a roller door
    const door = add(new THREE.PlaneGeometry(5, 4.2), std(0x8d9196, { roughness: 0.5, metalness: 0.6 }), R - 0.02, 2.1, 9);
    door.rotation.y = -Math.PI / 2;
    for (let k = 0; k < 2; k++) add(new THREE.BoxGeometry(0.2, 4.4, 0.25), std(0xe2b23a), R - 0.1, 2.2, 9 + (k ? 2.6 : -2.6));

    // racks along the walls, full of boxes
    const upMat = std(0x2f5d8c, { roughness: 0.5, metalness: 0.4 }), beamMat = std(0xd9772b, { roughness: 0.5, metalness: 0.3 });
    const deckMat = std(0x9a9a96, { roughness: 0.6, metalness: 0.5 });
    const ups = [], beams = [], decks = [], boxes = [];
    for (let s = 0; s < 4; s++) {
      const a = (s * Math.PI) / 2, nx = Math.sin(a), nz = Math.cos(a), tx = Math.cos(a), tz = -Math.sin(a);
      const off = R - 0.75;
      for (let t = -R + 2; t <= R - 2.6; t += 2.8) {
        if (s === 0) break; // cut-away side
        if (Math.abs(t + 1.35) < 4.2) continue; // leave room behind the bin
        if (s === 1 && Math.abs(t + 1.35 + 9) < 3.6) continue; // the door (east wall)
        const cx = nx * off + tx * (t + 1.35), cz = nz * off + tz * (t + 1.35);
        for (const u of [-1.3, 1.3]) for (const v of [-0.45, 0.45]) ups.push([cx + tx * u + nx * v, cz + tz * u + nz * v]);
        for (const y of [0.15, 1.3, 2.45]) {
          decks.push([cx, y, cz, a]);
          for (const v of [-0.45, 0.45]) beams.push([cx + nx * v, y, cz + nz * v, a]);
          if (y > 2 && rng() < 0.3) continue;
          let u = -1.15;
          while (u < 1.0) {
            const w = 0.45 + rng() * 0.5, h = 0.35 + rng() * 0.55;
            if (u + w > 1.2) break;
            boxes.push([cx + tx * (u + w / 2), y + 0.05, cz + tz * (u + w / 2), a, w, h, 0.6 + rng() * 0.3]);
            u += w + 0.06 + rng() * 0.2;
          }
        }
      }
    }
    scatter(new THREE.BoxGeometry(0.09, 3.3, 0.09).translate(0, 1.65, 0), upMat, ups.length, (o, k) => o.position.set(ups[k][0], 0, ups[k][1]));
    scatter(new THREE.BoxGeometry(2.7, 0.1, 0.06), beamMat, beams.length, (o, k) => { const [x, y, z, a] = beams[k]; o.position.set(x, y + 0.02, z); o.rotation.y = a; });
    scatter(new THREE.BoxGeometry(2.62, 0.03, 0.9), deckMat, decks.length, (o, k) => { const [x, y, z, a] = decks[k]; o.position.set(x, y + 0.05, z); o.rotation.y = a; });
    scatter(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), std(0xffffff, { roughness: 0.9 }), boxes.length, (o, k) => {
      const [x, y, z, a, w, h, dd] = boxes[k]; o.position.set(x, y, z); o.rotation.y = a + (rng() - 0.5) * 0.08; o.scale.set(w, h, dd);
    }, { colors: (c) => c.setHSL(0.08 + rng() * 0.03, 0.35 + rng() * 0.2, 0.42 + rng() * 0.15) });
    // pallet stacks in the corners
    const pallets = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (let k = 0; k < 3; k++) pallets.push([sx * (R - 2.2) + (rng() - 0.5) * 1.5, sz * (R - 2.2) + (k - 1) * 1.3, Math.floor(2 + rng() * 5)]);
    const pal = [];
    for (const [x, z, n] of pallets) for (let k = 0; k < n; k++) pal.push([x, k * 0.15, z]);
    scatter(new THREE.BoxGeometry(1.2, 0.14, 1.0).translate(0, 0.07, 0), std(0xb0915f, { roughness: 0.95 }), pal.length, (o, k) => {
      o.position.set(pal[k][0], pal[k][1], pal[k][2]); o.rotation.y = (rng() - 0.5) * 0.1;
    });

    // items
    const tint = new THREE.Color();
    for (let t = 0; t < 4; t++) {
      const m = instanced(sortGeometry(t), std(SORT_COLORS[t], SORT_MAT[t]), all.filter((i) => items[i].type === t), (it, o) => {
        o.position.set(it.x, 0, it.z); o.rotation.set(0, it.rot, 0); o.scale.setScalar(it.size);
      });
      for (let k = 0; k < m.count; k++) { tint.setHSL(0, 0, 0.85 + rng() * 0.3); m.setColorAt(k, tint); }
    }

    // bins: plastic crates with a sign; the contents rise as you sort
    const fills = [];
    layout.depots.forEach((dp, k) => {
      const m = std(SORT_COLORS[k], { roughness: 0.45 }), rim = std(new THREE.Color(SORT_COLORS[k]).multiplyScalar(0.6), { roughness: 0.5 });
      const g = new THREE.Group(); g.position.set(dp.x, 0, dp.z); group.add(g);
      const part = (geo, mm, x, y, z) => { const o = new THREE.Mesh(geo, mm); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; g.add(o); return o; };
      for (const [x, z, w, dd] of [[0, 0.95, 2, 0.1], [0, -0.95, 2, 0.1], [0.95, 0, 0.1, 1.8], [-0.95, 0, 0.1, 1.8]]) {
        part(new THREE.BoxGeometry(w, 1.0, dd), m, x, 0.5, z);
        part(new THREE.BoxGeometry(w + 0.04, 0.08, dd + 0.04), rim, x, 1.02, z);
      }
      part(new THREE.BoxGeometry(1.9, 0.06, 1.9), rim, 0, 0.03, 0);
      const fill = part(new THREE.BoxGeometry(1.8, 1, 1.8), std(new THREE.Color(SORT_COLORS[k]).multiplyScalar(0.75), { roughness: 0.6 }), 0, 0.06, 0);
      fill.scale.y = 0.001; fills.push(fill);
      // sign post behind the bin (towards the wall)
      const nx = Math.sign(dp.x), nz = Math.sign(dp.z);
      part(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 8), frameMat, nx * 1.3, 1.3, nz * 1.3);
      const icon = part(sortGeometry(k), std(SORT_COLORS[k], { ...SORT_MAT[k], emissive: SORT_COLORS[k], emissiveIntensity: 0.25 }), nx * 1.3, 2.75, nz * 1.3);
      icon.scale.setScalar(2.2);
      depotMeshes.push(icon);
      updaters.push((dt, t) => { icon.rotation.y = t * 0.6 + k; icon.position.y = 2.75 + Math.sin(t * 1.5 + k) * 0.06; });
    });
    setFill = (k, f) => { fills[k].scale.y = Math.max(0.001, f * 0.88); fills[k].position.y = 0.06 + fills[k].scale.y / 2; };

    // light shafts from the windows on the sunny side
    const shaftTex = textures.shaft();
    const shaftMat = new THREE.MeshBasicMaterial({ map: shaftTex, color: 0xfff1d6, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const shafts = new THREE.Group(); group.add(shafts);
    const shaftGeo = new THREE.PlaneGeometry(3.0, 16).translate(0, -8, 0);
    let shaftWall = -1;
    updaters.push((dt, t, sun) => {
      if (!sun) return;
      // pick the wall facing the sun
      let best = 0, bd = -Infinity;
      for (let s = 0; s < 4; s++) { const a = (s * Math.PI) / 2, dd = Math.sin(a) * sun.dir.x + Math.cos(a) * sun.dir.z; if (dd > bd) { bd = dd; best = s; } }
      if (best !== shaftWall) {
        shaftWall = best; shafts.clear();
        for (const w of windows.filter((w2) => Math.abs(w2.a - (best * Math.PI) / 2) < 0.01)) {
          for (let c = 0; c < 2; c++) {
            const p = new THREE.Mesh(shaftGeo, shaftMat);
            p.position.set(w.x, WH - 1.4, w.z); p.userData.c = c;
            shafts.add(p);
          }
        }
      }
      const dir = sun.dir.clone().negate();
      dir.y = Math.min(-0.35, dir.y);
      dir.normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
      for (const p of shafts.children) {
        p.quaternion.copy(q);
        if (p.userData.c) p.rotateY(Math.PI / 2);
      }
      shaftMat.opacity = 0.03 + 0.07 * Math.max(0, sun.elev) * (1 - sun.warm * 0.3);
      shaftMat.color.setRGB(1, 0.94 - sun.warm * 0.2, 0.84 - sun.warm * 0.35);
    });
    // dust motes
    let dustAcc = 0;
    updaters.push((dt) => {
      dustAcc += dt * 30;
      while (dustAcc > 1) {
        dustAcc--;
        fx.glow.emit((Math.random() - 0.5) * R * 1.8, 0.3 + Math.random() * 5, (Math.random() - 0.5) * R * 1.8, 1,
          { color: [0x3a352a, 0x2a271f], speed: 0.06, spread: 1, gravity: -0.005, drag: 0, size: 0.05, life: 9 });
      }
    });

    onPick = (it) => fx.soft.emit(it.x, 0.05, it.z, 8, { color: [0x9a968c, 0xb8b4aa], speed: 0.6, spread: 0.4, up: 0.2, gravity: 0.3, drag: 3, size: 0.18, life: 0.8, jitter: 0.15, flat: true });
    onDrop = (k) => {
      const dp = layout.depots[k];
      fx.soft.emit(dp.x, 1.0, dp.z, 16, { color: [SORT_COLORS[k], 0xffffff], speed: 2.2, spread: 0.35, up: 1.5, gravity: 6, size: 0.07, life: 1, jitter: 0.4 });
    };
  } else {
    env = {
      outdoor: true, sky: { turbidity: 10, rayleigh: 2.5, mieCoefficient: 0.012, mieDirectionalG: 0.9 },
      fogDay: 0x5d6b6e, fogDusk: 0x6e5a52, fogDensity: 0.0095,
      hemi: [0xa9bcc6, 0x4a4030, 0.95], sun: 2.1, bloom: [0.85, 0.7, 0.8], exposure: 0.95, shadow: 30,
    };
    const R = layout.size.radius;
    plane(500, 500, lam({ map: textures.forest(90) }), -0.01);
    const clearing = new THREE.Mesh(new THREE.CircleGeometry(R + 4, 64), std(0xc9c0a0, { map: textures.forest(14) }));
    clearing.rotation.x = -Math.PI / 2; clearing.position.y = 0.003; clearing.receiveShadow = true; group.add(clearing);
    const scorch = plane(15, 15, new THREE.MeshBasicMaterial({ color: 0x0a0604, alphaMap: textures.radial(), transparent: true, opacity: 0.5, depthWrite: false }), 0.008);
    scorch.receiveShadow = false;

    // logs: bark sides, end grain caps
    const logGeo = new THREE.CylinderGeometry(0.13, 0.15, 1.1, 9);
    logGeo.rotateZ(Math.PI / 2); logGeo.translate(0, 0.14, 0);
    const lm = instanced(logGeo, logMaterials(), all, (it, o) => {
      o.position.set(it.x, 0, it.z); o.rotation.set(0, it.rot, 0); o.scale.set(it.size, 1, 1);
    });
    const tint = new THREE.Color();
    for (let k = 0; k < lm.count; k++) { tint.setHSL(0.08, 0.2 + rng() * 0.2, 0.75 + rng() * 0.25); lm.setColorAt(k, tint); }
    // stumps the logs came from
    scatter(new THREE.CylinderGeometry(0.28, 0.36, 0.4, 10).translate(0, 0.2, 0), logMaterials(), 160, (o) => {
      const a = rng() * 6.28, r = 9 + rng() * (R - 8);
      o.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); o.scale.setScalar(0.7 + rng() * 0.8); o.rotation.y = rng() * 6;
    });
    // rocks
    scatter(rockGeo(rng), std(0xffffff, { vertexColors: true, flatShading: true, roughness: 0.95 }), 140, (o) => {
      const a = rng() * 6.28, r = 6 + rng() * (R + 30);
      o.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); o.scale.setScalar(0.3 + Math.pow(rng(), 3) * 2.2); o.rotation.y = rng() * 6;
    });
    // forest
    const pine = pineGeo(rng);
    scatter(pine, windy(std(0xffffff, { vertexColors: true, flatShading: true }), 0.012), Math.round(700 * Math.max(0.5, quality)), (o) => {
      const a = rng() * 6.28, r = R + 4 + Math.pow(rng(), 0.8) * 60;
      o.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); o.scale.setScalar(1.1 + rng() * 1.5); o.rotation.y = rng() * 6;
    }, { colors: (c) => c.setHSL(0.3, 0.15, 0.7 + rng() * 0.45) });
    // dead trees
    const dead = merge([
      gradientColor(new THREE.CylinderGeometry(0.08, 0.22, 5, 6).translate(0, 2.5, 0), 0x3a2e24, 0x6b5a4a, 0, 5),
      gradientColor(new THREE.CylinderGeometry(0.03, 0.07, 1.6, 4).rotateZ(0.9).translate(0.6, 3.2, 0), 0x5a4a3a, 0x6b5a4a, 2, 4),
      gradientColor(new THREE.CylinderGeometry(0.03, 0.06, 1.3, 4).rotateZ(-1.0).translate(-0.5, 3.8, 0.1), 0x5a4a3a, 0x6b5a4a, 3, 5),
    ]);
    scatter(dead, std(0xffffff, { vertexColors: true }), 30, (o) => {
      const a = rng() * 6.28, r = R + 1 + rng() * 10;
      o.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); o.rotation.set((rng() - 0.5) * 0.15, rng() * 6, (rng() - 0.5) * 0.15); o.scale.setScalar(0.8 + rng() * 0.6);
    });
    // dry grass at the edge, sparse tufts in the clearing
    const blade = bladeGeo(rng, 4);
    const grassMat = windy(lam({ vertexColors: true, side: THREE.DoubleSide }), 0.35);
    scatter(blade, grassMat, Math.round(20000 * quality), (o) => {
      const edge = rng() < 0.8;
      const a = rng() * 6.28, r = edge ? R + 1 + Math.pow(rng(), 0.6) * 40 : 8 + rng() * R;
      o.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); o.rotation.y = rng() * 6;
      o.scale.set(1, edge ? 0.8 + rng() * 1.0 : 0.35 + rng() * 0.3, 1);
    }, { shadow: false, colors: (c) => c.setHSL(0.13 + rng() * 0.06, 0.3 + rng() * 0.2, 0.55 + rng() * 0.15) });

    // the core: a stone plinth, standing stones, rotating rings and a burning orb
    const stone = std(0x55524c, { roughness: 0.9, flatShading: true });
    add(new THREE.CylinderGeometry(2.4, 2.8, 0.35, 12), stone, 0, 0.17, 0);
    add(new THREE.CylinderGeometry(1.8, 2.2, 0.35, 12), stone, 0, 0.5, 0);
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2;
      const s = add(new THREE.BoxGeometry(0.45, 1.2 + rng() * 0.8, 0.3), stone, Math.cos(a) * 5.2, 0.6, Math.sin(a) * 5.2);
      s.rotation.set((rng() - 0.5) * 0.15, -a, (rng() - 0.5) * 0.2);
    }
    const orbMat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uFill: { value: 0 }, uFlash: { value: 0 } }, vertexShader: ORB_VERT, fragmentShader: ORB_FRAG });
    const orb = add(new THREE.IcosahedronGeometry(1.15, 5), orbMat, 0, 2.1, 0, { shadow: false });
    depotMeshes.push(orb);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures.radial(), color: 0xff7a2a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.6, fog: false }));
    glow.position.set(0, 2.1, 0); glow.scale.setScalar(9); group.add(glow);
    const ringMat = std(0x2a2522, { metalness: 0.85, roughness: 0.35, emissive: 0xff6a20, emissiveIntensity: 0.35 });
    const rings = [1.75, 2.15, 2.55].map((r, k) => {
      const m = add(new THREE.TorusGeometry(r, 0.035 + k * 0.01, 8, 96), ringMat, 0, 2.1, 0);
      m.rotation.set(rng() * 3, rng() * 3, 0);
      return m;
    });
    const light = new THREE.PointLight(0xff7a30, 40, 40, 1.5);
    light.position.set(0, 2.3, 0); group.add(light);
    let fill = 0, flash = 0, emberAcc = 0;
    setFill = (k, f) => { fill = f; };
    updaters.push((dt, t) => {
      flash = Math.max(0, flash - dt * 1.5);
      orbMat.uniforms.uTime.value = t; orbMat.uniforms.uFill.value = fill; orbMat.uniforms.uFlash.value = flash;
      rings.forEach((m, k) => { m.rotation.x += dt * (0.2 + k * 0.13); m.rotation.y += dt * (0.15 - k * 0.07); });
      light.intensity = 30 + fill * 40 + flash * 80 + Math.sin(t * 7) * 3 + Math.sin(t * 13) * 2;
      glow.material.opacity = 0.45 + fill * 0.3 + flash * 0.4;
      glow.scale.setScalar(8 + fill * 4 + flash * 3 + Math.sin(t * 3) * 0.3);
      emberAcc += dt * (14 + fill * 30);
      while (emberAcc > 1) {
        emberAcc--;
        const a = Math.random() * 6.28, r = Math.random() * 1.0;
        fx.glow.emit(Math.cos(a) * r, 2.1 + Math.random(), Math.sin(a) * r, 1, { color: [0xff8a30, 0xffc060, 0xff5a10], speed: 0.4, spread: 0.6, up: 1.1, gravity: -0.15, drag: 0.3, size: 0.07, life: 3 });
      }
    });
    onPick = (it) => {
      fx.soft.emit(it.x, 0.1, it.z, 10, { color: [0x6b4a2a, 0x8a6a35, 0x4d5a2c], speed: 1.4, spread: 0.6, up: 1, gravity: 5, size: 0.07, life: 1, jitter: 0.4 });
    };
    onDrop = () => {
      flash = 1;
      fx.glow.emit(0, 2.1, 0, 90, { color: [0xffb040, 0xff7020, 0xffe0a0], speed: 5, spread: 1, up: 1.5, gravity: 3, drag: 1.2, size: 0.09, life: 1.6, jitter: 0.6 });
    };
  }

  for (const m of meshes) if (m.instanceColor) m.instanceColor.needsUpdate = true;
  group.traverse((o) => { if (o.isInstancedMesh && o.instanceColor) o.instanceColor.needsUpdate = true; });

  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  function setPicked(i, picked) {
    for (const [m, k, mat] of parts[i]) { m.setMatrixAt(k, picked ? ZERO : mat); m.instanceMatrix.needsUpdate = true; }
  }
  function update(dt, t, sun) {
    windTime.value = t;
    for (const u of updaters) u(dt, t, sun);
  }
  function dispose() {
    group.removeFromParent();
    group.traverse((o) => {
      o.geometry?.dispose();
      for (const m of [].concat(o.material ?? [])) {
        if (_logMats?.includes(m)) continue;
        for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
        m.dispose();
      }
      if (o.isInstancedMesh) o.dispose();
    });
  }
  env.depotMeshes = depotMeshes;
  return {
    group, env, setPicked, update, dispose,
    onPick: (i) => onPick?.(items[i]),
    onDrop: (k, n) => onDrop?.(k, n),
    setFill: (k, f) => setFill?.(k, f),
  };
}
