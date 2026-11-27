import { describe, it, expect, beforeAll } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { DEFAULT_DESIGN, type Design } from '../src/model/design';
import { applyPreset } from '../src/model/presets';
import { generate } from '../src/pipeline';
import { loadManifold, type ManifoldToplevel } from '../src/geometry/manifold';
import { build3mf } from '../src/export/threemf';
import { buildNotesText } from '../src/report';

let M: ManifoldToplevel;
beforeAll(async () => {
  M = await loadManifold();
});

function variants(): [string, Design][] {
  const base = applyPreset({ ...DEFAULT_DESIGN }, 'chalumeau', 'alto');
  return [
    ['halves, round bore', base],
    ['one piece standing, cut with joints', { ...base, split: 'none', bedZ: 150 }],
    ['folded slab, teardrop', { ...applyPreset({ ...DEFAULT_DESIGN }, 'crumhorn', 'bass'), bodyStyle: 'slab', boreShape: 'teardrop' }],
    ['folded web, one piece', { ...applyPreset({ ...DEFAULT_DESIGN }, 'rackett', 'tenor'), bodyStyle: 'web', split: 'none', segment: false }],
    ['membrane, pipe nozzle, auto pipe', { ...base, exciter: 'membrane', membraneNozzle: 'pipe', pipeLengthMode: 'auto' }],
    ['double reed straw with wind cap', { ...base, exciter: 'double-reed', doubleReedSeat: 'straw', windcap: true }],
    ['oboe reed, conical, spigot body fit', { ...applyPreset({ ...DEFAULT_DESIGN }, 'oboe', 'oboe'), pipeLengthMode: 'fixed', pipeLength: 60, bodyFit: 'spigot', boreDiameter: 8 }],
    ['adapter for shop mouthpiece', { ...base, singleReedMode: 'adapter' }],
    ['blocks, folded halves', { ...applyPreset({ ...DEFAULT_DESIGN }, 'crumhorn', 'bass'), bodyStyle: 'blocks' }],
    ['rounded blocks, dulcian with bell turned up', { ...applyPreset({ ...DEFAULT_DESIGN }, 'dulcian', 'alto'), bodyStyle: 'rounded' }],
    ['blocks, straight with pipe and spigot fit', { ...base, bodyStyle: 'blocks', pipeLengthMode: 'fixed', pipeLength: 120, bodyFit: 'spigot', matchPipeBore: false, boreDiameter: 10 }],
    ['custom list, no thumb hole', { ...base, rangeMode: 'list', noteList: 'D4 E4 F#4 G4 A4 B4 C#5', thumbHole: false }],
  ];
}

describe('3MF export', () => {
  it.each(variants())('%s', async (_label, d) => {
    const g = await generate(M, d);
    const parts = g.build!.print;
    expect(parts.length).toBeGreaterThan(0);
    // Every part must come back as a valid closed manifold.
    for (const p of parts) {
      const mesh = new M.Mesh({ numProp: 3, vertProperties: p.positions, triVerts: p.indices });
      const m = new M.Manifold(mesh);
      expect(m.status()).toBe('NoError');
      expect(m.volume()).toBeGreaterThan(1);
      // Rests on the bed.
      expect(Math.abs(m.boundingBox().min[2])).toBeLessThan(1e-3);
      // No slivers: every connected piece has real volume.
      const pieces = m.decompose();
      for (const c of pieces) expect(c.volume(), `${p.name} has a sliver`).toBeGreaterThan(1);
      pieces.forEach((c) => c.delete());
      m.delete();
    }
    const zip = unzipSync(build3mf(parts, 'Test', buildNotesText(g)));
    expect(Object.keys(zip).sort()).toEqual(['3D/3dmodel.model', 'Metadata/build-notes.txt', '[Content_Types].xml', '_rels/.rels']);
    const xml = strFromU8(zip['3D/3dmodel.model']);
    expect(xml).toContain('unit="millimeter"');
    expect((xml.match(/<object /g) ?? []).length).toBe(parts.length);
    expect((xml.match(/<item /g) ?? []).length).toBe(parts.length);
    expect(xml).not.toMatch(/NaN|Infinity/);
  });
});

describe('bore topology', () => {
  const cases: [string, Design][] = [
    ['straight cylinder', { ...applyPreset({ ...DEFAULT_DESIGN }, 'chalumeau', 'alto'), split: 'none', segment: false }],
    ['folded with loops and legs', { ...applyPreset({ ...DEFAULT_DESIGN }, 'rackett', 'tenor'), split: 'none', segment: false }],
    ['folded conical, bell turned up', { ...applyPreset({ ...DEFAULT_DESIGN }, 'dulcian', 'alto'), split: 'none', segment: false }],
    ['square blocks, rackett', { ...applyPreset({ ...DEFAULT_DESIGN }, 'rackett', 'tenor'), bodyStyle: 'blocks', split: 'none', segment: false }],
    ['rounded blocks, bass clarinet', { ...applyPreset({ ...DEFAULT_DESIGN }, 'clarinet', 'bass'), bodyStyle: 'rounded', split: 'none', segment: false }],
    ['rounded blocks, straight chalumeau', { ...applyPreset({ ...DEFAULT_DESIGN }, 'chalumeau', 'alto'), bodyStyle: 'rounded', split: 'none', segment: false }],
  ];
  it.each(cases)('%s: genus is 1 + number of holes', async (_l, d) => {
    const g = await generate(M, d);
    const body = g.build!.print.find((p) => p.role === 'body')!;
    const m = new M.Manifold(new M.Mesh({ numProp: 3, vertProperties: body.positions, triVerts: body.indices }));
    expect(m.decompose().length).toBe(1);
    expect(m.genus()).toBe(1 + g.lay.holes.length);
    m.delete();
  });
});
