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
