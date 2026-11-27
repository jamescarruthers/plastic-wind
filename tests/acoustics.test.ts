import { describe, it, expect } from 'vitest';
import { airAt, firstResonance, type Network } from '../src/acoustics/tmm';
import { solveInstrument, type SolveSpec } from '../src/acoustics/solver';
import { midiToFreq, noteToMidi, scaleNotes } from '../src/model/notes';

describe('transfer matrix model', () => {
  it('closed-open cylinder resonates near c/4(L + 0.61a)', () => {
    const air = airAt(20);
    const L = 0.3, a = 0.007;
    const net: Network = { air, endRadius: a, elements: [{ kind: 'seg', L, a }], inputRadius: a, inputCorrection: 0 };
    const p = firstResonance(net, 100, 600)!;
    // Wall losses slow the wave by about 1.4% in a 14 mm tube at 285 Hz.
    const expected = air.c / (4 * (L + 0.6133 * a)) / 1.014;
    expect(Math.abs(1200 * Math.log2(p.f / expected))).toBeLessThan(5);
  });
});

function spec(type: 'cylindrical' | 'conical', low: string, count: number): SolveSpec {
  const targets = scaleNotes(noteToMidi(low), 'major', count).map((m) => midiToFreq(m));
  return {
    targets,
    tempC: 25,
    head: [{ L: 30, r0: type === 'conical' ? 1.5 : 6.8, r1: type === 'conical' ? 2.3 : 6.8, label: 'reed' }],
    pipe: { mode: 'none', L: 0, r: 6.8, minL: 0 },
    body: type === 'conical'
      ? { type, r0: 2.3, r1: 8, bellLength: 60, bellRadius: 15 }
      : { type, r0: 6.8, r1: 6.8, bellLength: 30, bellRadius: 11 },
    inputCorrection: 5,
    topMargin: 30,
    minBody: 60,
    holeMinDiameter: 3,
    holeDiameter: (_i, r) => Math.min(9, Math.max(3, r * 2 * 0.55)),
    chimney: () => 3,
  };
}

describe('hole solver', () => {
  it('tunes a cylindrical chalumeau-like tube', () => {
    const t0 = performance.now();
    const r = solveInstrument(spec('cylindrical', 'C4', 9));
    console.log('cyl', (performance.now() - t0).toFixed(0), 'ms', r.bodyLength.toFixed(1), r.holes.map((h) => h.s.toFixed(1)).join(' '), r.notes.map((n) => n.cents.toFixed(2)).join(' '));
    for (const n of r.notes) expect(Math.abs(n.cents)).toBeLessThan(2);
    // Overblows near a twelfth.
    expect(r.notes[0].second! / r.notes[0].predicted).toBeGreaterThan(2.7);
  });
  it('tunes a conical oboe-like tube', () => {
    const t0 = performance.now();
    const r = solveInstrument(spec('conical', 'C4', 7));
    console.log('con', (performance.now() - t0).toFixed(0), 'ms', r.bodyLength.toFixed(1), r.holes.map((h) => h.s.toFixed(1)).join(' '), r.notes.map((n) => n.cents.toFixed(2)).join(' '), r.notes.map((n) => (n.second! / n.predicted).toFixed(2)).join(' '));
    for (const n of r.notes) expect(Math.abs(n.cents)).toBeLessThan(2);
  });
});
