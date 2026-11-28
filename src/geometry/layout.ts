// Lays the solved bore out as a planar centre-line.
//
// The finger line runs down the y axis (x = 0) from the top hole to the bell.
// Front holes are drilled towards +z, thumb holes towards -z, so the split
// plane z = 0 passes through the whole bore.
//
// With the loops behind the finger holes, the layout is the same shape but
// the instrument is held edge on: finger holes are drilled out of the front
// edge (in the bore plane), the thumb hole out of the side (+z), and the
// folded legs sit behind the loops.
//
// Folded mode adds two kinds of U-bend:
//  * Loops to one side between finger holes, which soak up bore length so the
//    holes sit at a comfortable spacing.
//  * Legs on the other side that fold the hole-free upper bore, as on a
//    dulcian or rackett.

import type { Resolved } from '../model/derive';
import { isBackHole } from '../model/derive';
import type { SolveResult } from '../acoustics/solver';
import { bodyRadius } from '../acoustics/solver';
import { Path, Turtle, type Vec2 } from './path';
import { isFlatStyle, loopsBehind } from '../model/design';

export type V3 = [number, number, number];

export interface PlacedHole {
  number: number; // 1 = top
  finger: string;
  s: number; // along the body path from the inlet
  pos: Vec2;
  face: 'front' | 'back' | 'side';
  /** Drilling direction from the bore centre line, in layout coordinates. */
  dir: V3;
  diameter: number;
  chimney: number;
}

export interface Layout {
  path: Path; // from inlet (s = 0) to bell (s = length)
  holes: PlacedHole[];
  radiusAt: (s: number) => number;
  loops: number;
  legs: number;
  spacings: { from: number; to: number; dy: number }[];
  warnings: string[];
}

const DOWN = -Math.PI / 2;
const UP = Math.PI / 2;

