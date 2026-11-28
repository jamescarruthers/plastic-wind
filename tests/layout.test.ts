import { describe, it, expect } from 'vitest';
import { DEFAULT_DESIGN, type Design } from '../src/model/design';
import { applyPreset } from '../src/model/presets';
import { generate } from '../src/pipeline';

describe('loop sides', () => {
  // Side of each loop: the sign of the mean x of its bend centres.
  const loopSides = async (patch: Partial<Design>) => {
    const d = { ...applyPreset({ ...DEFAULT_DESIGN }, 'rackett', 'tenor'), ...patch } as Design;
    const g = await generate(null, d);
    const loops = g.lay.path.pieces.filter((p) => (p.group ?? 0) >= 10);
    return Array.from(new Set(loops.map((p) => p.group))).map((grp) => {
      const xs = loops.filter((p) => p.group === grp && p.kind === 'arc').map((a) => (a.kind === 'arc' ? a.c[0] : 0));
      return Math.sign(xs.reduce((a, b) => a + b, 0));
    });
  };

  it.each([
    ['right', false],
    ['left', false],
    ['right', true],
    ['left', true],
  ] as const)('%s, alternate %s', async (side, alternate) => {
    const signs = await loopSides({ meanderSide: side, alternateLoops: alternate });
    expect(signs.length).toBeGreaterThan(2);
    expect(signs[0]).toBe(side === 'right' ? 1 : -1);
    signs.forEach((s, i) => expect(s).toBe(alternate && i % 2 === 1 ? -signs[0] : signs[0]));
  });

  it('reads the old "alternate" side setting as right-first alternating', async () => {
    expect(await loopSides({ meanderSide: 'alternate' })).toEqual(await loopSides({ meanderSide: 'right', alternateLoops: true }));
  });
});

describe('two columns of holes', () => {
  const layoutOf = async (patch: Partial<Design>) => {
    const d = { ...applyPreset({ ...DEFAULT_DESIGN }, 'rackett', 'bass'), holeColumns: true, ...patch } as Design;
    return generate(null, d);
  };

  it('lines the columns up when there is bore enough between the hands', async () => {
    // A fifth between the hands leaves room to climb back to the top.
    const g = await layoutOf({ rangeMode: 'list', noteList: 'C2 D2 E2 F2 G2 D3 E3 F3 G3' });
    const h = g.lay.holes;
    const split = h.findIndex((x) => x.finger === 'R1');
    expect(split).toBe(4);
    const col1 = h.slice(0, split);
    const col2 = h.slice(split);
    for (const x of col1) expect(Math.abs(x.pos[0])).toBeLessThan(0.01);
    for (const x of col2) expect(x.pos[0]).toBeCloseTo(col2[0].pos[0], 3);
    expect(col2[0].pos[0]).toBeGreaterThan(15);
    expect(Math.abs(col2[0].pos[1] - col1[0].pos[1])).toBeLessThan(1);
    expect(g.warnings.some((w) => /lower than the first/.test(w))).toBe(false);
  });

  it('starts the second column lower, with a warning, when the bore is short', async () => {
    const g = await layoutOf({});
    const h = g.lay.holes;
    const r1 = h.find((x) => x.finger === 'R1')!;
    expect(r1.pos[0]).toBeGreaterThan(15);
    expect(r1.pos[1]).toBeLessThan(h[0].pos[1]);
    expect(g.warnings.some((w) => /lower than the first/.test(w))).toBe(true);
  });

  it('falls back to one line when the hands are too close along the bore', async () => {
    const d = { ...applyPreset({ ...DEFAULT_DESIGN }, 'chalumeau', 'alto'), path: 'folded', holeColumns: true } as Design;
    const g = await generate(null, d);
    for (const x of g.lay.holes) expect(Math.abs(x.pos[0])).toBeLessThan(0.01);
    expect(g.warnings.some((w) => /stay in one line/.test(w))).toBe(true);
  });
});
