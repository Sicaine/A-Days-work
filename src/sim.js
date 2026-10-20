// The simulator: an ordinary person doing the job as well as they reasonably can.
//
// Strategy (greedy, which is what people actually do):
//   - while hands aren't full, walk to the nearest remaining item and pick it up.
//     For the last item before you're full, prefer the one that also lies
//     towards the depot (cost = to item + item to depot).
//   - when full (or nothing is left), walk to the depot and unload.
// The world changes as you work: what's near is cleared first, so trips grow.

// Uniform grid over the items for fast nearest-neighbour queries with removal.
export class Grid {
  constructor(items, alive, cell = 3) {
    this.items = items;
    this.cell = cell;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const it of items) {
      minX = Math.min(minX, it.x); maxX = Math.max(maxX, it.x);
      minZ = Math.min(minZ, it.z); maxZ = Math.max(maxZ, it.z);
    }
    if (!items.length) { minX = minZ = 0; maxX = maxZ = 1; }
    this.minX = minX; this.minZ = minZ;
    this.gw = Math.max(1, Math.ceil((maxX - minX) / cell) + 1);
    this.gh = Math.max(1, Math.ceil((maxZ - minZ) / cell) + 1);
    this.cells = Array.from({ length: this.gw * this.gh }, () => []);
    this.cellOf = new Int32Array(items.length);
    this.slot = new Int32Array(items.length);
    this.count = 0;
    items.forEach((it, i) => {
      const c = this.cellIndex(it.x, it.z);
      this.cellOf[i] = c;
      if (alive[i]) this.add(i);
      else this.slot[i] = -1;
    });
  }
  cx(x) { return Math.min(this.gw - 1, Math.max(0, Math.floor((x - this.minX) / this.cell))); }
  cz(z) { return Math.min(this.gh - 1, Math.max(0, Math.floor((z - this.minZ) / this.cell))); }
  cellIndex(x, z) { return this.cz(z) * this.gw + this.cx(x); }
  add(i) {
    const arr = this.cells[this.cellOf[i]];
    this.slot[i] = arr.length; arr.push(i); this.count++;
  }
  remove(i) {
    if (this.slot[i] < 0) return;
    const arr = this.cells[this.cellOf[i]];
    const s = this.slot[i], last = arr.pop();
    if (last !== i) { arr[s] = last; this.slot[last] = s; }
    this.slot[i] = -1; this.count--;
  }
  has(i) { return this.slot[i] >= 0; }
  // Nearest alive item by cost(i, dist) >= dist. maxDist limits the search radius.
  nearest(x, z, cost = null, maxDist = Infinity) {
    if (!this.count) return -1;
    const cx = this.cx(x), cz = this.cz(z), cell = this.cell;
    const maxR = Math.max(this.gw, this.gh);
    let best = Infinity, bi = -1;
    for (let r = 0; r <= maxR; r++) {
      const lower = (r - 1) * cell;
      if (lower > best || lower > maxDist) break;
      for (let gz = cz - r; gz <= cz + r; gz++) {
        if (gz < 0 || gz >= this.gh) continue;
        const edge = gz === cz - r || gz === cz + r;
        for (let gx = cx - r; gx <= cx + r; gx += edge ? 1 : 2 * r || 1) {
          if (gx < 0 || gx >= this.gw) continue;
          const arr = this.cells[gz * this.gw + gx];
          for (let k = 0; k < arr.length; k++) {
            const i = arr[k], it = this.items[i];
            const d = Math.hypot(it.x - x, it.z - z);
            if (d > maxDist) continue;
            const c = cost ? cost(i, d) : d;
            if (c < best) { best = c; bi = i; }
          }
        }
      }
    }
    return bi;
  }
}

export function depotApproach(depot) { return depot.r + 0.5; }

/*
 * state (optional) continues from a game in progress:
 *   { picked: Uint8Array, load: [itemIndex...], x, z }
 * Returns totals and (if record) the event timeline for playback.
 */
export function simulate(job, layout, state = null, { record = true } = {}) {
  const P = job.params;
  const { items, depots, depotOf } = layout;
  const n = items.length;
  const alive = new Uint8Array(n).fill(1);
  if (state?.picked) for (let i = 0; i < n; i++) if (state.picked[i]) alive[i] = 0;
  const grid = new Grid(items, alive, 3);

  let x = state?.x ?? layout.start.x, z = state?.z ?? layout.start.z;
  const load = state?.load ? [...state.load] : [];
  let t = 0, walked = 0;
  const events = record ? [] : null;
  const pickTimes = [];
  const trips = [];
  let tripT0 = 0, tripDist = 0;

  const depotDist = items.map((it, i) => {
    const d = depots[depotOf[i]];
    return Math.max(0, Math.hypot(d.x - it.x, d.z - it.z) - depotApproach(d));
  });

  function walkTo(tx, tz, stopShort) {
    const d = Math.hypot(tx - x, tz - z);
    const eff = Math.max(0, d - stopShort);
    if (eff > 0) {
      const nx = x + (tx - x) * (eff / d), nz = z + (tz - z) * (eff / d);
      const speed = load.length ? P.speedLoaded : P.speedEmpty;
      const dt = (eff * P.walkFactor) / speed;
      if (record) events.push({ k: 0, t0: t, t1: t + dt, x0: x, z0: z, x1: nx, z1: nz, n: load.length });
      t += dt; x = nx; z = nz;
      walked += eff * P.walkFactor; tripDist += eff * P.walkFactor;
    }
  }

  for (;;) {
    if (load.length < P.cap && grid.count > 0) {
      const last = load.length + 1 === P.cap;
      const i = grid.nearest(x, z, last ? (j, d) => d + depotDist[j] : null);
      const it = items[i];
      walkTo(it.x, it.z, P.reach * 0.5);
      const dt = P.pickTime + P.pickOverhead;
      if (record) events.push({ k: 1, t0: t, t1: t + dt, x0: x, z0: z, x1: x, z1: z, i, n: load.length });
      t += dt;
      grid.remove(i);
      load.push(i);
      pickTimes.push(t);
    } else if (load.length > 0) {
      const d = depots[depotOf[load[0]]];
      walkTo(d.x, d.z, depotApproach(d));
      const dt = P.dropFixed + P.dropPerItem * load.length;
      if (record) events.push({ k: 2, t0: t, t1: t + dt, x0: x, z0: z, x1: x, z1: z, n: load.length, d: depots.indexOf(d) });
      t += dt;
      trips.push({ t0: tripT0, t1: t, dist: tripDist, count: load.length });
      tripT0 = t; tripDist = 0;
      load.length = 0;
    } else break;
  }

  return { total: t, walked, events, pickTimes, trips, count: pickTimes.length };
}

// Position of the simulated worker at time T (binary search over events).
export function eventAt(events, T) {
  let lo = 0, hi = events.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (events[mid].t0 <= T) lo = mid; else hi = mid - 1;
  }
  return lo;
}

export function fmtDuration(s, withSeconds = true) {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(2, '0'), ss = String(sec).padStart(2, '0');
  return withSeconds ? `${h}:${mm}:${ss}` : `${h}h ${mm}m`;
}
