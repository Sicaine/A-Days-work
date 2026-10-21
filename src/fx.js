// Particles, procedural textures and small shader helpers.
import * as THREE from 'three';

// ---------- particles ----------
// One Points object, a ring buffer of particles with velocity, gravity and drag.
export class Particles {
  constructor(cap, { additive = false } = {}) {
    this.cap = cap;
    this.next = 0;
    this.pos = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 3);
    this.size = new Float32Array(cap);
    this.alpha = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.max = new Float32Array(cap).fill(1);
    this.grav = new Float32Array(cap);
    this.drag = new Float32Array(cap);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 } },
      vertexShader: /* glsl */`
        attribute float aSize; attribute float aAlpha;
        varying vec3 vColor; varying float vAlpha;
        uniform float uScale;
        void main() {
          vColor = color; vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vColor; varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = smoothstep(1.0, 0.35, d) * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor, a);
        }`,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }
  setScale(heightPx, fovDeg) {
    this.material.uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }
  /*
   * opts: color (hex or array of hex), speed, spread (0 = straight up, 1 = any direction),
   * up (extra upward speed), gravity, drag, life, size, jitter (position radius)
   */
  emit(x, y, z, n, o = {}) {
    const colors = [].concat(o.color ?? 0xffffff).map((c) => new THREE.Color(c));
    const speed = o.speed ?? 1, spread = o.spread ?? 1, up = o.up ?? 0;
    for (let k = 0; k < n; k++) {
      const i = this.next; this.next = (this.next + 1) % this.cap;
      const j = o.jitter ?? 0;
      this.pos[i * 3] = x + (Math.random() - 0.5) * j * 2;
      this.pos[i * 3 + 1] = y + (Math.random() - 0.5) * j * (o.flat ? 0 : 1);
      this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * j * 2;
      const a = Math.random() * Math.PI * 2, el = Math.acos(1 - Math.random() * spread);
      const s = speed * (0.4 + Math.random() * 0.6);
      this.vel[i * 3] = Math.cos(a) * Math.sin(el) * s;
      this.vel[i * 3 + 1] = Math.cos(el) * s + up;
      this.vel[i * 3 + 2] = Math.sin(a) * Math.sin(el) * s;
      const c = colors[Math.floor(Math.random() * colors.length)];
      this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
      this.size[i] = (o.size ?? 0.1) * (0.6 + Math.random() * 0.8);
      this.max[i] = this.life[i] = (o.life ?? 1) * (0.6 + Math.random() * 0.8);
      this.grav[i] = o.gravity ?? 0;
      this.drag[i] = o.drag ?? 0.5;
    }
  }
  update(dt) {
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const f = Math.max(0, this.life[i] / this.max[i]);
      this.alpha[i] = Math.min(1, (1 - f) * 8) * Math.min(1, f * 2.5);
      const dr = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= dr; this.vel[i * 3 + 2] *= dr;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * dr - this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] = Math.max(0.02, this.pos[i * 3 + 1] + this.vel[i * 3 + 1] * dt);
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.aAlpha.needsUpdate = a.color.needsUpdate = a.aSize.needsUpdate = true;
  }
}

// ---------- procedural textures ----------
function rand(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Draws with wrap-around so the texture tiles seamlessly.
function canvasTexture(size, seed, draw, { repeat = 1, srgb = true } = {}) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const c = cv.getContext('2d');
  const r = rand(seed);
  const wrap = (fn) => (x, y, ...rest) => {
    for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) fn(x + dx, y + dy, ...rest);
  };
  draw(c, r, wrap, size);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function grain(c, size, r, amount) {
  const img = c.getImageData(0, 0, size, size), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amount;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  c.putImageData(img, 0, 0);
}

function blobs(c, r, wrap, size, n, colors, rMin, rMax, alpha) {
  const dot = wrap((x, y, rad, col) => {
    const g = c.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.beginPath(); c.arc(x, y, rad, 0, Math.PI * 2); c.fill();
  });
  c.globalAlpha = alpha;
  for (let k = 0; k < n; k++) dot(r() * size, r() * size, rMin + r() * (rMax - rMin), colors[Math.floor(r() * colors.length)]);
  c.globalAlpha = 1;
}

function specks(c, r, wrap, size, n, colors, rMin, rMax) {
  const e = wrap((x, y, rx, ry, rot, col) => {
    c.fillStyle = col; c.beginPath(); c.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); c.fill();
  });
  for (let k = 0; k < n; k++) {
    const rr = rMin + r() * (rMax - rMin);
    e(r() * size, r() * size, rr, rr * (0.5 + r() * 0.5), r() * 3, colors[Math.floor(r() * colors.length)]);
  }
}

