// Note names, frequencies and scales.

const NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** MIDI number from a name such as "C4", "F#3", "Bb2". Returns NaN on failure. */
export function noteToMidi(name: string): number {
  const m = /^\s*([A-Ga-g])([#b♯♭]*)(-?\d+)\s*$/.exec(name);
  if (!m) return NaN;
  let pc = LETTER[m[1].toUpperCase()];
  for (const ch of m[2]) pc += ch === '#' || ch === '♯' ? 1 : -1;
  return (parseInt(m[3], 10) + 1) * 12 + pc;
}

export function midiToName(midi: number): string {
  const r = Math.round(midi);
  return NAMES_SHARP[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1);
}

export function midiToFreq(midi: number, a4 = 440): number {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

export function freqToMidi(f: number, a4 = 440): number {
  return 69 + 12 * Math.log2(f / a4);
}

export function cents(f: number, ref: number): number {
  return 1200 * Math.log2(f / ref);
}

/** Name of the nearest note plus the deviation in cents, e.g. "A4 +3". */
export function describeFreq(f: number, a4 = 440): { name: string; cents: number } {
  const m = freqToMidi(f, a4);
  const r = Math.round(m);
  return { name: midiToName(r), cents: (m - r) * 100 };
}

export interface ScaleDef {
  id: string;
  label: string;
  steps: number[]; // semitone offsets within one octave, starting at 0
}

export const SCALES: ScaleDef[] = [
  { id: 'major', label: 'Major (Ionian)', steps: [0, 2, 4, 5, 7, 9, 11] },
  { id: 'mixolydian', label: 'Mixolydian', steps: [0, 2, 4, 5, 7, 9, 10] },
  { id: 'dorian', label: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
  { id: 'minor', label: 'Natural minor (Aeolian)', steps: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'harmonic-minor', label: 'Harmonic minor', steps: [0, 2, 3, 5, 7, 8, 11] },
  { id: 'major-pent', label: 'Major pentatonic', steps: [0, 2, 4, 7, 9] },
  { id: 'minor-pent', label: 'Minor pentatonic', steps: [0, 3, 5, 7, 10] },
  { id: 'chromatic', label: 'Chromatic', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  { id: 'custom', label: 'Custom note list', steps: [] },
];

/** Notes of a scale, starting at `lowest`, `count` notes long. */
export function scaleNotes(lowestMidi: number, scaleId: string, count: number): number[] {
  const scale = SCALES.find((s) => s.id === scaleId) ?? SCALES[0];
  const out: number[] = [];
  for (let i = 0; out.length < count && i < 200; i++) {
    const oct = Math.floor(i / scale.steps.length);
    out.push(lowestMidi + 12 * oct + scale.steps[i % scale.steps.length]);
  }
  return out;
}

/** Scale notes from lowest to highest inclusive. */
export function scaleNotesBetween(lowestMidi: number, highestMidi: number, scaleId: string): number[] {
  const all = scaleNotes(lowestMidi, scaleId, 60);
  return all.filter((m) => m <= highestMidi);
}

/** Parse a comma/space separated list of note names, sorted low to high. */
export function parseNoteList(text: string): number[] {
  const out = text
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map(noteToMidi)
    .filter((m) => Number.isFinite(m));
  return Array.from(new Set(out)).sort((a, b) => a - b);
}
