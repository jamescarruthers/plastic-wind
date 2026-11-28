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
    ['loops behind, halves, tube', { ...applyPreset({ ...DEFAULT_DESIGN }, 'rackett', 'tenor'), loopDirection: 'back' }],
    ['loops behind, halves, rounded blocks, bell turned up', { ...applyPreset({ ...DEFAULT_DESIGN }, 'dulcian', 'alto'), loopDirection: 'back', bodyStyle: 'rounded' }],
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

describe('air path is open', () => {
  const P = (fam: string, v: string, patch: Partial<Design>): Design => ({ ...applyPreset({ ...DEFAULT_DESIGN }, fam, v), ...patch }) as Design;
  const one = { split: 'none', segment: false } as const;
  const cases: [string, Design][] = [
    ['straight cylinder, one piece', P('chalumeau', 'alto', one)],
    ['straight, halves, rounded blocks', P('chalumeau', 'alto', { bodyStyle: 'rounded' })],
    ['straight, flat slab', P('chalumeau', 'alto', { ...one, bodyStyle: 'slab' })],
    ['rackett, loops and legs, tube', P('rackett', 'tenor', one)],
    ['rackett, web', P('rackett', 'tenor', { ...one, bodyStyle: 'web' })],
    ['rackett, slab', P('rackett', 'tenor', { ...one, bodyStyle: 'slab' })],
    ['rackett, square blocks', P('rackett', 'tenor', { ...one, bodyStyle: 'blocks' })],
    ['dulcian, bell turned up, tube', P('dulcian', 'alto', one)],
    ['dulcian, bell turned up, slab', P('dulcian', 'alto', { ...one, bodyStyle: 'slab' })],
    ['bass clarinet, rounded blocks', P('clarinet', 'bass', { ...one, bodyStyle: 'rounded' })],
    ['bass oboe, tube', P('oboe', 'bass', one)],
    ['loops behind, rackett, tube', P('rackett', 'tenor', { ...one, loopDirection: 'back' })],
    ['loops behind, bass clarinet, tube', P('clarinet', 'bass', { ...one, loopDirection: 'back' })],
    ['loops behind, great bass crumhorn, slab', P('crumhorn', 'greatbass', { ...one, loopDirection: 'back', bodyStyle: 'slab' })],
    ['loops behind, tenor sax, square blocks', P('saxophone', 'tenor', { ...one, loopDirection: 'back', bodyStyle: 'blocks' })],
    ['loops behind, bass dulcian, web', P('dulcian', 'bass', { ...one, loopDirection: 'back', bodyStyle: 'web' })],
    ['loops behind, bass dulcian, rounded blocks', P('dulcian', 'bass', { ...one, loopDirection: 'back', bodyStyle: 'rounded' })],
    ['loops behind, alto dulcian, halves', P('dulcian', 'alto', { loopDirection: 'back' })],
    ['joining pipe, rackett, halves', P('rackett', 'tenor', { midPipe: true })],
    ['joining pipe, rackett, square blocks', P('rackett', 'tenor', { ...one, midPipe: true, bodyStyle: 'blocks' })],
    ['joining pipe, rackett, rounded blocks, loops behind', P('rackett', 'tenor', { ...one, midPipe: true, bodyStyle: 'rounded', loopDirection: 'back' })],
    ['joining pipe, bass dulcian, slab, loops behind', P('dulcian', 'bass', { ...one, midPipe: true, bodyStyle: 'slab', loopDirection: 'back' })],
  ];
  it.each(cases)('%s', async (_l, d) => {
    const g = await generate(M, d, { verify: true });
    const v = g.build!.verify!;
    expect(v.bellOpen, 'bell open').toBe(true);
    expect(v.strayOpenings, 'bore breaks through the wall').toBe(0);
    for (const h of v.holes) {
      expect(h.reachesBore, `hole ${h.number} reaches the bore`).toBe(true);
      expect(h.breaksOut, `hole ${h.number} breaks out of the body`).toBe(true);
    }
    // One-piece bodies come out as one solid each; with a joining pipe there
    // are two, the upper block and the finger block.
    if (d.split === 'none') {
      const bodies = g.build!.print.filter((p) => p.role === 'body');
      expect(bodies.map((b) => b.name)).toEqual(g.res.joint ? ['Upper block', 'Finger block'].filter((n) => bodies.some((b) => b.name === n)) : ['Body']);
      if (g.res.joint) expect(bodies.length).toBe(2);
      for (const body of bodies) {
        const m = new M.Manifold(new M.Mesh({ numProp: 3, vertProperties: body.positions, triVerts: body.indices }));
        const parts = m.decompose();
        expect(parts.length).toBe(1);
        parts.forEach((c) => c.delete());
        m.delete();
      }
    }
    // Every note still tunes with a joining pipe in the bore (cylindrical bores).
    if (g.res.joint && d.boreType === 'cylindrical') for (const n of g.sol.notes) expect(Math.abs(n.cents)).toBeLessThan(2);
  });
});
