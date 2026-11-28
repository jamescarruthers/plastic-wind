// Turns the user's Design into the numbers the solver and geometry need.

import { isFlatStyle, loopsBehind, type Design } from './design';
import { getPipe, type PipeSize } from './pipes';
import { midiToFreq, noteToMidi, parseNoteList, scaleNotes } from './notes';
import type { BodyProfile, HeadSegment, SolveSpec } from '../acoustics/solver';

export interface ReedDims {
  width: number;
  length: number;
  windowW: number;
  windowL: number;
  tip: number;
  facing: number;
}

export const REEDS: Record<string, ReedDims & { label: string }> = {
  'clarinet-eb': { label: 'E♭ clarinet reed', width: 11.5, length: 60, windowW: 9.5, windowL: 22, tip: 1.0, facing: 16 },
  'clarinet-bb': { label: 'B♭ clarinet reed', width: 13, length: 68, windowW: 11, windowL: 25, tip: 1.1, facing: 18 },
  'sax-alto': { label: 'Alto sax / alto clarinet reed', width: 16, length: 73, windowW: 13.5, windowL: 30, tip: 1.8, facing: 22 },
  'sax-tenor': { label: 'Tenor sax / bass clarinet reed', width: 18.5, length: 80, windowW: 15.5, windowL: 34, tip: 2.3, facing: 25 },
};

export const DOUBLE_REED_DEFAULT_LENGTH: Record<string, number> = { straw: 25, oboe: 72, bassoon: 55, custom: 40 };

export interface MouthpieceSpec {
  kind: Design['exciter'];
  outlet: 'spigot' | 'socket';
  outletBoreR: number;
  outletOuterR: number; // spigot outer radius, or socket inner radius
  outletDepth: number;
  // single reed
  reed?: ReedDims;
  bodyLength?: number; // single-reed mouthpiece body length (tip to shoulder)
  // double reed
  seat?: { kind: Design['doubleReedSeat']; topR: number; bottomR: number; depth: number; bocal?: { r0: number; r1: number; L: number } };
  windcap?: { innerR: number; length: number };
  // membrane
  membrane?: { innerR: number; chamberDepth: number; base: number; nozzleR: number; nozzleWall: number; protrusion: number; pipeThrough: boolean };
}

export type BoreSection = 'round' | 'lemon' | 'drop';

export interface Resolved {
  d: Design;
  /** Bore cross-section: round, pointed top and bottom (halves), or pointed top only. */
  section: BoreSection;
  /** Half thickness of a flat body (slab or blocks). */
  slabHalf: number;
  pipe: PipeSize;
  usePipe: boolean;
  midi: number[];
  targets: number[];
  fingers: string[]; // top hole first
  body: BodyProfile;
  maxBoreR: number;
  socket: { kind: 'socket' | 'spigot'; r: number; depth: number };
  /** Pipe joining the upper block to the finger block, if wanted. */
  joint: { length: number } | null;
  /** Size of a printed U-bend for the inlet pipe (when a pipe is used). */
  pipeBend: { R: number; stub: number; uLen: number; sockR: number; wall: number; minPiece: number } | null;
  /** How the inlet pipe is cut up: set after solving. */
  pipeRun: { bends: number; pieces: number; pieceLength: number } | null;
  mouthpiece: MouthpieceSpec;
  spec: SolveSpec;
  outerR: (r: number) => number;
  warnings: string[];
}

const FINGERS_THUMB = ['LT', 'L1', 'L2', 'L3', 'R1', 'R2', 'R3', 'R4', 'RT'];
const FINGERS = ['L1', 'L2', 'L3', 'R1', 'R2', 'R3', 'R4', 'LT', 'RT'];

export const FINGER_NAMES: Record<string, string> = {
  LT: 'Left thumb (back)',
  L1: 'Left index',
  L2: 'Left middle',
  L3: 'Left ring',
  R1: 'Right index',
  R2: 'Right middle',
  R3: 'Right ring',
  R4: 'Right little',
  RT: 'Right thumb (back)',
  X: 'Extra',
};

export function fingerFor(index: number, count: number, thumb: boolean): string {
  const list = thumb && count >= 2 ? FINGERS_THUMB : FINGERS;
  return list[index] ?? 'X';
}

export function isBackHole(finger: string) {
  return finger === 'LT' || finger === 'RT';
}

function parseOverrides(text: string): Map<number, number> {
  const m = new Map<number, number>();
  for (const part of text.split(/[,;\s]+/)) {
    const x = /^(\d+)\s*[:=]\s*([\d.]+)$/.exec(part.trim());
    if (x) m.set(parseInt(x[1], 10), parseFloat(x[2]));
  }
  return m;
}

