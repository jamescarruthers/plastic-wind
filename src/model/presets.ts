// Instrument families and their treble/bass variants.
// Values are starting points for keyless, printable versions of each instrument,
// not measurements of historical originals.

import type { Design } from './design';

export interface Variant {
  id: string;
  label: string;
  patch: Partial<Design>;
}

export interface Family {
  id: string;
  label: string;
  notes: string;
  base: Partial<Design>;
  variants: Variant[];
}

const cylSingle: Partial<Design> = {
  boreType: 'cylindrical',
  exciter: 'single-reed',
  singleReedMode: 'printed',
  matchPipeBore: true,
  thumbHole: true,
  rangeMode: 'scale',
  scale: 'major',
  noteCount: 9,
  bell: true,
};

const cylDouble: Partial<Design> = {
  boreType: 'cylindrical',
  exciter: 'double-reed',
  doubleReedSeat: 'straw',
  matchPipeBore: true,
  thumbHole: true,
  rangeMode: 'scale',
  scale: 'major',
  noteCount: 9,
  bell: false,
};

const conDouble: Partial<Design> = {
  boreType: 'conical',
  exciter: 'double-reed',
  doubleReedSeat: 'oboe',
  matchPipeBore: false,
  thumbHole: false,
  rangeMode: 'scale',
  scale: 'major',
  noteCount: 7,
  bell: true,
  pipeLengthMode: 'none',
};

