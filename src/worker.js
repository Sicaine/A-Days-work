// The worker: an articulated figure in overalls, a flannel shirt and work gloves.
// Rigid-bone rig, procedural animation: walk, carry, pull/pick, unload/throw, idle.
// Over the day they get tired: posture sags, breathing gets heavier.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SORT_COLORS, sortGeometry, logMaterials } from './world.js';

// ---------- cloth textures (shared) ----------
let TEX = null;
function clothTextures() {
  if (TEX) return TEX;
  const make = (size, draw, rx, ry) => {
    const cv = document.createElement('canvas'); cv.width = cv.height = size;
    draw(cv.getContext('2d'), size);
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  };
  const noise = (c, s, a) => {
    const img = c.getImageData(0, 0, s, s), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * a; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    c.putImageData(img, 0, 0);
  };
  TEX = {
    plaid: make(128, (c, s) => {
      c.fillStyle = '#8f2f27'; c.fillRect(0, 0, s, s);
      c.fillStyle = 'rgba(25,12,12,0.55)';
      for (let k = 0; k < s; k += 32) { c.fillRect(k, 0, 14, s); c.fillRect(0, k, s, 14); }
      c.fillStyle = 'rgba(25,12,12,0.35)';
      for (let k = 0; k < s; k += 32) { c.fillRect(k + 20, 0, 3, s); c.fillRect(0, k + 20, s, 3); }
      c.fillStyle = 'rgba(230,200,170,0.25)';
      for (let k = 0; k < s; k += 32) { c.fillRect(k + 27, 0, 1, s); c.fillRect(0, k + 27, s, 1); }
      noise(c, s, 14);
    }, 3, 2),
    denim: make(128, (c, s) => {
      c.fillStyle = '#3b5675'; c.fillRect(0, 0, s, s);
      c.strokeStyle = 'rgba(255,255,255,0.06)'; c.lineWidth = 1;
      for (let k = -s; k < s * 2; k += 3) { c.beginPath(); c.moveTo(k, 0); c.lineTo(k + s, s); c.stroke(); }
      noise(c, s, 18);
    }, 2, 2),
  };
  return TEX;
}

const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...o });
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

// dimensions (metres)
const THIGH = 0.42, SHIN = 0.41, FOOT_H = 0.1, HIP_W = 0.095;

