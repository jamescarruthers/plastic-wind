// Places tone holes along a bore so each fingering sounds its target note.
// Lengths in mm here; the network is built in metres.

import { airAt, firstResonance, resonanceNear, findPeaks, type Element, type Network } from './tmm';

export interface HeadSegment {
  L: number;
  r0: number;
  r1: number;
  label: string;
}

export interface BodyProfile {
  type: 'cylindrical' | 'conical';
  r0: number;
  r1: number;
  bellLength: number; // 0 = no bell
  bellRadius: number;
}

export interface SolveSpec {
  targets: number[]; // Hz, ascending; targets[0] is all holes closed
  tempC: number;
  head: HeadSegment[]; // reed end first; fixed lengths
  pipe: { mode: 'none' | 'fixed' | 'auto'; L: number; r: number; minL: number };
  body: BodyProfile;
  inputCorrection: number; // mm of equivalent closed length at the reed
  topMargin: number; // mm of body bore above the top hole (used in auto pipe mode)
  minBody: number; // shortest allowed body
  /** Hole diameter for hole index (0 = bottom-most) given bore radius at the hole. */
  holeDiameter: (index: number, boreRadius: number) => number;
  /** Smallest diameter the solver may shrink a crowded hole to. */
  holeMinDiameter: number;
  /** Chimney height (wall thickness at the hole) given bore radius. */
  chimney: (index: number, boreRadius: number) => number;
}

export interface SolvedHole {
  index: number; // 0 = bottom-most (first opened)
  s: number; // distance from body inlet (socket bottom)
  fromEnd: number; // distance from bell end
  diameter: number;
  chimney: number;
  boreRadius: number;
}

export interface NoteResult {
  target: number;
  predicted: number;
  cents: number;
  second: number | null; // next resonance of the same fingering (overblown)
}

export interface SolveResult {
  bodyLength: number;
  pipeLength: number;
  headLength: number;
  holes: SolvedHole[];
  notes: NoteResult[];
  warnings: string[];
  converged: boolean;
}

export function bodyRadius(p: BodyProfile, s: number, Lb: number): number {
  const bl = Math.min(p.bellLength, Lb * 0.6);
  const Lc = Lb - bl;
  let r: number;
  if (p.type === 'cylindrical') r = p.r0;
  else r = p.r0 + (p.r1 - p.r0) * Math.min(Math.max(s / Lc, 0), 1);
  if (bl > 0 && s > Lc) {
    const rc = p.type === 'cylindrical' ? p.r0 : p.r1;
    const u = (s - Lc) / bl;
    r = rc + (p.bellRadius - rc) * Math.pow(u, 2.2);
  }
  return r;
}

interface State {
  Lb: number;
  Lp: number;
  d: number[]; // hole distances from bell end, index 0 = bottom hole
  dia: number[];
  chim: number[];
}

const MM = 0.001;

function holeS(st: State, i: number) {
  return st.Lb - st.d[i];
}

/** Build the network for a fingering with `openCount` bottom holes open. */
export function buildNetwork(spec: SolveSpec, st: State, openCount: number): Network {
  const air = airAt(spec.tempC);
  const el: Element[] = [];
  const p = spec.body;
  const Lb = st.Lb;
  const maxSlice = p.type === 'cylindrical' ? 8 : 3;
  // Event positions along the body: holes and the bell join.
  const holes = st.d.map((d, i) => ({ s: Lb - d, i })).sort((a, b) => b.s - a.s);
  let s = Lb;
  const addBody = (from: number, to: number) => {
    // from > to, walking towards the reed
    const len = from - to;
    if (len <= 1e-6) return;
    const inBell = p.bellLength > 0 && from > Lb - p.bellLength;
    const n = Math.max(1, Math.ceil(len / (inBell ? 2 : maxSlice)));
    for (let k = 0; k < n; k++) {
      const a = from - (len * k) / n;
      const b = from - (len * (k + 1)) / n;
      el.push({ kind: 'seg', L: (a - b) * MM, a: bodyRadius(p, (a + b) / 2, Lb) * MM });
    }
  };
  for (const h of holes) {
    addBody(s, h.s);
    s = h.s;
    const a = bodyRadius(p, h.s, Lb);
    el.push({ kind: 'hole', a: a * MM, b: (st.dia[h.i] / 2) * MM, t: st.chim[h.i] * MM, open: h.i < openCount });
  }
  addBody(s, 0);
  if (st.Lp > 0) el.push({ kind: 'seg', L: st.Lp * MM, a: spec.pipe.r * MM });
  for (let i = spec.head.length - 1; i >= 0; i--) {
    const h = spec.head[i];
    const n = Math.max(1, Math.ceil(h.L / 3));
    for (let k = 0; k < n; k++) {
      const u = (n - k - 0.5) / n;
      el.push({ kind: 'seg', L: (h.L / n) * MM, a: (h.r0 + (h.r1 - h.r0) * u) * MM });
    }
  }
  const inputRadius = spec.head.length ? spec.head[0].r0 : st.Lp > 0 ? spec.pipe.r : p.r0;
  return {
    air,
    endRadius: bodyRadius(p, Lb, Lb) * MM,
    elements: el,
    inputRadius: inputRadius * MM,
    inputCorrection: Math.max(0, spec.inputCorrection) * MM,
  };
}

