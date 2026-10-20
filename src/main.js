import * as THREE from 'three';
import { JOBS, WORKDAY, DAY_START, buildLayout } from './jobs.js';
import { CALIBRATION } from './calibration.js';
import { simulate, eventAt, fmtDuration, Grid, depotApproach } from './sim.js';
import { buildWorld, makeWorker, SORT_NAMES } from './world.js';

// The working life. Change these to change the arithmetic of the end screen.
const MIN_WAGE = 13.9; // € per hour, German statutory minimum wage 2026
const START_AGE = 20; // average age of starting work
const RETIRE_AGE = 67; // statutory retirement age
const WORKDAYS_PER_YEAR = 220; // weekdays minus holidays and leave
const WORKING_LIFE_DAYS = (RETIRE_AGE - START_AGE) * WORKDAYS_PER_YEAR;

const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat('en-US');
const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

// ---------- three.js setup ----------
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 160 });
sun.shadow.bias = -0.0005;
scene.add(hemi, sun, sun.target);
scene.fog = new THREE.Fog(0xffffff, 60, 180);

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ---------- per-job data ----------
const cache = {};
function jobData(job) {
  if (!cache[job.id]) {
    const layout = buildLayout(job);
    cache[job.id] = { layout, sim: simulate(job, layout) };
  }
  return cache[job.id];
}

let jobIndex = Math.max(0, JOBS.findIndex((j) => j.id === store.get('adayswork:last')));
let job, layout, sim, world, worker, ghost;
let mode = 'menu';

function loadJob(i) {
  jobIndex = (i + JOBS.length) % JOBS.length;
  job = JOBS[jobIndex];
  ({ layout, sim } = jobData(job));
  world?.dispose();
  worker?.group.removeFromParent();
  ghost?.group.removeFromParent();
  world = buildWorld(job, layout);
  scene.add(world.group);
  worker = makeWorker(job);
  ghost = makeWorker(job, { ghost: true });
  scene.background = new THREE.Color(world.env.sky);
  scene.fog.color.set(world.env.fog);
  hemi.groundColor.set(world.env.hemiGround);
  store.set('adayswork:last', job.id);
}

// ---------- lighting by clock ----------
const daySky = new THREE.Color(), duskSky = new THREE.Color(0xe7a774), tmpC = new THREE.Color();
function setDaylight(clockSec, focus) {
  const h = clockSec / 3600;
  const f = Math.min(1, Math.max(0, (h - 6) / 15)); // 06:00 sunrise .. 21:00 sunset
  const elev = Math.sin(Math.PI * f);
  const az = Math.PI * (0.15 + 0.7 * f);
  sun.position.set(focus.x + Math.cos(az) * 60, 6 + elev * 70, focus.z + Math.sin(az) * 30 - 20);
  sun.target.position.copy(focus);
  const dusk = Math.max(0, (h - 16) / 4.5); // warm after 16:00
  sun.color.setRGB(1, 1 - 0.35 * Math.min(1, dusk), 1 - 0.6 * Math.min(1, dusk));
  sun.intensity = 0.6 + 1.8 * Math.max(0.15, elev) * (1 - 0.5 * Math.min(1, dusk));
  daySky.set(world.env.sky);
  tmpC.copy(daySky).lerp(duskSky, Math.min(0.8, dusk * 0.8));
  if (h > 20) tmpC.lerp(new THREE.Color(0x1d2433), Math.min(1, (h - 20) / 1.5));
  scene.background.copy(tmpC);
  scene.fog.color.copy(tmpC);
  hemi.intensity = 0.5 + 0.8 * Math.max(0.2, elev);
}

// ---------- camera ----------
let zoom = 1;
const camTarget = new THREE.Vector3();
addEventListener('wheel', (e) => {
  if (mode === 'menu') return;
  zoom = Math.min(4, Math.max(0.5, zoom * (e.deltaY > 0 ? 1.1 : 0.9)));
}, { passive: true });
function followCamera(p, dt, dist = 1) {
  camTarget.lerp(new THREE.Vector3(p.x, 0, p.z), Math.min(1, dt * 5));
  const d = 9.5 * zoom * dist;
  camera.position.set(camTarget.x, camTarget.y + d * 1.05, camTarget.z + d);
  camera.lookAt(camTarget.x, 0.6, camTarget.z);
}

