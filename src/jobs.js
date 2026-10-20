// The jobs. No upgrades, ever. Every number here is a physical assumption
// about one ordinary person, and the simulator turns them into a workday.
import { mulberry32, gauss } from './rng.js';
import { CALIBRATION } from './calibration.js';

export const WORKDAY = 8 * 3600; // seconds of actual work, breaks not included
export const DAY_START = 9 * 3600; // clock time when the day begins

/*
 * params (shared by the game and the simulator):
 *   speedEmpty / speedLoaded  walking speed in m/s (normal human walk ~1.3-1.4)
 *   cap            how many items you can carry at once
 *   pickTime       seconds you must hold the action key to pick up one item
 *   pickOverhead   seconds a human loses per item lining up, bending, finding it
 *   dropFixed      seconds at the depot per visit (opening, setting down)
 *   dropPerItem    extra seconds per carried item when unloading
 *   walkFactor     humans don't walk perfect straight lines: path length multiplier
 *   reach          how close (m) you must stand to an item to pick it
 */
export const JOBS = [
  {
    id: 'weeds',
    title: 'The Field',
    task: 'Pull every weed.',
    blurb:
      'A field gone wild. Pull each weed by hand, fill your bag, carry it to the compost. ' +
      'The compost does not move closer. The weeds near it are gone first.',
    item: ['weed', 'weeds'],
    depot: 'compost heap',
    verbPick: 'pull',
    verbDrop: 'empty the bag',
    carrier: 'Bag',
    seed: 1907,
    params: {
      speedEmpty: 1.35, speedLoaded: 1.35, cap: 25,
      pickTime: 1.6, pickOverhead: 0.7,
      dropFixed: 3.0, dropPerItem: 0.2,
      walkFactor: 1.1, reach: 1.0,
    },
    generate(n, rng) {
      const W = 60, H = 44;
      const patches = Array.from({ length: 38 }, () => ({
        x: (rng() - 0.5) * W, z: (rng() - 0.5) * H, s: 1.5 + rng() * 3,
      }));
      const items = [];
      for (let i = 0; i < n; i++) {
        let x, z;
        if (rng() < 0.35) {
          x = (rng() - 0.5) * W; z = (rng() - 0.5) * H;
        } else {
          const p = patches[Math.floor(rng() * patches.length)];
          x = p.x + gauss(rng) * p.s; z = p.z + gauss(rng) * p.s;
        }
        x = Math.max(-W / 2, Math.min(W / 2, x));
        z = Math.max(-H / 2, Math.min(H / 2, z));
        items.push({ x, z, type: 0, rot: rng() * Math.PI * 2, size: 0.7 + rng() * 0.6 });
      }
      return {
        items,
        depots: [{ x: -W / 2 - 4, z: 0, r: 1.6, accepts: null }],
        start: { x: -W / 2 - 1.5, z: 2.5 },
        size: { w: W, h: H },
      };
    },
  },
  {
    id: 'sorting',
    title: 'The Floor',
    task: 'Sort everything on the floor, one by one.',
    blurb:
      'Somebody dropped everything. Pick up one thing, carry it to the bin of its colour, ' +
      'come back. One hand, one thing. The floor is large.',
    item: ['thing', 'things'],
    depot: 'bin',
    verbPick: 'pick up',
    verbDrop: 'drop it in',
    carrier: 'Hands',
    seed: 77,
    params: {
      speedEmpty: 1.4, speedLoaded: 1.4, cap: 1,
      pickTime: 0.8, pickOverhead: 0.6,
      dropFixed: 0.8, dropPerItem: 0,
      walkFactor: 1.1, reach: 1.0,
    },
    generate(n, rng) {
      const S = 38;
      const items = [];
      for (let i = 0; i < n; i++) {
        items.push({
          x: (rng() - 0.5) * S, z: (rng() - 0.5) * S,
          type: Math.floor(rng() * 4), rot: rng() * Math.PI * 2, size: 0.85 + rng() * 0.3,
        });
      }
      const d = S / 2 + 2;
      return {
        items,
        depots: [
          { x: 0, z: -d, r: 1.2, accepts: 0 },
          { x: d, z: 0, r: 1.2, accepts: 1 },
          { x: 0, z: d, r: 1.2, accepts: 2 },
          { x: -d, z: 0, r: 1.2, accepts: 3 },
        ],
        start: { x: 0, z: d - 3 },
        size: { w: S, h: S },
      };
    },
  },
  {
    id: 'core',
    title: 'The Core',
    task: 'Throw every log into the core.',
    blurb:
      'The core must be fed. The wood lies all around it, as far as you can see. ' +
      'Two logs at a time, and they are heavy. Every trip is a little longer than the last.',
    item: ['log', 'logs'],
    depot: 'core',
    verbPick: 'lift',
    verbDrop: 'throw them in',
    carrier: 'Arms',
    seed: 4242,
    params: {
      speedEmpty: 1.4, speedLoaded: 1.05, cap: 2,
      pickTime: 1.4, pickOverhead: 0.7,
      dropFixed: 0.5, dropPerItem: 1.0,
      walkFactor: 1.1, reach: 1.2,
    },
    generate(n, rng) {
      const R0 = 7, R1 = 48;
      const items = [];
      for (let i = 0; i < n; i++) {
        const r = Math.sqrt(R0 * R0 + rng() * (R1 * R1 - R0 * R0));
        const a = rng() * Math.PI * 2;
        items.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, type: 0, rot: rng() * Math.PI, size: 0.8 + rng() * 0.4 });
      }
      return {
        items,
        depots: [{ x: 0, z: 0, r: 2.2, accepts: null }],
        start: { x: 0, z: 5 },
        size: { w: R1 * 2, h: R1 * 2, radius: R1 },
      };
    },
  },
];

export function itemCount(job) {
  return CALIBRATION[job.id]?.count ?? 1000;
}

export function buildLayout(job, n = itemCount(job)) {
  const layout = job.generate(n, mulberry32(job.seed));
  // Which depot each item belongs to: the nearest one that accepts its type.
  layout.depotOf = layout.items.map((it) => {
    let best = -1, bd = Infinity;
    layout.depots.forEach((d, k) => {
      if (d.accepts !== null && d.accepts !== it.type) return;
      const dd = Math.hypot(d.x - it.x, d.z - it.z);
      if (dd < bd) { bd = dd; best = k; }
    });
    return best;
  });
  return layout;
}
