// Design -> acoustic solve -> layout -> solids.

import type { Design } from './model/design';
import { resolve, type Resolved } from './model/derive';
import { solveInstrument, type SolveResult } from './acoustics/solver';
import { layoutInstrument, fingerTopMargin, type Layout } from './geometry/layout';
import { buildInstrument, type BuildResult } from './geometry/build';
import type { ManifoldToplevel } from './geometry/manifold';

export interface Generated {
  res: Resolved;
  sol: SolveResult;
  lay: Layout;
  build: BuildResult | null;
  warnings: string[];
  timings: Record<string, number>;
}

export async function generate(M: ManifoldToplevel | null, design: Design, opts: { verify?: boolean } = {}): Promise<Generated> {
  const t0 = performance.now();
  const res = resolve(design);
  let sol = solveInstrument(res.spec);
  if (res.joint) {
    // Put the joining pipe just above the top hole, then solve again with
    // it in the bore, until the hole positions settle.
    for (let k = 0; k < 4; k++) {
      const top = sol.holes.reduce((a, b) => (b.s < a.s ? b : a));
      const fromEnd = sol.bodyLength - (top.s - fingerTopMargin(top.s, top.diameter, design.wall));
      const prev = res.spec.body.insert?.fromEnd;
      res.spec.body.insert = { fromEnd, length: res.joint.length, r: res.pipe.id_ / 2 };
      if (prev !== undefined && Math.abs(prev - fromEnd) < 0.2) break;
      sol = solveInstrument(res.spec);
    }
    const upperLen = sol.bodyLength - res.spec.body.insert!.fromEnd - res.joint.length;
    if (upperLen < 20) {
      res.warnings.push(
        `There is too little bore above the top hole for an upper block with a ${res.joint.length.toFixed(0)} mm joining pipe; the pipe is left out. A shorter pipe or a lower note leaves room.`,
      );
      delete res.spec.body.insert;
      res.joint = null;
      sol = solveInstrument(res.spec);
    } else {
      // A pipe much wider or narrower than the bore it replaces upsets the tuning.
      const top = sol.holes.reduce((a, b) => (b.s < a.s ? b : a));
      const boreD = 2 * Math.max(res.body.r0, top.boreRadius);
      const pipeD = res.pipe.id_;
      if (Math.abs(pipeD - boreD) / boreD > 0.35) {
        res.warnings.push(`The joining pipe's bore (${pipeD.toFixed(1)} mm) is far from the bore it replaces (about ${boreD.toFixed(1)} mm). Choose a pipe closer in size, or the low notes may not tune.`);
      }
    }
  }
  const t1 = performance.now();
  const lay = layoutInstrument(res, sol);
  const t2 = performance.now();
  const build = M ? await buildInstrument(M, res, sol, lay, opts) : null;
  const t3 = performance.now();
  const warnings = Array.from(new Set([...res.warnings, ...sol.warnings, ...lay.warnings, ...(build?.warnings ?? [])]));
  return { res, sol, lay, build, warnings, timings: { solve: t1 - t0, layout: t2 - t1, geometry: t3 - t2 } };
}