// ---------- input ----------
const keys = new Set();
let actionHeld = false, moveTarget = null;
const isAction = (k) => k === ' ' || k === 'e' || k === 'Enter';
addEventListener('keydown', (e) => {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (e.repeat && !['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) { if (mode === 'work' && isAction(k)) e.preventDefault(); return; }
  if (mode === 'menu') {
    if (k === 'ArrowLeft') selectJob(jobIndex - 1);
    else if (k === 'ArrowRight') selectJob(jobIndex + 1);
    else if (k === 'Enter') startWork();
    else if (k === 's') startWatch();
    return;
  }
  if (mode === 'work') {
    if (k === 'Escape') return toMenu();
    if (k === 'b') return toggleBreak();
    if (onBreak) return;
    if (isAction(k)) { actionHeld = true; e.preventDefault(); }
    keys.add(k); moveTarget = null;
    if (k.startsWith('Arrow')) e.preventDefault();
    return;
  }
  if (mode === 'watch') {
    if (k === 'Escape') return toMenu();
    if (k === ' ') { e.preventDefault(); return toggleWatchPause(); }
    if (k === 'r') return restartWatch();
    if (k === 'ArrowUp' || k === 'ArrowRight') return setSpeed(speedIdx + 1);
    if (k === 'ArrowDown' || k === 'ArrowLeft') return setSpeed(speedIdx - 1);
  }
  if (mode === 'end' && (k === 'Enter' || k === 'Escape')) toMenu();
});
addEventListener('keyup', (e) => {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  keys.delete(k);
  if (isAction(k)) actionHeld = false;
});
addEventListener('blur', () => { keys.clear(); actionHeld = false; });

const ray = new THREE.Raycaster(), groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
canvas.addEventListener('pointerdown', (e) => {
  if (mode !== 'work' || onBreak) return;
  const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = new THREE.Vector3();
  if (ray.ray.intersectPlane(groundPlane, hit)) moveTarget = { x: hit.x, z: hit.z };
});
const workBtn = $('btn-work');
workBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); actionHeld = true; workBtn.classList.add('held'); });
for (const ev of ['pointerup', 'pointercancel', 'pointerleave'])
  workBtn.addEventListener(ev, () => { actionHeld = false; workBtn.classList.remove('held'); });

// ---------- screens ----------
function show(id) {
  for (const s of ['menu', 'hud', 'watch', 'break', 'end']) $(s).hidden = s !== id && !(id === 'break' && s === 'hud');
}

function saveKey() { return `adayswork:${job.id}`; }

function selectJob(i) {
  if (mode === 'work') saveGame();
  loadJob(i);
  renderMenu();
}

function renderMenu() {
  const cal = CALIBRATION[job.id] ?? {};
  $('job-title').textContent = job.title;
  $('job-task').textContent = job.task;
  $('job-blurb').textContent = job.blurb;
  const save = store.get(saveKey());
  const P = job.params;
  const facts = [
    [job.item[1][0].toUpperCase() + job.item[1].slice(1), nf.format(layout.items.length)],
    ['You can carry', `${P.cap} ${P.cap === 1 ? job.item[0] : job.item[1]}`],
    ['Trips to the ' + job.depot, nf.format(sim.trips.length)],
    ['On foot', `${(sim.walked / 1000).toFixed(1)} km`],
    ['Simulated, normal pace', fmtDuration(sim.total)],
  ];
  if (save && !save.done) facts.push(['Your progress', `${nf.format(countBits(save.picked))} done · ${fmtDuration(save.work)} worked`]);
  if (save?.done) facts.push(['You', `finished in ${fmtDuration(save.work)}`]);
  $('job-facts').innerHTML = facts.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
  $('btn-start').textContent = save && !save.done ? 'Continue the day' : 'Start the day';
  $('btn-reset').hidden = !save;
  $('dots').innerHTML = JOBS.map((j, k) => (k === jobIndex ? '<b>●</b>' : '○')).join(' ');
  // reset items to the saved state for the menu backdrop
  const picked = save && !save.done ? unpackBits(save.picked, layout.items.length) : null;
  for (let i = 0; i < layout.items.length; i++) world.setPicked(i, picked ? !!picked[i] : false);
}

