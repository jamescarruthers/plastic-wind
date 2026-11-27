import { describe, it, expect, beforeAll } from 'vitest';
import { DEFAULT_DESIGN } from '../src/model/design';
import { FAMILIES, applyPreset } from '../src/model/presets';
import { generate } from '../src/pipeline';
import { loadManifold, type ManifoldToplevel } from '../src/geometry/manifold';

let M: ManifoldToplevel;
beforeAll(async () => {
  M = await loadManifold();
});

const cases = FAMILIES.flatMap((f) => f.variants.map((v) => [f.id, v.id] as const));

describe('every preset builds', () => {
  it.each(cases)('%s / %s', async (fam, variant) => {
    const d = applyPreset({ ...DEFAULT_DESIGN }, fam, variant);
    const g = await generate(M, d);
    const worst = Math.max(...g.sol.notes.map((n) => Math.abs(n.cents)));
    const parts = g.build!.print.map((p) => `${p.name} ${p.size.map((x) => x.toFixed(0)).join('x')}`).join('; ');
    console.log(`${fam}/${variant}: body ${g.sol.bodyLength.toFixed(0)} pipe ${g.sol.pipeLength.toFixed(0)} worst ${worst.toFixed(1)}c loops ${g.lay.loops} legs ${g.lay.legs} t=${Object.values(g.timings).map((t) => t.toFixed(0)).join('/')}ms\n  ${parts}\n  warn: ${g.warnings.join(' | ')}`);
    expect(g.build!.print.length).toBeGreaterThan(0);
    for (const p of g.build!.print) expect(p.volume).toBeGreaterThan(0);
  });
});