export function layoutInstrument(res: Resolved, sol: SolveResult): Layout {
  const d = res.d;
  const behind = loopsBehind(d);
  const warnings: string[] = [];
  const Lb = sol.bodyLength;
  const radiusAt = (s: number) => bodyRadius(res.body, s, Lb);
  // Holes top first.
  const holes = sol.holes
    .slice()
    .sort((a, b) => a.s - b.s)
    .map((h, k) => ({ ...h, number: k + 1, finger: res.fingers[k] ?? 'X' }));
  const maxR = (s0: number, s1: number) => {
    let m = 0;
    for (let k = 0; k <= 8; k++) m = Math.max(m, radiusAt(s0 + ((s1 - s0) * k) / 8));
    return m;
  };

  let loops = 0;
  let legs = 0;
  const spacings: Layout['spacings'] = [];

  if (d.path === 'straight' || holes.length === 0) {
    const t = new Turtle([0, Lb], DOWN);
    t.forward(Lb);
    const path = t.path;
    for (let k = 0; k + 1 < holes.length; k++) spacings.push({ from: k + 1, to: k + 2, dy: holes[k + 1].s - holes[k].s });
    return finish(path, 0, 0);
  }

  // ---- Finger line, from its top (0,0) down to the bell end.
  // Loops go to +x for "right". When they go behind, the layout keeps them on
  // +x and the preview turns the instrument so -x faces the player's fingers.
  const side = behind || d.meanderSide === 'right' ? 1 : -1;
  const top = holes[0];
  const topMargin = Math.min(top.s, top.diameter / 2 + d.wall + 2);
  const sTop = top.s - topMargin; // where the finger line starts
  const fl = new Turtle([0, 0], DOWN);
  fl.forward(topMargin);
  let raised = false;
  for (let k = 0; k + 1 < holes.length; k++) {
    const a = holes[k];
    const b = holes[k + 1];
    const dL = b.s - a.s;
    let target = d.fingerSpacing;
    if (a.finger === 'LT' || b.finger === 'LT') target = d.thumbSpacing;
    else if (a.finger === 'L3' && b.finger === 'R1') target = d.fingerSpacing + d.handGap;
    const rr = maxR(a.s, b.s);
    const R = rr + d.bendWall / 2;
    // Straight run needed beside each hole so the drilled hole cannot break
    // into the loop arm next to it.
    const vMin = (bh: number) => Math.max(0, Math.sqrt(Math.max(0, (bh + rr + d.bendWall / 2) ** 2 - R * R)) - R);
    const va = vMin(a.diameter / 2);
    const vb = vMin(b.diameter / 2);
    const minDy = 4 * R + va + vb;
    const dy = Math.max(target, minDy);
    const extra = dL - dy - (2 * Math.PI - 4) * R;
    if (d.meander && extra > 0.5) {
      if (target < minDy) raised = true;
      const arm = extra / 2;
      const slack = (dy - minDy) / 2;
      fl.forward(va + slack);
      fl.group = 10 + k;
      fl.turn((side * Math.PI) / 2, R);
      fl.forward(arm);
      fl.turn(-side * Math.PI, R);
      fl.forward(arm);
      fl.turn((side * Math.PI) / 2, R);
      fl.group = 0;
      fl.forward(vb + slack);
      loops++;
      spacings.push({ from: a.number, to: b.number, dy });
    } else if (d.meander && dL - target > 1) {
      // Too short for a loop: a sideways bump of four arcs, angle θ each.
      // Vertical span 4R·sinθ, path length 4R·θ.
      let dy2 = target;
      let th = solveBump((dL - dy2) / (4 * R));
      if (4 * R * Math.sin(th) > dy2) {
        th = Math.min(Math.PI / 2, dL / (4 * R));
        dy2 = 4 * R * Math.sin(th);
      }
      const v = Math.max(0, (dL - 4 * R * th) / 2);
      fl.forward(v);
      fl.group = 10 + k;
      fl.turn(side * th, R);
      fl.turn(-side * th, R);
      fl.turn(-side * th, R);
      fl.turn(side * th, R);
      fl.group = 0;
      fl.forward(Math.max(0, dL - v - 4 * R * th));
      loops++;
      spacings.push({ from: a.number, to: b.number, dy: 2 * v + 4 * R * Math.sin(th) });
    } else {
      fl.forward(dL);
      spacings.push({ from: a.number, to: b.number, dy: dL });
    }
  }
  const last = holes[holes.length - 1];
  const tail = Lb - last.s;
  // Optionally turn the bell back up beside the finger line, as on a saxophone.
  const clearBelow = last.diameter / 2 + d.wall + 6;
  if (d.bellFold && tail > clearBelow + 60) {
    const sB = last.s + clearBelow;
    const Rbell0 = maxR(sB, Math.min(Lb, sB + 80)) + d.bendWall / 2;
    const reach = Math.max(0, fl.path.bounds()[side > 0 ? 'max' : 'min'][0] * side);
    // The upturned bell must clear the loops: centre-line reach, plus both bore
    // radii, plus the wall between them.
    const rUp = maxR(sB, Lb);
    const rLoops = maxR(sTop, sB);
    // Block bodies square off the loops at their outer wall, so the bell
    // mouth must also clear the wall to stay open.
    const extraWall = isFlatStyle(d.bodyStyle) ? d.wall + 1 : 0;
    const Rb = Math.max(Rbell0, reach > 0 ? (reach + rLoops + extraWall + rUp + d.bendWall) / 2 : 0);
    fl.forward(clearBelow);
    fl.group = 2;
    fl.turn(side * Math.PI, Rb);
    fl.forward(Math.max(0, tail - clearBelow - Math.PI * Rb));
    if (tail - clearBelow - Math.PI * Rb < 0) warnings.push('The bell section is too short to fold; it ends in the bend.');
  } else {
    // The bell gets its own block, starting clear of the lowest hole.
    const lead = Math.min(tail, last.diameter / 2 + d.wall + 2);
    fl.forward(lead);
    fl.group = 3;
    fl.forward(tail - lead);
    fl.group = 0;
  }
  if (raised) warnings.push('Some finger spacings were widened to make room for the U-bends. A narrower bore allows tighter bends.');

  // ---- Upper bore, built upwards from the top of the finger line.
  const Lu = sTop;
  const bellStartS = res.body.bellLength > 0 ? Lb - res.body.bellLength : Lb;
  // Legs are spaced for the bore they carry. Only the first bend, which
  // brings the bore round beside the finger line, must clear that bore too.
  const rU = maxR(0, sTop);
  const rF = maxR(sTop, bellStartS);
  const Rl = rU + d.bendWall / 2;
  const R1 = (rU + rF + d.bendWall) / 2;
  const flBounds = fl.path.bounds();
  // Lowest y the legs may reach without hitting the bell. Legs behind the
  // loops sit clear of everything, so they may run to the bottom.
  const yLimit = d.bellFold || behind ? flBounds.min[1] : fl.path.at(bellStartS - sTop).p[1];
  const hAuto = Math.max(4 * Rl, -yLimit - Rl - (behind ? 0 : res.body.bellRadius - res.body.r0));
  const hMax = d.legLength > 0 ? d.legLength : hAuto;
  const e = Rl + radiusAt(0) + 2 + Math.max(0, res.socket.r - Rl);
  const up = new Turtle([0, 0], UP);
  let folded = false;
  // Legs go opposite the loops, or behind them. Heading up, a positive (left)
  // turn swings to -x.
  const legSign = behind ? -side : side;
  // Behind: cross over above the top hole, past everything the finger
  // section reaches, then fold downwards.
  const reach = side > 0 ? flBounds.max[0] : -flBounds.min[0];
  const X1 = behind && reach > 0.5 ? reach + maxR(sTop, Lb) + rU + d.bendWall : 2 * R1;
  const cross = behind ? Math.max(0, X1 - 2 * Rl) : 0;
  // Length used: e + 2n·h + first bend + (2n − 1)·π·Rl, where the first bend
  // is π·R1, or π·Rl plus the crossover when behind.
  const spare = Lu - e - (behind ? cross : Math.PI * (R1 - Rl));
  if (d.foldUpper && Lu > 0.6 * hMax + e) {
    const n = Math.max(1, Math.ceil(spare / (2 * (hMax + Math.PI * Rl))));
    const h = spare / (2 * n) - Math.PI * Rl;
    if (h > Rl) {
      up.group = 1;
      for (let k = 0; k < n; k++) {
        if (k === 0 && behind) {
          // The crossover is its own block, so it does not cover the front of
          // the finger section.
          up.group = 4;
          up.turn((legSign * Math.PI) / 2, Rl);
          up.forward(cross);
          up.turn((legSign * Math.PI) / 2, Rl);
          up.group = 1;
        } else {
          up.turn(legSign * Math.PI, k === 0 ? R1 : Rl); // over the top, now heading down
        }
        up.forward(h);
        up.turn(-legSign * Math.PI, Rl); // round the bottom, heading up
        up.forward(k === n - 1 ? h + e : h);
      }
      legs = 2 * n;
      folded = true;
    }
  }
  if (!folded) up.forward(Lu);

  const upper = up.path.reversed();
  const path = new Path([...upper.pieces, ...fl.path.pieces]);
  return finish(path, loops, legs);

  function finish(path: Path, nLoops: number, nLegs: number): Layout {
    if (Math.abs(path.length - Lb) > 0.5) warnings.push(`Layout length mismatch (${path.length.toFixed(1)} vs ${Lb.toFixed(1)} mm).`);
    const placed: PlacedHole[] = holes.map((h) => {
      const { p } = path.at(h.s);
      const thumb = isBackHole(h.finger);
      // Behind: finger holes go out of the front edge (-x, away from the
      // loops) and the thumb hole out of the side (+z).
      const face: PlacedHole['face'] = behind ? (thumb ? 'side' : 'front') : thumb ? 'back' : 'front';
      const dir: V3 = behind ? (thumb ? [0, 0, 1] : [-side, 0, 0]) : thumb ? [0, 0, -1] : [0, 0, 1];
      return {
        number: h.number,
        finger: h.finger,
        s: h.s,
        pos: p,
        face,
        dir,
        diameter: h.diameter,
        chimney: h.chimney,
      };
    });
    // Finger stretch check
    for (const sp of spacings) {
      const a = placed[sp.from - 1];
      const b = placed[sp.to - 1];
      const bothFront = a.face === 'front' && b.face === 'front';
      if (bothFront && sp.dy > 38) {
        warnings.push(
          d.path === 'folded' && d.meander
            ? `Holes ${sp.from} and ${sp.to} are ${sp.dy.toFixed(0)} mm apart, the closest the bends allow with this bore. A narrower bore or thinner bend wall brings them closer.`
            : `Holes ${sp.from} and ${sp.to} are ${sp.dy.toFixed(0)} mm apart, a long stretch. Try the folded path with loops.`,
        );
        break;
      }
    }
    return { path, holes: placed, radiusAt, loops: nLoops, legs: nLegs, spacings, warnings };
  }
}

/** θ in [0, π/2] with θ - sin θ = k. */
function solveBump(k: number): number {
  let lo = 0;
  let hi = Math.PI / 2;
  if (k >= hi - 1) return hi;
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2;
    if (m - Math.sin(m) < k) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}