function resonance(spec: SolveSpec, st: State, open: number, guess: number): number {
  const net = buildNetwork(spec, st, open);
  const near = resonanceNear(net, guess, 300);
  if (near) return near.f;
  const first = firstResonance(net, guess / 2.5, guess * 2.5);
  return first ? first.f : NaN;
}

const centsOf = (f: number, t: number) => 1200 * Math.log2(f / t);

/**
 * One-dimensional root find on a length variable.
 * `apply(x)` sets the variable, `evalF()` returns the resonance in Hz.
 * Higher x must give a lower pitch when `sign` is -1, higher pitch when +1.
 */
function solve1D(
  x0: number,
  lo: number,
  hi: number,
  target: number,
  sign: number,
  evalAt: (x: number) => number,
  refLength: number,
): { x: number; cents: number } {
  let x = Math.min(Math.max(x0, lo), hi);
  let g = centsOf(evalAt(x), target);
  if (!Number.isFinite(g)) return { x, cents: NaN };
  // Initial slope estimate from f ∝ 1/L.
  let slope = (sign * 1731) / Math.max(refLength, 10); // cents per mm
  for (let it = 0; it < 30 && Math.abs(g) > 0.05; it++) {
    let step = -g / slope;
    const maxStep = Math.max(refLength * 0.3, 5);
    step = Math.max(-maxStep, Math.min(maxStep, step));
    let xn = Math.min(Math.max(x + step, lo), hi);
    if (xn === x) break;
    const gn = centsOf(evalAt(xn), target);
    if (!Number.isFinite(gn)) {
      xn = x + step / 2;
      continue;
    }
    const s = (gn - g) / (xn - x);
    if (Number.isFinite(s) && Math.sign(s) === Math.sign(sign) && Math.abs(s) > 1e-3) slope = s;
    x = xn;
    g = gn;
  }
  return { x, cents: g };
}