export function resolve(d: Design): Resolved {
  const warnings: string[] = [];
  const pipe = getPipe(d.pipe, d.pipeOd, d.pipeId);
  const usePipe = d.pipeLengthMode !== 'none';

  // Notes
  let midi: number[];
  if (d.rangeMode === 'list') midi = parseNoteList(d.noteList);
  else {
    const low = noteToMidi(d.lowestNote);
    midi = Number.isFinite(low) ? scaleNotes(low, d.scale, Math.max(1, Math.round(d.noteCount))) : [];
  }
  if (midi.length === 0) {
    warnings.push('No valid notes. Using C4.');
    midi = [60];
  }
  const targets = midi.map((m) => midiToFreq(m, d.a4));
  const nHoles = midi.length - 1;
  const fingers = Array.from({ length: nHoles }, (_, i) => fingerFor(i, nHoles, d.thumbHole));
  if (nHoles > 9) warnings.push(`${nHoles} holes is more than ten fingers can cover in a row; some notes need two fingers or half-holing.`);

  // Body bore
  const r0 =
    d.boreType === 'cylindrical' && d.matchPipeBore ? pipe.id_ / 2 : Math.max(1, d.boreDiameter / 2);
  const r1 = d.boreType === 'conical' ? Math.max(r0, d.boreEndDiameter / 2) : r0;
  const body: BodyProfile = {
    type: d.boreType,
    r0,
    r1,
    bellLength: d.bell ? Math.max(0, d.bellLength) : 0,
    bellRadius: d.bell ? Math.max(r1, d.bellDiameter / 2) : r1,
  };
  const maxBoreR = Math.max(r0, r1, body.bellRadius);

  // Inlet socket on the body
  const socket =
    d.bodyFit === 'spigot' && usePipe
      ? { kind: 'spigot' as const, r: (pipe.id_ - d.clearance) / 2, depth: d.socketDepth }
      : { kind: 'socket' as const, r: (pipe.od + d.clearance) / 2, depth: d.socketDepth };
  if (socket.kind === 'spigot' && socket.r - r0 < 1.0) {
    warnings.push('The spigot wall is under 1 mm. Use a socket fit or a narrower bore.');
  }

  // Mouthpiece and the bore inside it
  const outlet: 'spigot' | 'socket' = usePipe ? 'socket' : 'spigot';
  const sd = d.socketDepth;
  const outletOuterR = outlet === 'spigot' ? pipe.od / 2 - 0.05 : (pipe.od + d.clearance) / 2;
  const boreAtJoin = usePipe ? pipe.id_ / 2 : r0;
  const outletBoreR = outlet === 'spigot' ? Math.min(boreAtJoin, outletOuterR - 1.2) : Math.min(boreAtJoin, outletOuterR - 0.01);
  const spigotLen = outlet === 'spigot' ? sd - 0.5 : 0;
  const head: HeadSegment[] = [];
  let baseCorrection = 0;
  const mp: MouthpieceSpec = { kind: d.exciter, outlet, outletBoreR, outletOuterR, outletDepth: outlet === 'spigot' ? sd - 0.5 : sd };

  if (d.exciter === 'single-reed') {
    if (d.singleReedMode === 'printed') {
      const base = REEDS[d.reedSize] ?? REEDS['clarinet-bb'];
      const reed = { ...base, tip: d.tipOpening || base.tip, facing: d.facingLength || base.facing };
      mp.reed = reed;
      mp.bodyLength = reed.length + 2;
      const internal = mp.bodyLength - 8 + spigotLen;
      head.push({ L: internal, r0: outletBoreR, r1: outletBoreR, label: 'Mouthpiece' });
      baseCorrection = 8;
    } else {
      head.push({ L: d.adapterEquivLength, r0: outletBoreR, r1: outletBoreR, label: 'Your mouthpiece (equivalent)' });
      head.push({ L: 10 + spigotLen, r0: outletBoreR, r1: outletBoreR, label: 'Adapter' });
      baseCorrection = 0;
    }
  } else if (d.exciter === 'double-reed') {
    const L = d.reedLength || DOUBLE_REED_DEFAULT_LENGTH[d.doubleReedSeat];
    let reedOutR: number;
    if (d.doubleReedSeat === 'straw' || d.doubleReedSeat === 'custom') {
      const od = d.doubleReedSeat === 'straw' ? d.strawDiameter : d.seatDiameter;
      reedOutR = Math.max(0.8, od / 2 - 0.3);
      head.push({ L, r0: reedOutR, r1: reedOutR, label: 'Reed' });
      mp.seat = { kind: d.doubleReedSeat, topR: od / 2 + 0.05, bottomR: od / 2 + 0.05, depth: 12 };
    } else if (d.doubleReedSeat === 'oboe') {
      reedOutR = 2.35;
      head.push({ L, r0: 1.0, r1: reedOutR, label: 'Reed and staple' });
      mp.seat = { kind: 'oboe', topR: 3.6, bottomR: 3.3, depth: 12 };
    } else {
      // Reed slides 12 mm onto a printed bocal tip with a 2.6 mm bore.
      reedOutR = 1.3;
      head.push({ L: Math.max(10, L - 12), r0: 1.4, r1: 2.2, label: 'Reed' });
      mp.seat = { kind: 'bassoon', topR: 0, bottomR: 0, depth: 0, bocal: { r0: 2.15, r1: 2.6, L: 14 } };
      head.push({ L: 18, r0: reedOutR, r1: reedOutR, label: 'Bocal tip' });
    }
    head.push({ L: 22 + spigotLen, r0: reedOutR, r1: outletBoreR, label: 'Reed seat' });
    if (d.windcap) {
      const reedW = d.doubleReedSeat === 'straw' ? (Math.PI * d.strawDiameter) / 2 : d.doubleReedSeat === 'oboe' ? 8 : d.doubleReedSeat === 'bassoon' ? 15 : (Math.PI * d.seatDiameter) / 2;
      const protrude = d.doubleReedSeat === 'bassoon' ? L - 12 : L - (mp.seat?.depth ?? 12);
      mp.windcap = { innerR: reedW / 2 + 3, length: Math.max(15, protrude + 8) };
    }
    baseCorrection = 3;
  } else {
    const pipeThrough = d.membraneNozzle === 'pipe' && usePipe;
    if (d.membraneNozzle === 'pipe' && !usePipe) warnings.push('A pipe nozzle needs an inlet pipe. Using a printed nozzle.');
    const innerR = Math.max(d.membraneDiameter / 2, (pipeThrough ? pipe.od : outletBoreR * 2 + 3.2) / 2 + 6);
    mp.membrane = {
      innerR,
      chamberDepth: 14,
      base: 4,
      nozzleR: pipeThrough ? pipe.od / 2 : outletBoreR,
      nozzleWall: 1.6,
      protrusion: d.nozzleProtrusion,
      pipeThrough,
    };
    if (!pipeThrough) {
      head.push({ L: 14 + d.nozzleProtrusion + 4 + spigotLen, r0: outletBoreR, r1: outletBoreR, label: 'Nozzle' });
    }
    baseCorrection = 2;
  }

  // Tone holes
  const overrides = parseOverrides(d.holeOverrides);
  const snap = (x: number) => (d.snapDrill ? Math.round(x * 2) / 2 : x);
  const holeDiameter = (i: number, r: number) => {
    const num = nHoles - i; // 1 = top hole
    const o = overrides.get(num);
    if (o) return o;
    let dia = d.holeRatio * 2 * r;
    if (isBackHole(fingers[num - 1] ?? '')) dia *= 0.85;
    dia = Math.min(Math.max(dia, d.holeMin), d.holeMax, 2 * r * 0.95);
    return Math.max(d.holeMin, snap(dia));
  };
  // Printing flat needs a pointed bore roof: both sides for glued halves,
  // the top only for a folded body printed in one piece.
  const split = d.split === 'halves';
  const lyingOnePiece = !split && d.path === 'folded';
  const section: BoreSection = d.boreShape === 'teardrop' ? (split ? 'lemon' : 'drop') : lyingOnePiece ? 'drop' : 'round';
  const pointScale = section === 'round' ? 1 : 1 / Math.sqrt(1 + ((section === 'lemon' ? 2 : 1) * (1 - Math.PI / 4)) / Math.PI);
  let slabHalf = (section === 'round' ? maxBoreR : maxBoreR * pointScale * Math.SQRT2) + d.wall;
  // Block bodies hold the inlet socket inside them.
  if (d.bodyStyle === 'blocks' || d.bodyStyle === 'rounded') slabHalf = Math.max(slabHalf, socket.r + Math.max(2.4, d.wall * 0.8));
  const behind = loopsBehind(d);
  // Wall depth at each hole: the outside radius (round, r·k + wall, where k
  // lets it clear a pointed bore roof) less how far the bore reaches in the
  // drilling direction.
  const k = section === 'round' ? 1 : pointScale * Math.SQRT2;
  const sideReach = section === 'round' ? 1 : pointScale; // bore half-width
  const roofReach = section === 'round' ? 1 : pointScale * Math.SQRT2; // bore to its point
  const chimney = (i: number, r: number) => {
    const thumb = isBackHole(fingers[nHoles - i - 1] ?? '');
    if (behind && !thumb) {
      // Drilled through the front edge, in the plane of the bore. Block
      // bodies square off the finger section at its widest.
      const outside = d.bodyStyle === 'blocks' || d.bodyStyle === 'rounded' ? Math.max(r0, r1) * k + d.wall : isFlatStyle(d.bodyStyle) ? r + d.wall : r * k + d.wall;
      return outside - r * sideReach;
    }
    if (isFlatStyle(d.bodyStyle)) return slabHalf - r * (section === 'round' ? 1 : roofReach);
    // Out of the plane: towards +z (front holes, or the side thumb hole when
    // the loops go behind) or -z (a back thumb hole).
    const up = !thumb || behind;
    const intoRoof = section === 'lemon' || (section === 'drop' && up);
    return r * k + d.wall - r * (intoRoof ? roofReach : sideReach);
  };


  // Printed U-bends joining pieces of the inlet pipe. Two sockets side by
  // side set the bend radius; the bore inside is the pipe's own bore.
  let pipeBend: Resolved['pipeBend'] = null;
  if (usePipe) {
    const sockR = (pipe.od + d.clearance) / 2;
    const wallU = Math.max(2.4, d.wall * 0.8);
    // Housings overlap a little rather than just touching; the wall
    // between the two sockets is still one and a half walls thick.
    const R = sockR + wallU * 0.75;
    const stub = 3;
    pipeBend = { R, stub, uLen: Math.PI * R + 2 * stub, sockR, wall: wallU, minPiece: 2 * sd + 10 };
  }
  // The pipe's length is set by the tuning; bends that do not fit are
  // dropped afterwards (see cutPipe), never the other way round.
  const pipeMinL = 2 * sd + 20;

  const topHoleR = nHoles ? d.holeMax / 2 : 0;
  const spec: SolveSpec = {
    targets,
    tempC: d.temperatureC,
    head,
    pipe: { mode: d.pipeLengthMode, L: d.pipeLength, r: pipe.id_ / 2, minL: pipeMinL },
    body,
    inputCorrection: baseCorrection + d.exciterCorrection,
    topMargin: topHoleR + d.wall + 10,
    minBody: Math.max(40, body.bellLength + 20),
    holeDiameter,
    holeMinDiameter: d.holeMin,
    snapDown: d.snapDrill ? (x: number) => Math.floor(x * 2 + 1e-6) / 2 : undefined,
    chimney,
  };

  // Pipe joint between the upper and finger blocks.
  let joint: Resolved['joint'] = null;
  if (d.midPipe) {
    if (d.pipeLengthMode === 'auto') warnings.push('The block-joining pipe is off while the inlet pipe length is calculated: the inlet pipe already replaces the upper bore.');
    else if (nHoles === 0) warnings.push('The block-joining pipe needs at least one tone hole to place it above.');
    else {
      const minLen = 2 * d.socketDepth + 10;
      if (d.midPipeLength < minLen) warnings.push(`The joining pipe must be at least ${minLen} mm (two sockets plus a gap); using ${minLen} mm.`);
      joint = { length: Math.max(d.midPipeLength, minLen) };
    }
  }

  return {
    d,
    joint,
    pipeBend,
    pipeRun: null,
    section,
    slabHalf,
    pipe,
    usePipe,
    midi,
    targets,
    fingers,
    body,
    maxBoreR,
    socket,
    mouthpiece: mp,
    spec,
    outerR: (r: number) => r + d.wall,
    warnings,
  };
}

/** Split a pipe of total bore length `total` into pieces joined by U-bends. */
export function cutPipe(res: Resolved, total: number): { run: NonNullable<Resolved['pipeRun']>; reduced: boolean } {
  const b = res.pipeBend!;
  const wanted = Math.max(0, Math.round(res.d.pipeBends));
  let n = wanted;
  while (n > 0 && (total - n * b.uLen) / (n + 1) < b.minPiece) n--;
  return { run: { bends: n, pieces: n + 1, pieceLength: (total - n * b.uLen) / (n + 1) }, reduced: n < wanted };
}
