// Human-readable build information derived from a generated instrument.

import type { Generated } from './pipeline';
import { FINGER_NAMES } from './model/derive';
import { describeFreq, midiToName } from './model/notes';
import { findFamily } from './model/presets';
import { PIPES } from './model/pipes';

export interface NoteRow {
  name: string;
  target: number;
  predicted: number;
  cents: number;
  open: number; // holes open from the bottom
  fingering: boolean[]; // top hole first, true = closed
  second: { name: string; cents: number; f: number } | null;
}

export interface HoleRow {
  number: number;
  finger: string;
  fingerName: string;
  fromInlet: number;
  fromEnd: number;
  diameter: number;
  printed: number;
  chimney: number;
  face: 'front' | 'back' | 'side';
}

export function noteRows(g: Generated): NoteRow[] {
  const n = g.lay.holes.length;
  return g.sol.notes.map((note, i) => {
    // Note i opens the bottom i holes.
    const fingering = Array.from({ length: n }, (_, k) => k < n - i);
    const second = note.second ? describeFreq(note.second, g.res.d.a4) : null;
    return {
      name: midiToName(g.res.midi[i]),
      target: note.target,
      predicted: note.predicted,
      cents: note.cents,
      open: i,
      fingering,
      second: second && note.second ? { name: second.name, cents: second.cents, f: note.second } : null,
    };
  });
}

export function holeRows(g: Generated): HoleRow[] {
  const d = g.res.d;
  return g.lay.holes.map((h) => ({
    number: h.number,
    finger: h.finger,
    fingerName: (FINGER_NAMES[h.finger] ?? h.finger).replace('(back)', h.face === 'side' ? '(side)' : '(back)'),
    fromInlet: h.s,
    fromEnd: g.sol.bodyLength - h.s,
    diameter: h.diameter,
    printed: Math.max(1, h.diameter - d.pilotUndersize),
    chimney: h.chimney,
    face: h.face,
  }));
}

export function instrumentTitle(g: Generated): string {
  const fam = findFamily(g.res.d.family);
  const v = fam.variants.find((x) => x.id === g.res.d.variant);
  const low = midiToName(g.res.midi[0]);
  return fam.id === 'custom' ? `Custom instrument in ${low}` : `${fam.label} – ${v?.label ?? ''}`;
}

export function buildNotesText(g: Generated): string {
  const d = g.res.d;
  const L: string[] = [];
  const f1 = (x: number) => x.toFixed(1);
  L.push(instrumentTitle(g));
  L.push('='.repeat(60));
  L.push(`Range: ${g.res.midi.map(midiToName).join(' ')} (A4 = ${d.a4} Hz, air at ${d.temperatureC} °C)`);
  L.push(`Bore: ${d.boreType}, ${f1(g.res.body.r0 * 2)} mm at the top${d.boreType === 'conical' ? ` to ${f1(g.res.body.r1 * 2)} mm` : ''}${g.res.body.bellLength ? `, bell ${f1(g.res.body.bellRadius * 2)} mm over ${f1(g.res.body.bellLength)} mm` : ''}`);
  L.push(`Body bore length: ${f1(g.sol.bodyLength)} mm (socket bottom to bell end)`);
  const pipeName = PIPES.find((p) => p.id === d.pipe)?.label ?? 'pipe';
  if (g.res.usePipe) L.push(`Inlet pipe: ${pipeName}, cut to ${f1(g.sol.pipeLength)} mm. Deburr both ends inside and out.`);
  else L.push(`No inlet pipe: the mouthpiece plugs straight into the body (${pipeName} size fitting).`);
  if (g.res.joint) L.push(`Joining pipe: ${pipeName}, cut to ${f1(g.res.joint.length)} mm. It joins the upper block to the finger block.`);
  L.push(`Layout: ${d.path}${g.lay.loops ? `, ${g.lay.loops} loop(s) between holes` : ''}${g.lay.legs ? `, ${g.lay.legs} folded legs` : ''}`);
  L.push('');
  L.push('Tone holes (1 = nearest the mouthpiece)');
  L.push('  #  finger              from socket  from bell  diameter  printed  wall');
  for (const h of holeRows(g)) {
    L.push(
      `  ${String(h.number).padStart(2)} ${h.fingerName.padEnd(20)} ${f1(h.fromInlet).padStart(8)} mm ${f1(h.fromEnd).padStart(7)} mm ${f1(h.diameter).padStart(6)} mm ${f1(h.printed).padStart(6)} mm ${f1(h.chimney).padStart(4)} mm`,
    );
  }
  if (d.pilotUndersize > 0) L.push(`  Holes print ${d.pilotUndersize} mm undersize. Drill them out to the listed diameter, a little at a time, checking pitch as you go.`);
  L.push('');
  L.push('Notes (model prediction)');
  for (const r of noteRows(g)) {
    const fing = r.fingering.map((c) => (c ? '●' : '○')).join('');
    L.push(`  ${r.name.padEnd(4)} ${f1(r.target).padStart(7)} Hz  ${fing}  ${r.cents >= 0 ? '+' : ''}${r.cents.toFixed(1)}c   overblown: ${r.second ? `${r.second.name} ${r.second.cents >= 0 ? '+' : ''}${r.second.cents.toFixed(0)}c` : '-'}`);
  }
  L.push('');
  if (g.build) {
    L.push('Parts');
    for (const p of g.build.print) L.push(`  ${p.name} (${p.size.map((x) => x.toFixed(0)).join(' × ')} mm, ~${((p.volume / 1000) * 1.24).toFixed(0)} g PLA)${p.note ? ` – ${p.note}` : ''}`);
    if (g.build.dowels.count) L.push(`  ${g.build.dowels.count} alignment dowels: ${g.build.dowels.diameter} mm filament or rod, cut to ${f1(g.build.dowels.length)} mm.`);
    L.push('');
  }
  L.push('Assembly');
  L.push('  1. Print the fit tests first and adjust "Fit clearance" until the pipe and mouthpiece fit.');
  if (d.split === 'halves') {
    L.push('  2. Dry-fit the halves with the dowels. Glue with a thin, even coat (CA or epoxy); keep glue out of the bore.');
    L.push('     Clamp gently along the whole length. Section joints on the front and back are staggered so they lock together.');
  }
  L.push('  3. Seal the bore if the print is porous: a thin wash of the glue or a wipe of shellac, then pull a cloth through.');
  if (d.exciter === 'membrane') L.push('  4. Cut a flat piece from a latex glove, stretch it evenly over the chamber and clamp it. More tension raises the pitch and makes it speak more easily.');
  if (d.exciter === 'double-reed') L.push('  4. Fit the reed. Soak cane reeds for a few minutes. A drinking-straw reed needs its flattened end cut to a point.');
  if (d.exciter === 'single-reed') L.push('  4. Fit the reed with its tip level with the mouthpiece tip and hold it with a rubber band or ligature.');
  L.push('');
  L.push('Tuning');
  L.push('  The model is a starting point. Reed set-up, print accuracy and the player change the pitch.');
  L.push('  A sharp note: tape over part of its hole, or make the hole smaller. A flat note: enlarge the hole.');
  L.push('  If every note is off by the same amount, change "Mouthpiece correction" and print again.');
  if (g.warnings.length) {
    L.push('');
    L.push('Warnings');
    for (const w of g.warnings) L.push(`  - ${w}`);
  }
  return L.join('\n');
}
