// Design -> acoustic solve -> layout -> solids.

import type { Design } from './model/design';
import { resolve, type Resolved } from './model/derive';
import { solveInstrument, type SolveResult } from './acoustics/solver';
import { layoutInstrument, type Layout } from './geometry/layout';
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

export async function generate(M: ManifoldToplevel | null, design: Design): Promise<Generated> {
  const t0 = performance.now();
  const res = resolve(design);
  const sol = solveInstrument(res.spec);
  const t1 = performance.now();
  const lay = layoutInstrument(res, sol);
  const t2 = performance.now();
  const build = M ? await buildInstrument(M, res, sol, lay) : null;
  const t3 = performance.now();
  const warnings = [...res.warnings, ...sol.warnings, ...lay.warnings, ...(build?.warnings ?? [])];
  return { res, sol, lay, build, warnings, timings: { solve: t1 - t0, layout: t2 - t1, geometry: t3 - t2 } };
}