$('prev').onclick = () => selectJob(jobIndex - 1);
$('next').onclick = () => selectJob(jobIndex + 1);
$('btn-start').onclick = () => startWork();
$('btn-watch').onclick = () => startWatch();
$('btn-reset').onclick = () => {
  if (!confirm(`Start ${job.title} over? Your progress on this day will be lost.`)) return;
  store.del(saveKey()); renderMenu();
};
$('btn-break').onclick = () => toggleBreak();
$('btn-back').onclick = () => toggleBreak();
$('btn-menu').onclick = () => toMenu();
$('btn-end-menu').onclick = () => toMenu();
$('w-menu').onclick = () => toMenu();
$('w-pause').onclick = () => toggleWatchPause();
$('w-restart').onclick = () => restartWatch();

function toMenu() {
  if (mode === 'work') saveGame();
  onBreak = false;
  mode = 'menu';
  worker.group.removeFromParent(); ghost.group.removeFromParent(); trail?.removeFromParent();
  show('menu');
  renderMenu();
}

// ---------- work state ----------
let g = null; // the game in progress
let onBreak = false;

function countBits(b64) {
  if (!b64) return 0;
  const s = atob(b64); let c = 0;
  for (let k = 0; k < s.length; k++) { let v = s.charCodeAt(k); while (v) { c += v & 1; v >>= 1; } }
  return c;
}
function packBits(arr) {
  const bytes = new Uint8Array(Math.ceil(arr.length / 8));
  for (let i = 0; i < arr.length; i++) if (arr[i]) bytes[i >> 3] |= 1 << (i & 7);
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function unpackBits(b64, n) {
  const out = new Uint8Array(n);
  if (!b64) return out;
  const s = atob(b64);
  for (let i = 0; i < n; i++) out[i] = (s.charCodeAt(i >> 3) >> (i & 7)) & 1;
  return out;
}

function startWork() {
  const save = store.get(saveKey());
  const n = layout.items.length;
  const fresh = !save || save.done;
  g = {
    picked: fresh ? new Uint8Array(n) : unpackBits(save.picked, n),
    load: fresh ? [] : save.load,
    x: fresh ? layout.start.x : save.x,
    z: fresh ? layout.start.z : save.z,
    work: fresh ? 0 : save.work,
    brk: fresh ? 0 : save.brk,
    progress: 0, target: null, lastSave: 0, facing: 0,
  };
  g.pickedCount = g.picked.reduce((s, v) => s + v, 0);
  g.grid = new Grid(layout.items, g.picked.map((v) => 1 - v), 3);
  for (let i = 0; i < n; i++) world.setPicked(i, !!g.picked[i]);
  scene.add(worker.group);
  worker.group.position.set(g.x, 0, g.z);
  camTarget.set(g.x, 0, g.z);
  mode = 'work';
  show('hud');
  saveGame();
}

function saveGame(done = false) {
  if (!g) return;
  store.set(saveKey(), { v: 1, picked: packBits(g.picked), load: g.load, x: g.x, z: g.z, work: g.work, brk: g.brk, done });
}

function toggleBreak() {
  if (mode !== 'work') return;
  onBreak = !onBreak;
  actionHeld = false; keys.clear(); moveTarget = null;
  $('break').hidden = !onBreak;
  if (onBreak) g.breakStart = g.brk;
  saveGame();
}

function findTarget() {
  const P = job.params;
  // depot first if carrying something
  if (g.load.length) {
    for (let k = 0; k < layout.depots.length; k++) {
      const d = layout.depots[k];
      if (Math.hypot(d.x - g.x, d.z - g.z) <= depotApproach(d) + 0.6) {
        const want = layout.depotOf[g.load[0]];
        if (want === k) return { kind: 'depot', k };
        return { kind: 'wrong', k };
      }
    }
  }
  if (g.load.length < P.cap) {
    const i = g.grid.nearest(g.x, g.z, null, P.reach);
    if (i >= 0) return { kind: 'item', i };
  }
  return null;
}

function workTick(dt) {
  const P = job.params;
  if (onBreak) {
    g.brk += dt;
    $('b-time').textContent = fmtDuration(g.brk - g.breakStart);
    updateHud(null);
    worker.animate(dt, false, false);
    return;
  }
  g.work += dt;

  const target = findTarget();
  const sameTarget = target && g.target && target.kind === g.target.kind && target.i === g.target.i && target.k === g.target.k;
  if (!sameTarget) g.progress = 0;
  g.target = target;

  let working = false, moving = false;
  if (actionHeld && target && target.kind !== 'wrong') {
    working = true;
    g.progress += dt;
    const need = target.kind === 'item' ? P.pickTime : P.dropFixed + P.dropPerItem * g.load.length;
    if (target.kind === 'item') {
      const it = layout.items[target.i];
      g.facing = Math.atan2(it.x - g.x, it.z - g.z);
    }
    if (g.progress >= need) {
      g.progress = 0;
      if (target.kind === 'item') {
        g.grid.remove(target.i);
        g.picked[target.i] = 1;
        g.pickedCount++;
        g.load.push(target.i);
        world.setPicked(target.i, true);
      } else {
        g.load = [];
        pulseDepot(target.k);
        if (g.grid.count === 0) return finishDay();
      }
      g.target = null;
    }
  } else {
    // movement
    let mx = 0, mz = 0;
    if (keys.has('w') || keys.has('ArrowUp')) mz -= 1;
    if (keys.has('s') || keys.has('ArrowDown')) mz += 1;
    if (keys.has('a') || keys.has('ArrowLeft')) mx -= 1;
    if (keys.has('d') || keys.has('ArrowRight')) mx += 1;
    if (!mx && !mz && moveTarget) {
      const dx = moveTarget.x - g.x, dz = moveTarget.z - g.z, d = Math.hypot(dx, dz);
      if (d < 0.15) moveTarget = null; else { mx = dx / d; mz = dz / d; }
    }
    const len = Math.hypot(mx, mz);
    if (len > 0) {
      const speed = g.load.length ? P.speedLoaded : P.speedEmpty;
      let step = speed * dt;
      if (moveTarget && !keys.size) step = Math.min(step, Math.hypot(moveTarget.x - g.x, moveTarget.z - g.z));
      g.x += (mx / len) * step; g.z += (mz / len) * step;
      g.facing = Math.atan2(mx, mz);
      moving = true;
      const lim = (layout.size.w / 2) + 12;
      g.x = Math.max(-lim, Math.min(lim, g.x)); g.z = Math.max(-lim, Math.min(lim, g.z));
    }
  }

  worker.group.position.set(g.x, 0, g.z);
  worker.group.rotation.y = lerpAngle(worker.group.rotation.y, g.facing, Math.min(1, dt * 12));
  const lastType = g.load.length ? layout.items[g.load[g.load.length - 1]].type : 0;
  worker.setCarry(g.load.length, lastType);
  worker.animate(dt, moving, working, (g.load.length ? P.speedLoaded : P.speedEmpty) / 1.4);

  updateHud(target, working);
  if (g.work - g.lastSave > 5) { g.lastSave = g.work; saveGame(); }
}

function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

let pulse = null;
function pulseDepot(k) { pulse = { k, t: 0 }; }

function clockStr(sec) {
  const s = Math.floor(sec) % 86400;
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
}

function updateHud(target, working) {
  const P = job.params, n = layout.items.length;
  const clock = DAY_START + g.work + g.brk;
  $('h-clock').textContent = clockStr(clock);
  $('h-worked').textContent = `Worked ${fmtDuration(g.work)} of ${fmtDuration(WORKDAY)}`;
  // pace against the simulated ordinary worker
  const done = g.pickedCount;
  if (done > 0) {
    const simAt = sim.pickTimes[Math.min(done, sim.pickTimes.length) - 1];
    const diff = simAt - g.work;
    const rem = Math.max(0, sim.total - simAt);
    $('h-pace').textContent =
      `${Math.abs(diff) < 60 ? 'On pace' : `${fmtDuration(Math.abs(diff), false).replace(/^0h /, '')} ${diff > 0 ? 'ahead of' : 'behind'}`} the simulated worker · done around ${clockStr(clock + rem)}`;
  } else $('h-pace').textContent = 'Nothing done yet.';
  const left = n - done;
  $('h-left').textContent = `${nf.format(left)} ${left === 1 ? job.item[0] : job.item[1]} left`;
  let carry = `${job.carrier}: ${g.load.length} / ${P.cap}`;
  if (job.id === 'sorting' && g.load.length) carry = `Holding: a ${SORT_NAMES[layout.items[g.load[0]].type]} ${job.item[0]}`;
  $('h-carry').textContent = carry;

  let hint = '', frac = 0;
  if (onBreak) hint = '';
  else if (target?.kind === 'item') {
    hint = `Hold Space to ${job.verbPick} the ${job.item[0]}`;
    frac = g.progress / P.pickTime;
  } else if (target?.kind === 'depot') {
    hint = `Hold Space to ${job.verbDrop}`;
    frac = g.progress / (P.dropFixed + P.dropPerItem * g.load.length);
  } else if (target?.kind === 'wrong') {
    hint = `This bin is for ${SORT_NAMES[layout.depots[target.k].accepts]} things.`;
  } else if (g.load.length >= P.cap) {
    hint = P.cap === 1 ? `Bring it to the ${SORT_NAMES[layout.items[g.load[0]].type] ?? ''} ${job.depot}.`.replace('  ', ' ')
      : `Full. Walk to the ${job.depot}.`;
  } else if (g.work < 20) {
    hint = 'WASD / arrows or click to walk';
  }
  $('h-hint').textContent = hint;
  $('h-bar').style.width = `${Math.min(1, frac) * 100}%`;
}

function finishDay() {
  saveGame(true);
  const career = store.get('adayswork:career') ?? { days: 0 };
  career.days += 1;
  store.set('adayswork:career', career);
  mode = 'end';
  show('end');
  const hours = g.work / 3600;
  $('e-kicker').textContent = `${job.title} · day ${nf.format(career.days)}`;
  $('e-title').textContent = { weeds: 'The field is clear.', sorting: 'The floor is empty.', core: 'The core is fed.' }[job.id];
  $('e-facts').innerHTML = [
    [job.item[1][0].toUpperCase() + job.item[1].slice(1), nf.format(layout.items.length)],
    ['Worked', fmtDuration(g.work)],
    ['Breaks', fmtDuration(g.brk)],
    ['Clocked out', clockStr(DAY_START + g.work + g.brk)],
    ['The simulated worker', fmtDuration(sim.total)],
  ].map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
  $('e-pay').innerHTML = `${eur.format(hours * MIN_WAGE)}<small>${hours.toFixed(2)} h × ${eur.format(MIN_WAGE)} minimum wage, gross. Breaks are unpaid.</small>`;
  const left = Math.max(0, WORKING_LIFE_DAYS - career.days);
  const which = career.days === 1 ? 'your first day' : `day ${nf.format(career.days)}`;
  $('e-days').textContent = `That was ${which}. Only ${nf.format(left)} left.`;
  $('e-foot').textContent = `Working from ${START_AGE} to ${RETIRE_AGE}, ${WORKDAYS_PER_YEAR} days a year: ${nf.format(WORKING_LIFE_DAYS)} days.`;
  worker.setCarry(0);
}

// ---------- watch the simulation ----------
const SPEEDS = [1, 10, 60, 300, 1200, 3600];
let speedIdx = 2, watchPaused = false, simT = 0, evIdx = 0, trail = null, trailN = 0;
let trailPos = null;

function startWatch() {
  mode = 'watch';
  show('watch');
  $('w-title').textContent = job.title;
  $('w-depot').textContent = job.depot;
  scene.add(ghost.group);
  if (trail) { trail.geometry.dispose(); trail.removeFromParent(); }
  trailPos = new Float32Array((sim.events.length + 2) * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
  trail = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
  trail.frustumCulled = false;
  scene.add(trail);
  zoom = 1.6;
  renderSpeeds();
  restartWatch();
}

function restartWatch() {
  simT = 0; evIdx = 0; trailN = 0; watchPaused = false;
  $('w-pause').textContent = 'Pause (Space)';
  for (let i = 0; i < layout.items.length; i++) world.setPicked(i, false);
  pushTrail(layout.start.x, layout.start.z);
  camTarget.set(layout.start.x, 0, layout.start.z);
}

function pushTrail(x, z) {
  trailPos[trailN * 3] = x; trailPos[trailN * 3 + 1] = 0.05; trailPos[trailN * 3 + 2] = z;
  trailN++;
  const K = job.id === 'weeds' ? 900 : 120; // how much of the recent path to show
  trail.geometry.setDrawRange(Math.max(0, trailN - K), Math.min(trailN, K));
  trail.geometry.attributes.position.needsUpdate = true;
}

function renderSpeeds() {
  $('w-speeds').innerHTML = SPEEDS.map((s, k) =>
    `<button data-k="${k}" class="${k === speedIdx ? 'on' : ''}">${s === 1 ? 'real time' : s + '×'}</button>`).join('');
  for (const b of $('w-speeds').querySelectorAll('button')) b.onclick = () => setSpeed(+b.dataset.k);
}
function setSpeed(k) { speedIdx = Math.max(0, Math.min(SPEEDS.length - 1, k)); renderSpeeds(); }
function toggleWatchPause() {
  watchPaused = !watchPaused;
  $('w-pause').textContent = watchPaused ? 'Play (Space)' : 'Pause (Space)';
}

function watchTick(dt) {
  if (!watchPaused) simT = Math.min(sim.total, simT + dt * SPEEDS[speedIdx]);
  const ev = sim.events;
  while (evIdx < ev.length && ev[evIdx].t1 <= simT) {
    const e = ev[evIdx];
    if (e.k === 1) world.setPicked(e.i, true);
    if (e.k === 0) pushTrail(e.x1, e.z1);
    evIdx++;
  }
  const e = ev[Math.min(ev.length - 1, eventAt(ev, simT))];
  const f = Math.min(1, Math.max(0, (simT - e.t0) / Math.max(1e-6, e.t1 - e.t0)));
  const x = e.x0 + (e.x1 - e.x0) * f, z = e.z0 + (e.z1 - e.z0) * f;
  ghost.group.position.set(x, 0, z);
  if (e.k === 0) ghost.group.rotation.y = Math.atan2(e.x1 - e.x0, e.z1 - e.z0);
  else if (e.k === 1) { const it = layout.items[e.i]; ghost.group.rotation.y = Math.atan2(it.x - x, it.z - z) || ghost.group.rotation.y; }
  let carryN = e.k === 1 && simT >= e.t1 ? e.n + 1 : e.n;
  if (e.k === 2 && simT >= e.t1) carryN = 0;
  const carryType = job.id === 'sorting' ? lastCarriedType(evIdx) : 0;
  ghost.setCarry(carryN, carryType);
  const realDt = watchPaused ? 0 : dt * Math.min(SPEEDS[speedIdx], 30);
  ghost.animate(realDt, e.k === 0 && !watchPaused, e.k !== 0 && !watchPaused, 1);

  const tripsDone = sim.trips.filter((t) => t.t1 <= simT).length;
  const picked = lowerBound(sim.pickTimes, simT);
  $('w-clock').textContent = clockStr(DAY_START + simT);
  $('w-stats').innerHTML =
    `${fmtDuration(simT)} worked · ${nf.format(layout.items.length - picked)} ${job.item[1]} left<br>` +
    `${nf.format(tripsDone)} of ${nf.format(sim.trips.length)} trips · ${(walkedAt(simT) / 1000).toFixed(2)} km walked`;
  drawChart(simT);
  return { x, z };
}

function lastCarriedType(idx) {
  for (let k = idx - 1; k >= 0; k--) {
    const e = sim.events[k];
    if (e.k === 1) return layout.items[e.i].type;
  }
  return 0;
}
function lowerBound(arr, v) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= v) lo = m + 1; else hi = m; }
  return lo;
}
let walkedCache = null;
function walkedAt(T) {
  if (!walkedCache || walkedCache.sim !== sim) {
    let acc = 0;
    walkedCache = { sim, t: [], d: [] };
    for (const e of sim.events) if (e.k === 0) { acc += Math.hypot(e.x1 - e.x0, e.z1 - e.z0) * job.params.walkFactor; walkedCache.t.push(e.t1); walkedCache.d.push(acc); }
  }
  const k = lowerBound(walkedCache.t, T);
  return k ? walkedCache.d[k - 1] : 0;
}

