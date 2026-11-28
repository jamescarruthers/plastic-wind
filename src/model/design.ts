// The full set of user-editable design parameters. All lengths are in mm.

export type BoreType = 'cylindrical' | 'conical';
export type Exciter = 'single-reed' | 'double-reed' | 'membrane';
export type SingleReedMode = 'printed' | 'adapter';
export type ReedSize = 'clarinet-eb' | 'clarinet-bb' | 'sax-alto' | 'sax-tenor';
export type DoubleReedSeat = 'straw' | 'oboe' | 'bassoon' | 'custom';
export type PipeLengthMode = 'none' | 'fixed' | 'auto';
export type PathMode = 'straight' | 'folded';
export type BodyStyle = 'tube' | 'web' | 'slab' | 'blocks' | 'rounded';

/** Body shapes with flat front and back faces. */
export function isFlatStyle(s: BodyStyle): boolean {
  return s === 'slab' || s === 'blocks' || s === 'rounded';
}
export type SplitMode = 'none' | 'halves';
export type BoreShape = 'round' | 'teardrop';

export interface Design {
  // Instrument and range
  family: string;
  variant: string;
  a4: number;
  temperatureC: number;
  rangeMode: 'scale' | 'list';
  lowestNote: string;
  scale: string;
  noteCount: number;
  noteList: string;

  // Bore
  boreType: BoreType;
  matchPipeBore: boolean;
  boreDiameter: number;
  boreEndDiameter: number;
  bell: boolean;
  bellLength: number;
  bellDiameter: number;

  // Exciter (mouthpiece)
  exciter: Exciter;
  singleReedMode: SingleReedMode;
  reedSize: ReedSize;
  tipOpening: number;
  facingLength: number;
  adapterShankDiameter: number;
  adapterShankDepth: number;
  adapterEquivLength: number;
  doubleReedSeat: DoubleReedSeat;
  strawDiameter: number;
  reedLength: number;
  seatDiameter: number;
  windcap: boolean;
  membraneDiameter: number;
  membraneNozzle: 'pipe' | 'printed';
  nozzleProtrusion: number;
  exciterCorrection: number;

  // Inlet pipe and fitting
  pipe: string;
  pipeOd: number;
  pipeId: number;
  pipeLengthMode: PipeLengthMode;
  pipeLength: number;
  /** Printed U-bends joining pieces of the inlet pipe. */
  pipeBends: number;
  bodyFit: 'socket' | 'spigot';
  clearance: number;
  socketDepth: number;

  // Tone holes
  holeRatio: number;
  holeMin: number;
  holeMax: number;
  thumbHole: boolean;
  snapDrill: boolean;
  pilotUndersize: number;
  holeChamfer: number;
  holeOverrides: string;

  // Air path layout
  path: PathMode;
  fingerSpacing: number;
  handGap: number;
  thumbSpacing: number;
  meander: boolean;
  /** 'alternate' is kept only so older saved designs still load. */
  meanderSide: 'right' | 'left' | 'alternate';
  alternateLoops: boolean;
  holeColumns: boolean;
  columnGap: number;
  loopDirection: 'side' | 'back';
  bellFold: boolean;
  midPipe: boolean;
  midPipeLength: number;
  foldUpper: boolean;
  legLength: number;
  bendWall: number;

  // Body
  wall: number;
  bodyStyle: BodyStyle;

  // Printing
  split: SplitMode;
  boreShape: BoreShape;
  dowels: boolean;
  dowelDiameter: number;
  dowelDepth: number;
  dowelSpacing: number;
  bedX: number;
  bedY: number;
  bedZ: number;
  segment: boolean;
  jointLength: number;
  resolution: number;
  fitTest: boolean;
}

export const DEFAULT_DESIGN: Design = {
  family: 'chalumeau',
  variant: 'alto',
  a4: 440,
  temperatureC: 28,
  rangeMode: 'scale',
  lowestNote: 'C4',
  scale: 'major',
  noteCount: 9,
  noteList: 'C4 D4 E4 F4 G4 A4 B4 C5 D5',

  boreType: 'cylindrical',
  matchPipeBore: true,
  boreDiameter: 13.6,
  boreEndDiameter: 20,
  bell: true,
  bellLength: 40,
  bellDiameter: 24,

  exciter: 'single-reed',
  singleReedMode: 'printed',
  reedSize: 'clarinet-bb',
  tipOpening: 1.1,
  facingLength: 18,
  adapterShankDiameter: 24.5,
  adapterShankDepth: 22,
  adapterEquivLength: 50,
  doubleReedSeat: 'straw',
  strawDiameter: 6,
  reedLength: 25,
  seatDiameter: 7,
  windcap: false,
  membraneDiameter: 32,
  membraneNozzle: 'printed',
  nozzleProtrusion: 1,
  exciterCorrection: 0,

  pipe: 'cu15',
  pipeOd: 15,
  pipeId: 13.6,
  pipeLengthMode: 'none',
  pipeLength: 100,
  pipeBends: 0,
  bodyFit: 'socket',
  clearance: 0.25,
  socketDepth: 16,

  holeRatio: 0.55,
  holeMin: 3,
  holeMax: 10,
  thumbHole: true,
  snapDrill: true,
  pilotUndersize: 0,
  holeChamfer: 0.6,
  holeOverrides: '',

  path: 'straight',
  fingerSpacing: 24,
  handGap: 8,
  thumbSpacing: 14,
  meander: true,
  meanderSide: 'right',
  alternateLoops: false,
  holeColumns: false,
  columnGap: 0,
  loopDirection: 'side',
  bellFold: false,
  midPipe: false,
  midPipeLength: 80,
  foldUpper: true,
  legLength: 0,
  bendWall: 1.6,

  wall: 3,
  bodyStyle: 'tube',

  split: 'halves',
  boreShape: 'round',
  dowels: true,
  dowelDiameter: 1.75,
  dowelDepth: 5,
  dowelSpacing: 45,
  bedX: 220,
  bedY: 220,
  bedZ: 250,
  segment: true,
  jointLength: 14,
  resolution: 48,
  fitTest: true,
};

/** Folded body whose loops go behind the finger holes rather than to the side. */
export function loopsBehind(d: Pick<Design, 'path' | 'loopDirection'>): boolean {
  return d.path === 'folded' && d.loopDirection === 'back';
}