export const FAMILIES: Family[] = [
  {
    id: 'chalumeau',
    label: 'Chalumeau',
    notes: 'Baroque ancestor of the clarinet: cylindrical bore, single reed, seven finger holes and a thumb hole, no keys.',
    base: { ...cylSingle, pipeLengthMode: 'none' },
    variants: [
      { id: 'soprano', label: 'Soprano in F', patch: { lowestNote: 'F4', pipe: 'cu12', reedSize: 'clarinet-eb', bellDiameter: 16, bellLength: 30, path: 'straight' } },
      { id: 'alto', label: 'Alto in C', patch: { lowestNote: 'C4', pipe: 'cu15', reedSize: 'clarinet-bb', bellDiameter: 22, bellLength: 35, path: 'straight' } },
      { id: 'tenor', label: 'Tenor in F', patch: { lowestNote: 'F3', pipe: 'ovf215', reedSize: 'sax-alto', bellDiameter: 30, bellLength: 45, path: 'folded' } },
      { id: 'bass', label: 'Bass in C', patch: { lowestNote: 'C3', pipe: 'cu22', reedSize: 'sax-tenor', bellDiameter: 34, bellLength: 55, path: 'folded' } },
    ],
  },
  {
    id: 'clarinet',
    label: 'Clarinet (keyless)',
    notes: 'Cylindrical single-reed tube with a bell. Plays the chalumeau register; the upper register sounds a twelfth higher.',
    base: { ...cylSingle, pipeLengthMode: 'auto' },
    variants: [
      { id: 'eb', label: 'E♭ soprano', patch: { lowestNote: 'G3', pipe: 'cu15', reedSize: 'clarinet-eb', bellDiameter: 30, bellLength: 50, path: 'straight' } },
      { id: 'bb', label: 'B♭ soprano', patch: { lowestNote: 'D3', pipe: 'cuM12', reedSize: 'clarinet-bb', bellDiameter: 36, bellLength: 60, path: 'straight' } },
      { id: 'alto', label: 'E♭ alto', patch: { lowestNote: 'G2', pipe: 'ovf215', reedSize: 'sax-alto', bellDiameter: 50, bellLength: 70, path: 'folded' } },
      { id: 'bass', label: 'B♭ bass', patch: { lowestNote: 'D2', pipe: 'cu22', reedSize: 'sax-tenor', bellDiameter: 60, bellLength: 80, path: 'folded' } },
    ],
  },
  {
    id: 'saxophone',
    label: 'Saxophone (keyless)',
    notes: 'Conical single-reed tube in the style of a keyless folk saxophone. Overblows at the octave.',
    base: { boreType: 'conical', exciter: 'single-reed', singleReedMode: 'printed', matchPipeBore: false, thumbHole: true, rangeMode: 'scale', scale: 'major', noteCount: 8, bell: true, pipeLengthMode: 'none', bellFold: false },
    variants: [
      { id: 'soprano', label: 'B♭ soprano', patch: { lowestNote: 'Ab3', pipe: 'cu15', reedSize: 'clarinet-bb', boreDiameter: 10, boreEndDiameter: 28, bellDiameter: 50, bellLength: 50, path: 'straight' } },
      { id: 'alto', label: 'E♭ alto', patch: { lowestNote: 'Db3', pipe: 'cu15', reedSize: 'sax-alto', bellFold: true, boreDiameter: 12, boreEndDiameter: 40, bellDiameter: 70, bellLength: 70, path: 'folded' } },
      { id: 'tenor', label: 'B♭ tenor', patch: { lowestNote: 'Ab2', pipe: 'cu22', bellFold: true, reedSize: 'sax-tenor', boreDiameter: 16, boreEndDiameter: 52, bellDiameter: 90, bellLength: 90, path: 'folded' } },
      { id: 'baritone', label: 'E♭ baritone', patch: { lowestNote: 'Db2', pipe: 'cu28', bellFold: true, reedSize: 'sax-tenor', boreDiameter: 20, boreEndDiameter: 66, bellDiameter: 110, bellLength: 110, path: 'folded' } },
    ],
  },
  {
    id: 'oboe',
    label: 'Oboe family (keyless)',
    notes: 'Narrow conical bore with a double reed and a small bell, like a baroque oboe without keys.',
    base: { ...conDouble, pipe: 'cu15' },
    variants: [
      { id: 'oboe', label: 'Oboe in C', patch: { lowestNote: 'C4', boreDiameter: 4.6, boreEndDiameter: 16, bellDiameter: 30, bellLength: 70, path: 'straight' } },
      { id: 'damore', label: "Oboe d'amore in A", patch: { lowestNote: 'A3', boreDiameter: 4.8, boreEndDiameter: 18, bellDiameter: 30, bellLength: 70, path: 'straight' } },
      { id: 'english', label: 'Cor anglais in F', patch: { lowestNote: 'F3', boreDiameter: 5, boreEndDiameter: 21, bellDiameter: 34, bellLength: 80, path: 'folded' } },
      { id: 'bass', label: 'Bass oboe in C', patch: { lowestNote: 'C3', boreDiameter: 6, boreEndDiameter: 28, bellDiameter: 44, bellLength: 100, path: 'folded', doubleReedSeat: 'bassoon' } },
    ],
  },
  {
    id: 'shawm',
    label: 'Shawm',
    notes: 'Renaissance conical double-reed with a wide flared bell. Loud. Overblows at the octave.',
    base: { ...conDouble, pipe: 'cu15', thumbHole: true, noteCount: 8 },
    variants: [
      { id: 'treble', label: 'Treble in D', patch: { lowestNote: 'D4', boreDiameter: 4.5, boreEndDiameter: 20, bellDiameter: 55, bellLength: 90, path: 'straight' } },
      { id: 'alto', label: 'Alto in G', patch: { lowestNote: 'G3', boreDiameter: 5, boreEndDiameter: 26, bellDiameter: 65, bellLength: 110, path: 'straight' } },
      { id: 'tenor', label: 'Tenor in C', patch: { lowestNote: 'C3', bellFold: true, boreDiameter: 6, boreEndDiameter: 32, bellDiameter: 75, bellLength: 130, path: 'folded', doubleReedSeat: 'bassoon' } },
      { id: 'bass', label: 'Bass in F', patch: { lowestNote: 'F2', bellFold: true, boreDiameter: 7, boreEndDiameter: 40, bellDiameter: 90, bellLength: 150, path: 'folded', doubleReedSeat: 'bassoon' } },
    ],
  },
  {
    id: 'dulcian',
    label: 'Dulcian / Curtal (bassoon)',
    notes: 'Conical double reed with the bore folded back on itself, the ancestor of the bassoon.',
    base: { ...conDouble, pipe: 'cu15', path: 'folded', doubleReedSeat: 'bassoon', thumbHole: true, noteCount: 8, foldUpper: true, bellFold: true },
    variants: [
      { id: 'soprano', label: 'Soprano in G', patch: { lowestNote: 'G3', boreDiameter: 4.5, boreEndDiameter: 16, bellDiameter: 22, bellLength: 30 } },
      { id: 'alto', label: 'Alto in C', patch: { lowestNote: 'C3', boreDiameter: 5, boreEndDiameter: 20, bellDiameter: 26, bellLength: 35 } },
      { id: 'tenor', label: 'Tenor in G', patch: { lowestNote: 'G2', boreDiameter: 6, boreEndDiameter: 26, bellDiameter: 32, bellLength: 40 } },
      { id: 'bass', label: 'Bass in C', patch: { lowestNote: 'C2', boreDiameter: 7, boreEndDiameter: 34, bellDiameter: 40, bellLength: 50 } },
    ],
  },
  {
    id: 'crumhorn',
    label: 'Crumhorn',
    notes: 'Narrow cylindrical bore with a capped double reed (wind cap). Range of a ninth, no overblowing.',
    base: { ...cylDouble, windcap: true, pipeLengthMode: 'auto' },
    variants: [
      { id: 'soprano', label: 'Soprano in C', patch: { lowestNote: 'C4', pipe: 'cu8', strawDiameter: 6, path: 'straight' } },
      { id: 'alto', label: 'Alto in F', patch: { lowestNote: 'F3', pipe: 'cu10', strawDiameter: 6, path: 'straight' } },
      { id: 'tenor', label: 'Tenor in C', patch: { lowestNote: 'C3', pipe: 'cu12', strawDiameter: 7, path: 'straight' } },
      { id: 'bass', label: 'Bass in F', patch: { lowestNote: 'F2', pipe: 'cu15', doubleReedSeat: 'bassoon', path: 'folded' } },
      { id: 'greatbass', label: 'Great bass in C', patch: { lowestNote: 'C2', pipe: 'ovf215', doubleReedSeat: 'bassoon', path: 'folded' } },
    ],
  },
  {
    id: 'rackett',
    label: 'Rackett',
    notes: 'Very long cylindrical bore folded many times into a short, fat body. Low and buzzy.',
    base: { ...cylDouble, path: 'folded', foldUpper: true, meander: true, pipeLengthMode: 'none', doubleReedSeat: 'bassoon', windcap: false },
    variants: [
      { id: 'tenor', label: 'Tenor in G', patch: { lowestNote: 'G2', pipe: 'cu10' } },
      { id: 'bass', label: 'Bass in C', patch: { lowestNote: 'C2', pipe: 'cu12' } },
      { id: 'greatbass', label: 'Great bass in F', patch: { lowestNote: 'F1', pipe: 'cu15' } },
    ],
  },
  {
    id: 'chanter',
    label: 'Bagpipe chanter',
    notes: 'Highland-style chanter fingering, low G to high A. Practice chanters are cylindrical; pipe chanters are conical.',
    base: { exciter: 'double-reed', rangeMode: 'list', noteList: 'G4 A4 B4 C#5 D5 E5 F#5 G5 A5', thumbHole: true, a4: 470, path: 'straight', pipeLengthMode: 'none', bell: true },
    variants: [
      { id: 'practice', label: 'Practice chanter (cylindrical)', patch: { boreType: 'cylindrical', matchPipeBore: true, pipe: 'cu8', doubleReedSeat: 'straw', strawDiameter: 6, windcap: true, bellDiameter: 10, bellLength: 25 } },
      { id: 'pipe', label: 'Pipe chanter (conical)', patch: { boreType: 'conical', matchPipeBore: false, pipe: 'cu15', doubleReedSeat: 'oboe', boreDiameter: 4.6, boreEndDiameter: 18, windcap: false, bellDiameter: 30, bellLength: 50 } },
    ],
  },
  {
    id: 'duduk',
    label: 'Duduk',
    notes: 'Cylindrical bore with a large, soft double reed. Eight finger holes and a thumb hole.',
    base: { ...cylDouble, noteCount: 9, scale: 'minor', pipeLengthMode: 'auto', doubleReedSeat: 'bassoon', bell: false },
    variants: [
      { id: 'c', label: 'Duduk in C', patch: { lowestNote: 'B3', pipe: 'cu12', path: 'straight' } },
      { id: 'a', label: 'Duduk in A', patch: { lowestNote: 'G#3', pipe: 'cu15', path: 'straight' } },
      { id: 'bass', label: 'Bass duduk', patch: { lowestNote: 'E3', pipe: 'cu15', path: 'straight' } },
    ],
  },
  {
    id: 'custom',
    label: 'Custom',
    notes: 'Set the range, bore and mouthpiece yourself.',
    base: {},
    variants: [{ id: 'custom', label: 'Custom', patch: {} }],
  },
];

export function findFamily(id: string): Family {
  return FAMILIES.find((f) => f.id === id) ?? FAMILIES[0];
}

/** Return a copy of `d` with the preset's values applied. Custom keeps everything. */
export function applyPreset<T extends Design>(d: T, familyId: string, variantId: string): T {
  const fam = findFamily(familyId);
  const v = fam.variants.find((x) => x.id === variantId) ?? fam.variants[0];
  const reset: Partial<Design> = { bellFold: false, windcap: false, path: 'straight' };
  return { ...d, ...reset, ...fam.base, ...v.patch, family: fam.id, variant: v.id } as T;
}