export const textures = {
  soil: (repeat) => canvasTexture(512, 3, (c, r, wrap, s) => {
    c.fillStyle = '#5e4330'; c.fillRect(0, 0, s, s);
    blobs(c, r, wrap, s, 160, ['#4a3324', '#6f5139', '#3f2c1f', '#7a5a40'], 12, 60, 0.5);
    specks(c, r, wrap, s, 2600, ['#3a281b', '#7d6048', '#2f2016', '#8a6d52'], 0.8, 2.6);
    specks(c, r, wrap, s, 90, ['#8e8478', '#6f675e', '#a39887'], 1.5, 3.5); // pebbles
    grain(c, s, r, 22);
  }, { repeat }),
  grass: (repeat) => canvasTexture(512, 5, (c, r, wrap, s) => {
    c.fillStyle = '#5d7a3a'; c.fillRect(0, 0, s, s);
    blobs(c, r, wrap, s, 200, ['#4f6b30', '#6d8a45', '#45602a', '#7a8f48'], 20, 70, 0.5);
    specks(c, r, wrap, s, 2500, ['#4a662c', '#62803e', '#3d5524', '#55733a'], 0.8, 2.2);
    grain(c, s, r, 16);
  }, { repeat }),
  concrete: (repeat) => canvasTexture(1024, 7, (c, r, wrap, s) => {
    c.fillStyle = '#a9a69e'; c.fillRect(0, 0, s, s);
    blobs(c, r, wrap, s, 220, ['#9b988f', '#b4b1a8', '#8f8b82', '#bdb9ae'], 30, 140, 0.35);
    blobs(c, r, wrap, s, 25, ['#6f6a60', '#7d776b'], 20, 60, 0.18); // stains
    specks(c, r, wrap, s, 3000, ['#8a877f', '#c2bfb6', '#77746d'], 0.4, 1.3);
    // expansion joints
    c.strokeStyle = 'rgba(60,58,54,0.55)'; c.lineWidth = 2;
    for (const p of [0, s / 2]) { c.beginPath(); c.moveTo(p, 0); c.lineTo(p, s); c.stroke(); c.beginPath(); c.moveTo(0, p); c.lineTo(s, p); c.stroke(); }
    // hairline cracks
    c.strokeStyle = 'rgba(70,66,60,0.35)'; c.lineWidth = 1;
    for (let k = 0; k < 14; k++) {
      let x = r() * s, y = r() * s; c.beginPath(); c.moveTo(x, y);
      for (let j = 0; j < 8; j++) { x += (r() - 0.5) * 40; y += (r() - 0.5) * 40; c.lineTo(x, y); }
      c.stroke();
    }
    grain(c, s, r, 14);
  }, { repeat }),
  forest: (repeat) => canvasTexture(512, 9, (c, r, wrap, s) => {
    c.fillStyle = '#4a4630'; c.fillRect(0, 0, s, s);
    blobs(c, r, wrap, s, 180, ['#3c3a26', '#57532f', '#433a28', '#5d5a3a'], 15, 60, 0.5);
    specks(c, r, wrap, s, 1600, ['#6b4a2a', '#7d5a30', '#8a6a35', '#5a4024', '#4d5a2c', '#a0773a'], 1.5, 4.5); // leaves & needles
    c.strokeStyle = 'rgba(40,30,20,0.6)'; c.lineWidth = 1.2;
    for (let k = 0; k < 120; k++) { const x = r() * s, y = r() * s, a = r() * 6, l = 4 + r() * 14; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke(); }
    grain(c, s, r, 20);
  }, { repeat }),
  bark: () => canvasTexture(256, 11, (c, r, wrap, s) => {
    c.fillStyle = '#5a4130'; c.fillRect(0, 0, s, s);
    for (let k = 0; k < 140; k++) {
      const x = r() * s; c.strokeStyle = r() < 0.5 ? 'rgba(35,24,16,0.7)' : 'rgba(120,95,70,0.4)';
      c.lineWidth = 1 + r() * 3; c.beginPath(); c.moveTo(x, 0);
      let xx = x; for (let y = 0; y <= s; y += 16) { xx += (r() - 0.5) * 6; c.lineTo(xx, y); } c.stroke();
    }
    grain(c, s, r, 18);
  }, { repeat: 1 }),
  endgrain: () => canvasTexture(128, 13, (c, r, wrap, s) => {
    c.fillStyle = '#c9a476'; c.fillRect(0, 0, s, s);
    for (let k = 14; k > 0; k--) { c.strokeStyle = k % 2 ? 'rgba(140,100,60,0.55)' : 'rgba(170,128,85,0.4)'; c.lineWidth = 2.5; c.beginPath(); c.arc(s / 2 + (r() - 0.5) * 3, s / 2 + (r() - 0.5) * 3, k * 4.4, 0, Math.PI * 2); c.stroke(); }
    c.strokeStyle = '#4a3424'; c.lineWidth = 6; c.beginPath(); c.arc(s / 2, s / 2, s / 2 - 3, 0, Math.PI * 2); c.stroke();
  }),
  // vertical alpha gradient for light shafts
  shaft: () => canvasTexture(64, 1, (c, r, wrap, s) => {
    const g = c.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.6, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    const h = c.createLinearGradient(0, 0, s, 0);
    c.fillStyle = g; c.fillRect(0, 0, s, s);
    c.globalCompositeOperation = 'destination-in';
    h.addColorStop(0, 'rgba(0,0,0,0)'); h.addColorStop(0.3, 'rgba(0,0,0,1)'); h.addColorStop(0.7, 'rgba(0,0,0,1)'); h.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = h; c.fillRect(0, 0, s, s);
  }, { srgb: false }),
  radial: (inner = 'rgba(255,255,255,1)') => canvasTexture(128, 1, (c, r, wrap, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, inner); g.addColorStop(0.35, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, s, s);
  }, { srgb: false }),
};

// ---------- wind ----------
export const windTime = { value: 0 };
// Sways vertices by height above the instance origin. amp ~ metres of sway at 1 m height.
export function windy(material, amp = 0.06) {
  material.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = windTime;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', /* glsl */`
      #include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 ip = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
      #else
        vec3 ip = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      #endif
      float hh = max(0.0, position.y);
      float gust = sin(uTime * 0.6 + ip.x * 0.05) * 0.5 + 0.5;
      float sway = sin(uTime * 1.9 + ip.x * 0.37 + ip.z * 0.23) * (0.5 + gust) + sin(uTime * 3.7 + ip.z * 0.8) * 0.2;
      transformed.x += sway * ${amp.toFixed(3)} * hh * hh;
      transformed.z += sway * ${(amp * 0.5).toFixed(3)} * hh * hh;
    `);
  };
  material.customProgramCacheKey = () => `wind${amp}`;
  return material;
}