// Trip-duration chart: one thin bar per trip, x = when it started, y = how long it took.
const chart = $('w-chart'), tip = $('w-tip');
let chartHover = -1;
chart.addEventListener('pointermove', (e) => {
  const r = chart.getBoundingClientRect();
  const fx = (e.clientX - r.left) / r.width;
  const T = fx * sim.total;
  let best = -1, bd = Infinity;
  sim.trips.forEach((t, k) => { const d = Math.abs(t.t0 - T); if (d < bd) { bd = d; best = k; } });
  chartHover = best;
  const t = sim.trips[best];
  if (!t) return;
  tip.hidden = false;
  tip.style.left = `${Math.min(r.width - 80, Math.max(80, e.clientX - r.left + 14))}px`;
  tip.textContent = `Trip ${nf.format(best + 1)} · ${clockStr(DAY_START + t.t0)} · ${Math.round(t.t1 - t.t0)} s · ${Math.round(t.dist)} m · ${t.count} ${t.count === 1 ? job.item[0] : job.item[1]}`;
});
chart.addEventListener('pointerleave', () => { chartHover = -1; tip.hidden = true; });

function drawChart(T) {
  const dpr = Math.min(2, devicePixelRatio);
  const w = chart.clientWidth, h = chart.clientHeight;
  if (chart.width !== w * dpr) { chart.width = w * dpr; chart.height = h * dpr; }
  const c = chart.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  const padB = 16, padL = 34;
  const maxD = Math.max(...sim.trips.map((t) => t.t1 - t.t0));
  const yMax = Math.ceil(maxD / 30) * 30;
  const X = (t) => padL + (t / sim.total) * (w - padL - 4);
  const Y = (d) => (h - padB) - (d / yMax) * (h - padB - 6);
  // recessive grid
  c.strokeStyle = 'rgba(255,255,255,0.12)'; c.lineWidth = 1;
  c.fillStyle = 'rgba(244,241,234,0.6)'; c.font = '10px system-ui, sans-serif';
  c.textAlign = 'right'; c.textBaseline = 'middle';
  for (const d of [0, yMax / 2, yMax]) {
    c.beginPath(); c.moveTo(padL, Y(d) + 0.5); c.lineTo(w - 4, Y(d) + 0.5); c.stroke();
    c.fillText(d >= 60 ? `${Math.round(d / 60)}m` : `${d}s`, padL - 6, Y(d));
  }
  c.textAlign = 'center'; c.textBaseline = 'top';
  for (let hr = 0; hr <= 8; hr += 2) {
    c.textAlign = hr === 0 ? 'left' : hr === 8 ? 'right' : 'center';
    c.fillText(clockStr(DAY_START + hr * 3600), hr === 0 ? padL : hr === 8 ? w - 4 : X(hr * 3600), h - padB + 3);
  }
  // bars
  const bw = Math.max(1, Math.min(4, (w - padL) / sim.trips.length - 1));
  sim.trips.forEach((t, k) => {
    const done = t.t1 <= T;
    c.fillStyle = k === chartHover ? '#ffffff' : done ? '#e9c46a' : 'rgba(244,241,234,0.18)';
    const x = X(t.t0), y = Y(t.t1 - t.t0);
    c.fillRect(x, y, bw, Y(0) - y);
  });
  // now marker
  c.strokeStyle = 'rgba(255,255,255,0.8)';
  c.beginPath(); c.moveTo(X(T) + 0.5, 4); c.lineTo(X(T) + 0.5, Y(0)); c.stroke();
}