export function solveInstrument(spec: SolveSpec): SolveResult {
  const warnings: string[] = [];
  const air = airAt(spec.tempC);
  const f0 = spec.targets[0];
  const N = spec.targets.length - 1;
  const conical = spec.body.type === 'conical';
  const headLength = spec.head.reduce((a, h) => a + h.L, 0);

  // Initial estimate of the acoustic length for the lowest note.
  const quarter = (air.c / (4 * f0)) * 1000;
  const Leff0 = conical ? quarter * 2 * 0.92 : quarter - 0.6 * spec.body.r0;
  const st: State = { Lb: 0, Lp: 0, d: [], dia: [], chim: [] };
  const fixedPipe = spec.pipe.mode === 'fixed' ? spec.pipe.L : 0;
  let bodyGuess = Leff0 - headLength - fixedPipe - spec.inputCorrection;
  if (spec.pipe.mode === 'auto') bodyGuess = Leff0 * 0.5;
  st.Lb = Math.max(spec.minBody, bodyGuess);
  st.Lp = spec.pipe.mode === 'fixed' ? spec.pipe.L : 0;
  for (let i = 0; i < N; i++) {
    const Li = Leff0 * (f0 / spec.targets[i + 1]);
    st.d.push(Math.max(10 + i * 8, (Leff0 - Li) * 1.08));
  }
  for (let i = 1; i < N; i++) st.d[i] = Math.max(st.d[i], st.d[i - 1] + 6);

  const shrink = new Array(N).fill(1);
  const updateHoleSizes = () => {
    for (let i = 0; i < N; i++) {
      const s = Math.max(0, holeS(st, i));
      const r = bodyRadius(spec.body, s, st.Lb);
      const want = spec.holeDiameter(i, r);
      st.dia[i] = Math.max(Math.min(want, spec.holeMinDiameter), want * shrink[i]);
      st.chim[i] = spec.chimney(i, r);
    }
  };
  updateHoleSizes();

  const guesses = spec.targets.slice();
  let converged = false;
  let lastErr = Infinity;

  for (let sweep = 0; sweep < 14; sweep++) {
    // Lowest note: total length.
    if (spec.pipe.mode === 'auto') {
      const top = N > 0 ? st.d[N - 1] : 0;
      const LbFix = Math.max(spec.minBody, top + spec.topMargin);
      st.Lb = LbFix;
      const r = solve1D(
        Math.max(st.Lp, spec.pipe.minL),
        spec.pipe.minL,
        20000,
        f0,
        -1,
        (x) => {
          st.Lp = x;
          return resonance(spec, st, 0, guesses[0]);
        },
        Leff0,
      );
      st.Lp = r.x;
    } else {
      const lo = Math.max(spec.minBody, N > 0 ? st.d[N - 1] + spec.topMargin * 0.5 : spec.minBody);
      const r = solve1D(
        st.Lb,
        lo,
        20000,
        f0,
        -1,
        (x) => {
          st.Lb = x;
          return resonance(spec, st, 0, guesses[0]);
        },
        Leff0,
      );
      st.Lb = r.x;
    }
    guesses[0] = resonance(spec, st, 0, guesses[0]) || guesses[0];

    // Each hole in turn, bottom first.
    for (let i = 0; i < N; i++) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const gapBelow = i === 0 ? 3 : (st.dia[i] + st.dia[i - 1]) / 2 + 2;
        const lo = i === 0 ? 3 : st.d[i - 1] + gapBelow;
        const hi = Math.max(lo, st.Lb - (st.dia[i] / 2 + 2));
        const r = solve1D(
          st.d[i],
          lo,
          hi,
          spec.targets[i + 1],
          +1,
          (x) => {
            st.d[i] = x;
            return resonance(spec, st, i + 1, guesses[i + 1]);
          },
          Math.max(st.Lb - st.d[i], 20),
        );
        st.d[i] = r.x;
        // Crowded against the hole below and still sharp: a smaller hole
        // sits further up the bore, so shrink it and try again.
        const crowded = i > 0 && r.x <= lo + 0.01 && r.cents > 0.5;
        if (!crowded || st.dia[i] <= spec.holeMinDiameter + 0.01) break;
        shrink[i] *= 0.88;
        st.dia[i] = Math.max(spec.holeMinDiameter, st.dia[i] * 0.88);
      }
      guesses[i + 1] = resonance(spec, st, i + 1, guesses[i + 1]) || guesses[i + 1];
    }
    updateHoleSizes();

    let err = 0;
    for (let i = 0; i <= N; i++) {
      guesses[i] = resonance(spec, st, i, guesses[i]) || guesses[i];
      err = Math.max(err, Math.abs(centsOf(guesses[i], spec.targets[i])));
    }
    if (err < 0.5) {
      converged = true;
      break;
    }
    if (sweep > 4 && Math.abs(err - lastErr) < 0.05) break;
    lastErr = err;
  }

  // Final predictions, including the overblown resonance of each fingering.
  const notes: NoteResult[] = [];
  for (let i = 0; i <= N; i++) {
    const net = buildNetwork(spec, st, i);
    const pred = resonance(spec, st, i, guesses[i]);
    const ps = findPeaks(net, pred * 1.5, pred * (conical ? 2.6 : 3.6), 12);
    const max = ps.length ? Math.max(...ps.map((p) => p.mag)) : 0;
    const second = ps.find((p) => p.mag > 0.25 * max)?.f ?? null;
    notes.push({ target: spec.targets[i], predicted: pred, cents: centsOf(pred, spec.targets[i]), second });
  }

  const holes: SolvedHole[] = st.d.map((d, i) => {
    const s = st.Lb - d;
    return { index: i, s, fromEnd: d, diameter: st.dia[i], chimney: st.chim[i], boreRadius: bodyRadius(spec.body, s, st.Lb) };
  });

  for (const n of notes) {
    if (!Number.isFinite(n.cents) || Math.abs(n.cents) > 5) {
      warnings.push(
        `Could not tune the note at ${n.target.toFixed(1)} Hz (off by ${Number.isFinite(n.cents) ? n.cents.toFixed(0) : '?'} cents). Try smaller or larger holes, or fewer notes.`,
      );
    }
  }
  if (spec.body.bellLength > 0 && holes.length && holes[0].fromEnd < spec.body.bellLength) {
    warnings.push('The lowest hole sits in the bell flare. Shorten the bell or reduce its diameter.');
  }
  for (const h of holes) {
    if (h.diameter > 2 * h.boreRadius * 0.95) {
      warnings.push(`Hole ${h.index + 1} (${h.diameter.toFixed(1)} mm) is nearly as wide as the bore; it will be weak. Lower the hole ratio.`);
      break;
    }
  }
  if (spec.pipe.mode === 'auto' && st.Lp <= spec.pipe.minL + 0.01) {
    warnings.push('The pipe is at its minimum length; the body bore had to take up the extra length.');
  }

  return { bodyLength: st.Lb, pipeLength: st.Lp, headLength, holes, notes, warnings, converged };
}