export function makeWorker(job, { ghost = false } = {}) {
  const tex = clothTextures();
  const ghostMat = std({ color: 0xdfe8ff, transparent: true, opacity: 0.42, depthWrite: false, emissive: 0x7f9fff, emissiveIntensity: 0.55 });
  const M = ghost ? new Proxy({}, { get: () => ghostMat }) : {
    denim: std({ map: tex.denim, color: 0xffffff }),
    denimDark: std({ color: 0x2c4058 }),
    plaid: std({ map: tex.plaid, color: 0xffffff }),
    skin: std({ color: 0xd6a283, roughness: 0.7 }),
    hair: std({ color: 0x3a2a1e, roughness: 0.95 }),
    cap: std({ color: 0xc0532f, roughness: 0.85 }),
    glove: std({ color: 0xb98a55, roughness: 0.95 }),
    boot: std({ color: 0x5a3b26, roughness: 0.75 }),
    sole: std({ color: 0x1f1b18, roughness: 0.9 }),
    dark: std({ color: 0x1c1512, roughness: 0.6 }),
    brass: std({ color: 0xc9a54a, roughness: 0.35, metalness: 0.8 }),
    rag: std({ color: 0xb8322a, roughness: 0.95, side: THREE.DoubleSide }),
  };

  // merge several geometries of one material into one mesh on a bone
  const part = (bone, material, ...geos) => {
    const g = geos.length > 1 ? mergeGeometries(geos.map(strip)) : geos[0];
    const m = new THREE.Mesh(g, material);
    m.castShadow = !ghost; m.receiveShadow = !ghost;
    bone.add(m);
    return m;
  };
  const bone = (parent, x = 0, y = 0, z = 0) => { const b = new THREE.Group(); b.position.set(x, y, z); parent.add(b); return b; };
  const at = (geo, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    geo.scale(sx, sy, sz);
    if (rx || ry || rz) geo.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
    return geo.translate(x, y, z);
  };
  const lathe = (pts, segs = 20) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segs);
  const taper = (r0, r1, len, segs = 12) => new THREE.CylinderGeometry(r1, r0, len, segs).translate(0, -len / 2, 0);

  // ---------- rig ----------
  const root = new THREE.Group();
  const J = {};
  J.pelvis = bone(root, 0, THIGH + SHIN + FOOT_H + 0.04, 0);
  J.spine = bone(J.pelvis, 0, 0.04, 0);
  J.chest = bone(J.spine, 0, 0.2, 0);
  J.neck = bone(J.chest, 0, 0.255, -0.01);
  J.head = bone(J.neck, 0, 0.06, 0.01);

  // pelvis & abdomen (overalls)
  part(J.pelvis, M.denim, at(lathe([[0.001, -0.1], [0.07, -0.095], [0.13, -0.06], [0.148, 0.0], [0.15, 0.06]]), 0, 0, 0, 0, 0, 0, 1, 1, 0.72));
  part(J.spine, M.denim, at(lathe([[0.15, -0.02], [0.152, 0.08], [0.152, 0.2]]), 0, 0, 0, 0, 0, 0, 1, 1, 0.7));
  // chest (flannel) with the overall bib and straps on top
  part(J.chest, M.plaid, at(lathe([[0.15, -0.02], [0.168, 0.1], [0.18, 0.18], [0.17, 0.225], [0.12, 0.262], [0.05, 0.28], [0.001, 0.282]]), 0, 0, 0, 0, 0, 0, 1, 1, 0.7));
  part(J.chest, M.denim,
    at(new THREE.BoxGeometry(0.2, 0.17, 0.02), 0, 0.07, 0.112),
    at(new THREE.BoxGeometry(0.22, 0.12, 0.02), 0, 0.05, -0.108),
    at(new THREE.BoxGeometry(0.035, 0.24, 0.012), -0.08, 0.2, 0.09, -0.55, 0, 0),
    at(new THREE.BoxGeometry(0.035, 0.24, 0.012), 0.08, 0.2, 0.09, -0.55, 0, 0),
    at(new THREE.BoxGeometry(0.035, 0.26, 0.012), -0.07, 0.17, -0.095, 0.5, 0, 0.12),
    at(new THREE.BoxGeometry(0.035, 0.26, 0.012), 0.07, 0.17, -0.095, 0.5, 0, -0.12),
  );
  part(J.chest, M.denimDark, at(new THREE.BoxGeometry(0.09, 0.07, 0.008), 0, 0.09, 0.124)); // bib pocket
  part(J.chest, M.brass, at(new THREE.CylinderGeometry(0.012, 0.012, 0.01, 10), -0.08, 0.15, 0.123, Math.PI / 2), at(new THREE.CylinderGeometry(0.012, 0.012, 0.01, 10), 0.08, 0.15, 0.123, Math.PI / 2));
  // collar
  part(J.chest, M.plaid, at(new THREE.TorusGeometry(0.055, 0.016, 6, 16), 0, 0.27, 0.0, Math.PI / 2 + 0.25, 0, 0, 1, 1.15, 1));

  // neck & head
  part(J.neck, M.skin, at(new THREE.CylinderGeometry(0.042, 0.048, 0.09, 12), 0, 0.02, 0));
  part(J.head, M.skin,
    at(new THREE.SphereGeometry(0.098, 20, 16), 0, 0.1, 0, 0, 0, 0, 1, 1.12, 1.04),
    at(new THREE.SphereGeometry(0.082, 16, 12), 0, 0.068, 0.012, 0, 0, 0, 0.92, 0.85, 0.95),
    at(new THREE.BoxGeometry(0.022, 0.04, 0.03), 0, 0.085, 0.1, -0.25),
    at(new THREE.SphereGeometry(0.024, 10, 8), -0.098, 0.095, -0.005, 0, 0, 0, 0.45, 1, 0.75),
    at(new THREE.SphereGeometry(0.024, 10, 8), 0.098, 0.095, -0.005, 0, 0, 0, 0.45, 1, 0.75),
  );
  part(J.head, M.dark,
    at(new THREE.SphereGeometry(0.011, 8, 6), -0.034, 0.113, 0.091),
    at(new THREE.SphereGeometry(0.011, 8, 6), 0.034, 0.113, 0.091),
    at(new THREE.BoxGeometry(0.034, 0.004, 0.006), 0, 0.048, 0.093),
  );
  part(J.head, M.hair,
    at(new THREE.SphereGeometry(0.104, 18, 12, Math.PI, Math.PI, 0, Math.PI * 0.62), 0, 0.108, -0.006),
    at(new THREE.BoxGeometry(0.036, 0.008, 0.01), -0.034, 0.131, 0.093, 0, 0, 0.1),
    at(new THREE.BoxGeometry(0.036, 0.008, 0.01), 0.034, 0.131, 0.093, 0, 0, -0.1),
  );
  part(J.head, M.cap,
    at(new THREE.SphereGeometry(0.108, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), 0, 0.14, -0.006, -0.1, 0, 0, 1.02, 0.72, 1.04),
    at(new THREE.CylinderGeometry(0.085, 0.085, 0.01, 20, 1, false, -Math.PI / 2, Math.PI), 0, 0.15, 0.075, 0.18, 0, 0, 1, 1, 1.3),
    at(new THREE.SphereGeometry(0.011, 8, 6), 0, 0.218, -0.016),
  );

  // legs
  const leg = (s) => {
    const hip = bone(J.pelvis, s * HIP_W, -0.04, 0);
    part(hip, M.denim, taper(0.09, 0.068, THIGH), at(new THREE.SphereGeometry(0.09, 12, 10), 0, -0.02, 0, 0, 0, 0, 1, 0.9, 1));
    const knee = bone(hip, 0, -THIGH, 0);
    part(knee, M.denim, at(new THREE.SphereGeometry(0.066, 12, 10), 0, 0, 0), taper(0.064, 0.055, SHIN - 0.04));
    part(knee, M.denimDark, at(new THREE.CylinderGeometry(0.064, 0.064, 0.05, 12), 0, -SHIN + 0.07, 0)); // rolled cuff
    const ankle = bone(knee, 0, -SHIN, 0);
    part(ankle, M.boot,
      at(new THREE.CylinderGeometry(0.056, 0.06, 0.09, 12), 0, 0.0, 0),
      at(new THREE.SphereGeometry(0.06, 12, 10), 0, -0.055, 0.045, 0, 0, 0, 1, 0.65, 1.9),
    );
    part(ankle, M.sole, at(new THREE.BoxGeometry(0.115, 0.022, 0.27), 0, -FOOT_H + 0.011, 0.04));
    return { hip, knee, ankle };
  };
  J.L = leg(-1); J.R = leg(1);

  // arms
  const arm = (s) => {
    const sh = bone(J.chest, s * 0.19, 0.21, -0.005);
    part(sh, M.plaid, at(new THREE.SphereGeometry(0.056, 12, 10), 0, -0.025, 0), taper(0.056, 0.05, 0.27));
    const el = bone(sh, 0, -0.27, 0);
    part(el, M.plaid, at(new THREE.SphereGeometry(0.05, 10, 8), 0, 0, 0), at(new THREE.TorusGeometry(0.047, 0.016, 6, 14), 0, -0.07, 0, Math.PI / 2));
    part(el, M.skin, taper(0.042, 0.035, 0.22));
    const wr = bone(el, 0, -0.235, 0);
    part(wr, M.glove,
      at(new THREE.CylinderGeometry(0.042, 0.038, 0.05, 10), 0, 0.01, 0),
      at(new THREE.SphereGeometry(0.04, 10, 8), 0, -0.04, 0.005, 0, 0, 0, 0.95, 1.25, 0.6),
      at(new THREE.CapsuleGeometry(0.017, 0.05, 3, 8), 0, -0.085, 0.012, 0.25, 0, 0, 1.9, 1, 0.9),
      at(new THREE.CapsuleGeometry(0.014, 0.035, 3, 6), -s * 0.035, -0.04, 0.025, 0.4, 0, -s * 0.7),
    );
    return { sh, el, wr, s };
  };
  J.armL = arm(-1); J.armR = arm(1);

  // a red rag in the back pocket
  const ragPivot = bone(J.pelvis, 0.07, -0.02, -0.11);
  part(ragPivot, M.rag, at(new THREE.PlaneGeometry(0.07, 0.15), 0, -0.07, 0));

  // carry anchors
  const front = bone(J.chest, 0, 0.0, 0.3);
  const bagPivot = bone(J.chest, 0, 0.27, -0.02);
  const back = bone(bagPivot, 0, -0.17, -0.2);

  // ---------- carried things ----------
  let carryN = -1, carryType = -1;
  function setCarry(n, type = 0) {
    if (n === carryN && type === carryType) return;
    carryN = n; carryType = type;
    front.clear(); back.clear();
    if (!n) return;
    if (job.id === 'weeds') {
      const f = n / job.params.cap;
      const sack = part(back, ghost ? ghostMat : std({ color: 0xbca878, roughness: 1 }),
        lathe([[0.001, -0.17], [0.12, -0.15], [0.17, -0.05], [0.16, 0.06], [0.1, 0.13], [0.04, 0.16], [0.06, 0.2]], 14));
      sack.scale.set(0.65 + f * 0.5, 0.6 + f * 0.6, 0.55 + f * 0.45);
      const leaves = Math.min(7, Math.ceil(f * 7));
      for (let k = 0; k < leaves; k++) {
        const l = part(back, ghost ? ghostMat : std({ color: k % 2 ? 0x5f8f3a : 0x4b7a2e, side: THREE.DoubleSide }), new THREE.ConeGeometry(0.035, 0.2, 3).translate(0, 0.1, 0));
        l.position.set((k / 6 - 0.5) * 0.12, 0.13 * (0.6 + f * 0.6), 0);
        l.rotation.set((Math.random() - 0.5) * 0.6, k, (k / 6 - 0.5) * 1.1);
      }
      // strap over the left shoulder
      part(back, ghost ? ghostMat : std({ color: 0x6b5a3a }), at(new THREE.TorusGeometry(0.2, 0.012, 5, 20, Math.PI * 0.9), -0.08, 0.05, 0.2, 0, Math.PI / 2, 0.4));
    } else if (job.id === 'sorting') {
      const m = part(front, ghost ? ghostMat : std({ color: SORT_COLORS[type], roughness: 0.45 }), sortGeometry(type));
      m.position.set(0, -0.2, -0.02);
    } else {
      const mats = ghost ? ghostMat : logMaterials();
      for (let k = 0; k < n; k++) {
        const log = part(front, mats, new THREE.CylinderGeometry(0.13, 0.15, 1.0, 9));
        log.rotation.z = Math.PI / 2;
        log.position.set(0, -0.2 + k * 0.24, -0.02 + k * 0.03);
      }
    }
  }

  // ---------- animation ----------
  const KEYS = ['pRoll', 'pYaw', 'spine', 'chest', 'chestYaw', 'neck', 'headYaw', 'hipL', 'kneeL', 'hipR', 'kneeR',
    'shLx', 'shLz', 'elL', 'wrL', 'shRx', 'shRz', 'elR', 'wrR', 'bag'];
  const cur = Object.fromEntries(KEYS.map((k) => [k, 0]));
  const T = { ...cur };
  let phase = 0, time = Math.random() * 10, idleFor = 0, gesture = null, actW = 0;

  function walkPose(A, armAmp) {
    const s = Math.sin(phase), c = Math.cos(phase);
    T.hipL = -0.42 * A * s; T.hipR = 0.42 * A * s;
    T.kneeL = 0.06 + 0.8 * A * Math.pow(Math.max(0, c), 1.3);
    T.kneeR = 0.06 + 0.8 * A * Math.pow(Math.max(0, -c), 1.3);
    T.pRoll = 0.04 * s * A; T.pYaw = 0.1 * s * A; T.chestYaw = -0.15 * s * A;
    T.shLx = 0.42 * s * A * armAmp; T.shRx = -0.42 * s * A * armAmp;
    T.elL = -0.2 - 0.45 * Math.max(0, -s) * armAmp; T.elR = -0.2 - 0.45 * Math.max(0, s) * armAmp;
    T.shLz = -0.06; T.shRz = 0.06;
    T.spine = 0.05; T.chest = 0.02;
  }
  function idlePose(fatigue) {
    const b = Math.sin(time * (1.6 + fatigue * 1.2));
    const w = Math.sin(time * 0.37);
    T.spine = 0.02; T.chest = 0.015 * b * (1 + fatigue * 1.5);
    T.pRoll = 0.025 * w; T.pYaw = 0;
    T.hipL = -0.02; T.hipR = -0.02;
    T.kneeL = 0.04 + 0.12 * Math.max(0, w); T.kneeR = 0.04 + 0.12 * Math.max(0, -w);
    T.shLx = 0.04; T.shRx = 0.04; T.shLz = -0.08 - 0.01 * b; T.shRz = 0.08 + 0.01 * b;
    T.elL = -0.14; T.elR = -0.14; T.chestYaw = 0;
    T.headYaw = 0.45 * Math.sin(time * 0.23) * Math.sin(time * 0.11 + 1);
  }
  function carryPose(heavyLean) {
    if (job.id === 'sorting') {
      T.shLx = T.shRx = -0.55; T.elL = T.elR = -1.0; T.shLz = 0.14; T.shRz = -0.14; T.wrL = T.wrR = 0.3;
    } else if (job.id === 'core') {
      T.shLx = T.shRx = -0.4; T.elL = T.elR = -1.45; T.shLz = -0.02; T.shRz = 0.02;
      T.spine -= 0.07 * heavyLean; T.chest -= 0.05 * heavyLean;
    } else {
      // hold the sack strap with the left hand, lean into the load
      T.shLx = -0.35; T.elL = -2.1; T.shLz = 0.22; T.wrL = 0.4;
      T.spine += 0.14 * (carryN / job.params.cap);
    }
  }
  function actionPose(action, u, n) {
    const P = {};
    if (action === 'pick' && job.id === 'weeds') {
      const down = ss(0, 0.3, u) * (1 - ss(0.82, 1, u) * 0.85);
      const tug = u > 0.3 && u < 0.85 ? Math.abs(Math.sin((u - 0.3) * Math.PI * 7)) : 0;
      Object.assign(P, {
        hipL: -1.1 * down, hipR: -0.95 * down, kneeL: 1.6 * down, kneeR: 1.4 * down,
        spine: 0.85 * down - 0.12 * tug, chest: 0.45 * down, neck: -0.45 * down,
        shLx: -1.1 * down + 0.3 * tug, shRx: -1.1 * down + 0.3 * tug, elL: -0.15 - 0.5 * tug, elR: -0.15 - 0.5 * tug,
        shLz: 0.08, shRz: -0.08, wrL: 0.3, wrR: 0.3,
      });
      const toss = ss(0.82, 1, u); // over the shoulder into the sack
      P.shRx = mix(P.shRx, -2.9, toss); P.elR = mix(P.elR, -1.3, toss); P.shRz = mix(P.shRz, 0.25, toss);
    } else if (action === 'pick') {
      const d = ss(0, 0.35, u) * (1 - ss(0.8, 1, u) * 0.6);
      const heavy = job.id === 'core';
      const strain = heavy && u > 0.5 ? Math.sin(u * 40) * 0.03 : 0;
      Object.assign(P, {
        hipL: -1.25 * d, hipR: -1.15 * d, kneeL: 1.85 * d, kneeR: 1.7 * d,
        spine: 0.4 * d + strain, chest: 0.15 * d, neck: -0.25 * d,
        shLx: -0.9 * d, shRx: -0.9 * d, elL: -0.25, elR: -0.25,
        shLz: heavy ? -0.15 : 0.12, shRz: heavy ? 0.15 : -0.12, wrL: 0.2, wrR: 0.2,
      });
    } else if (action === 'drop' && job.id === 'weeds') {
      const a = ss(0, 0.25, u) * (1 - ss(0.85, 1, u));
      const b = ss(0.25, 0.55, u) * (1 - ss(0.85, 1, u));
      Object.assign(P, {
        shLx: -2.5 * a, shRx: -2.5 * a, elL: -1.7 * a, elR: -1.7 * a, shLz: 0.1, shRz: -0.1,
        spine: 0.85 * b + 0.05 * Math.sin(u * 70) * b, chest: 0.3 * b, neck: -0.2 * b,
        hipL: -0.35 * b, hipR: -0.35 * b, kneeL: 0.4 * b, kneeR: 0.4 * b,
        bag: -2.3 * b,
      });
    } else if (action === 'drop' && job.id === 'sorting') {
      const d = ss(0, 0.3, u) * (1 - ss(0.8, 1, u));
      Object.assign(P, {
        spine: 0.5 * d, chest: 0.15 * d, neck: -0.2 * d, hipL: -0.3 * d, hipR: -0.3 * d, kneeL: 0.4 * d, kneeR: 0.4 * d,
        shLx: mix(-0.55, -1.2, d), shRx: mix(-0.55, -1.2, d), elL: mix(-1.0, -0.3, d), elR: mix(-1.0, -0.3, d), shLz: 0.14, shRz: -0.14,
      });
    } else if (action === 'drop') {
      // the core: swing each log down, then heave it up and in
      const p = job.params, tt = u * (p.dropFixed + p.dropPerItem * n);
      const v = tt < p.dropFixed ? 0 : ((tt - p.dropFixed) % p.dropPerItem) / p.dropPerItem;
      const w = ss(0, 0.5, v), r = ss(0.5, 0.78, v), back = ss(0.85, 1, v);
      Object.assign(P, {
        shLx: mix(mix(-0.4, 0.4, w), -2.4, r) * (1 - back) - 0.4 * back, shRx: 0,
        elL: mix(-1.45, -0.35, Math.max(w, r)), elR: 0,
        spine: mix(mix(0, 0.45, w), -0.18, r) * (1 - back), chest: 0.1 * w,
        hipL: -0.45 * w * (1 - r), hipR: -0.45 * w * (1 - r), kneeL: 0.65 * w * (1 - r), kneeR: 0.65 * w * (1 - r),
        shLz: -0.05, shRz: 0.05, neck: -0.3 * r,
      });
      P.shRx = P.shLx; P.elR = P.elL;
      // logs leave the arms one by one at the release point
      const gone = tt < p.dropFixed ? 0 : Math.floor((tt - p.dropFixed + p.dropPerItem * 0.25) / p.dropPerItem);
      front.children.forEach((c, k) => { c.visible = k < n - gone; });
    }
    return P;
  }
  function gesturePose(gname, g) {
    const k = ss(0, 0.2, g) * (1 - ss(0.8, 1, g));
    if (gname === 'stretch') { // hands to the lower back, lean back
      T.shLx = mix(T.shLx, 0.7, k); T.shRx = mix(T.shRx, 0.7, k); T.elL = mix(T.elL, -1.6, k); T.elR = mix(T.elR, -1.6, k);
      T.shLz = mix(T.shLz, -0.35, k); T.shRz = mix(T.shRz, 0.35, k);
      T.spine = mix(T.spine, -0.22, k); T.chest = mix(T.chest, -0.15, k); T.neck = mix(T.neck, 0.25, k);
    } else if (gname === 'wipe') { // back of the glove across the forehead
      const sweep = Math.sin(g * Math.PI * 2) * 0.25;
      T.shRx = mix(T.shRx, -2.1, k); T.elR = mix(T.elR, -2.1, k); T.shRz = mix(T.shRz, -0.45 + sweep, k);
      T.neck = mix(T.neck, -0.1, k); T.headYaw = mix(T.headYaw, -0.2, k);
    } else if (gname === 'look') {
      T.headYaw = mix(T.headYaw, 0.9 * Math.sin(g * Math.PI * 2), k);
      T.chestYaw = mix(T.chestYaw, 0.2 * Math.sin(g * Math.PI * 2), k);
    }
  }

  /*
   * state: moving, speed (m/s), action: null | 'pick' | 'drop', u: action progress 0..1,
   * fatigue: 0..1 over the workday
   */
  function animate(dt, { moving = false, speed = 1.4, action = null, u = 0, fatigue = 0 } = {}) {
    time += dt;
    const carrying = carryN > 0;
    const heavy = job.id === 'core' && carrying;
    if (moving) phase += dt * Math.PI * 2 * (speed / (heavy ? 1.15 : 1.4));

    for (const k of KEYS) T[k] = 0;
    if (moving) walkPose(heavy ? 0.75 : 1, (carrying && job.id !== 'weeds' ? 0 : 1) * (1 - 0.25 * fatigue));
    else idlePose(fatigue);
    if (carrying && action !== 'drop') carryPose(heavy ? 1 : 0);

    // tiredness: the day weighs on the shoulders
    T.spine += 0.07 * fatigue; T.chest += 0.09 * fatigue; T.neck += 0.14 * fatigue;
    T.shLz += 0.05 * fatigue; T.shRz -= 0.05 * fatigue;

    // little gestures when standing still
    if (!moving && !action) {
      idleFor += dt;
      if (!gesture && idleFor > 6 && Math.random() < dt * (0.12 + fatigue * 0.25)) {
        const pool = carrying ? ['look'] : fatigue > 0.25 ? ['stretch', 'wipe', 'look', 'wipe'] : ['look', 'stretch', 'look'];
        gesture = { name: pool[Math.floor(Math.random() * pool.length)], t: 0, len: 2.4 + Math.random() };
      }
    } else { idleFor = 0; gesture = null; }
    if (gesture) {
      gesture.t += dt;
      gesturePose(gesture.name, gesture.t / gesture.len);
      if (gesture.t > gesture.len) { gesture = null; idleFor = 0; }
    }

    // actions blend in quickly
    actW = mix(actW, action ? 1 : 0, 1 - Math.exp(-dt * 12));
    if (action) {
      const P = actionPose(action, u, carryN);
      for (const k of Object.keys(P)) T[k] = mix(T[k], P[k], actW);
    } else if (job.id === 'core') front.children.forEach((c) => { c.visible = true; });

    const k = 1 - Math.exp(-dt * (moving ? 20 : 12));
    for (const key of KEYS) cur[key] += (T[key] - cur[key]) * k;
    apply();
  }

  function apply() {
    const C = cur;
    J.pelvis.rotation.set(0, C.pYaw, C.pRoll);
    J.spine.rotation.set(C.spine, 0, -C.pRoll * 0.6);
    J.chest.rotation.set(C.chest, C.chestYaw, 0);
    J.neck.rotation.set(C.neck - (C.spine + C.chest) * 0.35, C.headYaw * 0.4, 0);
    J.head.rotation.set(0, C.headYaw * 0.6, 0);
    for (const [L, hip, knee] of [[J.L, C.hipL, C.kneeL], [J.R, C.hipR, C.kneeR]]) {
      L.hip.rotation.set(hip, 0, 0);
      L.knee.rotation.set(knee, 0, 0);
      L.ankle.rotation.set(-(hip + knee) * 0.9, 0, 0); // keep the sole roughly flat
    }
    for (const [A, x, z, e, w] of [[J.armL, C.shLx, C.shLz, C.elL, C.wrL], [J.armR, C.shRx, C.shRz, C.elR, C.wrR]]) {
      A.sh.rotation.set(x, 0, z);
      A.el.rotation.set(e, 0, 0);
      A.wr.rotation.set(w, 0, 0);
    }
    bagPivot.rotation.x = C.bag;
    // ground the planted foot and keep the feet under the body
    const ext = (h, kn) => THIGH * Math.cos(h) + SHIN * Math.cos(h + kn);
    const fz = (h, kn) => -THIGH * Math.sin(h) - SHIN * Math.sin(h + kn);
    const eL = ext(C.hipL, C.kneeL), eR = ext(C.hipR, C.kneeR);
    J.pelvis.position.y = Math.max(eL, eR) + FOOT_H + 0.04;
    J.pelvis.position.z = -(fz(C.hipL, C.kneeL) + fz(C.hipR, C.kneeR)) / 2 * 0.9;
    ragPivot.rotation.x = 0.15 + Math.max(0, -Math.min(C.hipL, C.hipR)) * 0.6 + Math.sin(time * 3) * 0.05;
  }
  apply();

  return { group: root, setCarry, animate };
}

// keep the attributes every primitive has, so they can be merged
function strip(g) {
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  return g;
}