// ---------- main loop ----------
const clock = new THREE.Clock();
let menuAngle = 0;
function frame() {
  const dt = Math.min(0.1, clock.getDelta());
  let focus = new THREE.Vector3();
  if (mode === 'menu') {
    menuAngle += dt * 0.05;
    const R = Math.max(layout.size.w, layout.size.h) * 0.75;
    camera.position.set(Math.cos(menuAngle) * R, R * 0.55, Math.sin(menuAngle) * R);
    camera.lookAt(0, 0, 0);
    setDaylight(DAY_START + 1800, focus);
  } else if (mode === 'work' || mode === 'end') {
    if (mode === 'work') workTick(dt);
    focus.set(g.x, 0, g.z);
    followCamera(focus, dt);
    setDaylight(DAY_START + g.work + g.brk, focus);
  } else if (mode === 'watch') {
    const p = watchTick(dt);
    focus.set(p.x, 0, p.z);
    followCamera(focus, dt);
    setDaylight(DAY_START + simT, focus);
  }
  if (pulse) {
    pulse.t += dt;
    const m = world.env.depotMeshes[pulse.k];
    const s = 1 + Math.sin(Math.min(1, pulse.t / 0.5) * Math.PI) * 0.15;
    if (m) { m.userData.base ??= m.scale.clone(); m.scale.copy(m.userData.base).multiplyScalar(s); }
    if (pulse.t > 0.5) pulse = null;
  }
  if (world.env.coreLight) world.env.coreLight.intensity = 36 + Math.sin(performance.now() / 400) * 6;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

addEventListener('beforeunload', () => { if (mode === 'work') saveGame(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && mode === 'work') saveGame(); });

loadJob(jobIndex);
show('menu');
renderMenu();
frame();
