// The parameter panel, described as data.

import type { Design } from '../model/design';
import { FAMILIES, findFamily } from '../model/presets';
import { SCALES } from '../model/notes';
import { PIPES } from '../model/pipes';
import { REEDS } from '../model/derive';

type Key = keyof Design;

export interface Option {
  value: string;
  label: string;
  group?: string;
}

export interface Field {
  key: Key;
  label: string;
  type: 'number' | 'select' | 'checkbox' | 'text';
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  options?: Option[] | ((d: Design) => Option[]);
  help?: string;
  show?: (d: Design) => boolean;
  advanced?: boolean;
}

export interface Group {
  id: string;
  title: string;
  fields: Field[];
  open?: boolean;
}

const opt = (pairs: [string, string][]): Option[] => pairs.map(([value, label]) => ({ value, label }));

export const GROUPS: Group[] = [
  {
    id: 'instrument',
    title: 'Instrument',
    open: true,
    fields: [
      { key: 'family', label: 'Family', type: 'select', options: FAMILIES.map((f) => ({ value: f.id, label: f.label })) },
      {
        key: 'variant',
        label: 'Size',
        type: 'select',
        options: (d) => findFamily(d.family).variants.map((v) => ({ value: v.id, label: v.label })),
        show: (d) => d.family !== 'custom',
        help: 'Treble to bass versions of the same instrument.',
      },
      { key: 'a4', label: 'Pitch standard A4', type: 'number', unit: 'Hz', step: 1, min: 380, max: 500 },
      { key: 'temperatureC', label: 'Air temperature in the bore', type: 'number', unit: '°C', step: 1, min: 0, max: 40, help: 'Breath warms the bore; 25–30 °C is typical while playing.', advanced: true },
    ],
  },
  {
    id: 'range',
    title: 'Range',
    open: true,
    fields: [
      { key: 'rangeMode', label: 'Choose notes by', type: 'select', options: opt([['scale', 'Scale from a lowest note'], ['list', 'List of notes']]) },
      { key: 'lowestNote', label: 'Lowest note', type: 'text', help: 'e.g. C4, F#3, Bb2. All holes closed.', show: (d) => d.rangeMode === 'scale' },
      { key: 'scale', label: 'Scale', type: 'select', options: SCALES.filter((s) => s.id !== 'custom').map((s) => ({ value: s.id, label: s.label })), show: (d) => d.rangeMode === 'scale' },
      { key: 'noteCount', label: 'Notes in the first register', type: 'number', step: 1, min: 2, max: 14, help: 'Each note above the lowest needs one hole.', show: (d) => d.rangeMode === 'scale' },
      { key: 'noteList', label: 'Notes', type: 'text', help: 'Lowest first, separated by spaces.', show: (d) => d.rangeMode === 'list' },
    ],
  },
  {
    id: 'bore',
    title: 'Bore',
    fields: [
      { key: 'boreType', label: 'Bore shape', type: 'select', options: opt([['cylindrical', 'Cylindrical (clarinet-like)'], ['conical', 'Conical taper (oboe-like)']]) },
      { key: 'matchPipeBore', label: 'Match the pipe’s inside diameter', type: 'checkbox', show: (d) => d.boreType === 'cylindrical' },
      { key: 'boreDiameter', label: 'Bore diameter at the top', type: 'number', unit: 'mm', step: 0.1, min: 2, max: 60, show: (d) => d.boreType === 'conical' || !d.matchPipeBore },
      { key: 'boreEndDiameter', label: 'Bore diameter at the bottom', type: 'number', unit: 'mm', step: 0.1, min: 2, max: 120, show: (d) => d.boreType === 'conical' },
      { key: 'bell', label: 'Flared bell', type: 'checkbox' },
      { key: 'bellLength', label: 'Bell length', type: 'number', unit: 'mm', step: 1, min: 5, max: 300, show: (d) => d.bell },
      { key: 'bellDiameter', label: 'Bell mouth diameter', type: 'number', unit: 'mm', step: 1, min: 5, max: 200, show: (d) => d.bell },
    ],
  },
  {
    id: 'exciter',
    title: 'Mouthpiece',
    fields: [
      { key: 'exciter', label: 'Sound source', type: 'select', options: opt([['single-reed', 'Single reed'], ['double-reed', 'Double reed'], ['membrane', 'Latex membrane (glove)']]) },
      { key: 'singleReedMode', label: 'Single reed mouthpiece', type: 'select', options: opt([['printed', 'Print a mouthpiece'], ['adapter', 'Adapter for a shop mouthpiece']]), show: (d) => d.exciter === 'single-reed' },
      { key: 'reedSize', label: 'Reed', type: 'select', options: Object.entries(REEDS).map(([value, r]) => ({ value, label: r.label })), show: (d) => d.exciter === 'single-reed' && d.singleReedMode === 'printed' },
      { key: 'tipOpening', label: 'Tip opening', type: 'number', unit: 'mm', step: 0.05, min: 0.5, max: 3.5, show: (d) => d.exciter === 'single-reed' && d.singleReedMode === 'printed', advanced: true },
      { key: 'facingLength', label: 'Facing length', type: 'number', unit: 'mm', step: 0.5, min: 8, max: 35, show: (d) => d.exciter === 'single-reed' && d.singleReedMode === 'printed', advanced: true },
      { key: 'adapterShankDiameter', label: 'Mouthpiece shank diameter', type: 'number', unit: 'mm', step: 0.1, min: 8, max: 40, help: 'Measure the corked tenon.', show: (d) => d.exciter === 'single-reed' && d.singleReedMode === 'adapter' },
      { key: 'adapterShankDepth', label: 'Shank depth', type: 'number', unit: 'mm', step: 0.5, min: 5, max: 40, show: (d) => d.exciter === 'single-reed' && d.singleReedMode === 'adapter' },
      { key: 'adapterEquivLength', label: 'Mouthpiece equivalent length', type: 'number', unit: 'mm', step: 1, min: 0, max: 150, help: 'Bore length the mouthpiece behaves like. About 50 mm for a B♭ clarinet mouthpiece.', show: (d) => d.exciter === 'single-reed' && d.singleReedMode === 'adapter' },
      { key: 'doubleReedSeat', label: 'Reed', type: 'select', options: opt([['straw', 'Drinking straw'], ['oboe', 'Oboe reed (staple)'], ['bassoon', 'Bassoon reed (printed bocal tip)'], ['custom', 'Custom tube']]), show: (d) => d.exciter === 'double-reed' },
      { key: 'strawDiameter', label: 'Straw outside diameter', type: 'number', unit: 'mm', step: 0.1, min: 3, max: 12, show: (d) => d.exciter === 'double-reed' && d.doubleReedSeat === 'straw' },
      { key: 'seatDiameter', label: 'Reed tube outside diameter', type: 'number', unit: 'mm', step: 0.1, min: 3, max: 15, show: (d) => d.exciter === 'double-reed' && d.doubleReedSeat === 'custom' },
      { key: 'reedLength', label: 'Reed length', type: 'number', unit: 'mm', step: 1, min: 10, max: 120, show: (d) => d.exciter === 'double-reed' },
      { key: 'windcap', label: 'Wind cap (crumhorn style)', type: 'checkbox', help: 'The player blows into a cap and never touches the reed. Easier, but no overblowing.', show: (d) => d.exciter === 'double-reed' },
      { key: 'membraneDiameter', label: 'Membrane diameter', type: 'number', unit: 'mm', step: 1, min: 15, max: 80, show: (d) => d.exciter === 'membrane' },
      { key: 'membraneNozzle', label: 'Nozzle', type: 'select', options: opt([['printed', 'Printed nozzle'], ['pipe', 'The pipe end (slides to adjust)']]), show: (d) => d.exciter === 'membrane' },
      { key: 'nozzleProtrusion', label: 'Nozzle above the rim', type: 'number', unit: 'mm', step: 0.1, min: -2, max: 5, help: 'How far the nozzle pushes into the latex.', show: (d) => d.exciter === 'membrane' && d.membraneNozzle === 'printed' },
      { key: 'exciterCorrection', label: 'Mouthpiece correction', type: 'number', unit: 'mm', step: 0.5, min: -40, max: 80, help: 'Extra bore length the reed adds. Raise it if a test print plays sharp, lower it if flat.', advanced: true },
    ],
  },
  {
    id: 'inlet',
    title: 'Inlet pipe',
    fields: [
      { key: 'pipe', label: 'Pipe size', type: 'select', options: PIPES.map((p) => ({ value: p.id, label: p.label, group: p.group })), help: 'The body inlet and mouthpiece outlet are made to fit this pipe.' },
      { key: 'pipeOd', label: 'Pipe outside diameter', type: 'number', unit: 'mm', step: 0.05, min: 3, max: 120, show: (d) => d.pipe === 'custom' },
      { key: 'pipeId', label: 'Pipe inside diameter', type: 'number', unit: 'mm', step: 0.05, min: 1, max: 115, show: (d) => d.pipe === 'custom' },
      { key: 'pipeLengthMode', label: 'Use a length of pipe', type: 'select', options: opt([['none', 'No – mouthpiece plugs into the body'], ['fixed', 'Yes – length I choose'], ['auto', 'Yes – pipe replaces the plain upper bore (saves printing)']]) },
      { key: 'pipeLength', label: 'Pipe length', type: 'number', unit: 'mm', step: 1, min: 20, max: 3000, help: 'Total bore length of the pipe run, including any U-bends.', show: (d) => d.pipeLengthMode === 'fixed' },
      {
        key: 'pipeBends',
        label: 'Printed U-bends in the pipe',
        type: 'number',
        step: 1,
        min: 0,
        max: 12,
        help: 'Folds a long pipe into shorter straight pieces joined by printed U-bends. The cut length of each piece is worked out for you.',
        show: (d) => d.pipeLengthMode !== 'none',
      },
      { key: 'bodyFit', label: 'Body fitting', type: 'select', options: opt([['socket', 'Socket (pipe goes inside)'], ['spigot', 'Spigot (pipe goes over)']]), show: (d) => d.pipeLengthMode !== 'none' },
      { key: 'clearance', label: 'Fit clearance', type: 'number', unit: 'mm', step: 0.05, min: 0, max: 1.5, help: 'Added to the diameter. Print the fit test to check.' },
      { key: 'socketDepth', label: 'Socket depth', type: 'number', unit: 'mm', step: 1, min: 6, max: 40, advanced: true },
    ],
  },
  {
    id: 'holes',
    title: 'Tone holes',
    fields: [
      { key: 'thumbHole', label: 'Top hole is a thumb hole (back)', type: 'checkbox' },
      { key: 'holeRatio', label: 'Hole size / bore size', type: 'number', step: 0.05, min: 0.2, max: 0.95, help: 'Bigger holes give a clearer, louder note and sit lower on the tube.' },
      { key: 'holeMin', label: 'Smallest hole', type: 'number', unit: 'mm', step: 0.5, min: 1, max: 15 },
      { key: 'holeMax', label: 'Largest hole', type: 'number', unit: 'mm', step: 0.5, min: 2, max: 20, help: 'A fingertip seals about 10 mm.' },
      { key: 'snapDrill', label: 'Round to drill sizes (0.5 mm)', type: 'checkbox' },
      { key: 'pilotUndersize', label: 'Print holes undersize by', type: 'number', unit: 'mm', step: 0.1, min: 0, max: 5, help: 'Drill out to size afterwards for accurate tuning.' },
      { key: 'holeChamfer', label: 'Finger chamfer', type: 'number', unit: 'mm', step: 0.1, min: 0, max: 3, advanced: true },
      { key: 'holeOverrides', label: 'Hole diameter overrides', type: 'text', help: 'e.g. "3:6.5, 7:5" sets hole 3 to 6.5 mm. Hole 1 is nearest the mouthpiece.', advanced: true },
    ],
  },
  {
    id: 'path',
    title: 'Air path',
    fields: [
      { key: 'path', label: 'Air path', type: 'select', options: opt([['straight', 'Straight tube'], ['folded', 'Folded with U-bends']]) },
      { key: 'meander', label: 'Loops between holes for finger spacing', type: 'checkbox', show: (d) => d.path === 'folded' },
      { key: 'fingerSpacing', label: 'Finger hole spacing', type: 'number', unit: 'mm', step: 0.5, min: 12, max: 45, show: (d) => d.path === 'folded' && d.meander },
      { key: 'handGap', label: 'Extra gap between hands', type: 'number', unit: 'mm', step: 0.5, min: 0, max: 40, show: (d) => d.path === 'folded' && d.meander },
      { key: 'thumbSpacing', label: 'Thumb hole to first finger', type: 'number', unit: 'mm', step: 0.5, min: 5, max: 40, show: (d) => d.path === 'folded' && d.meander && d.thumbHole },
      {
        key: 'loopDirection',
        label: 'Loops go',
        type: 'select',
        options: opt([['side', 'To the side'], ['back', 'Behind the finger holes']]),
        help: 'Behind keeps the body narrow so fingers can wrap round to the holes. The thumb hole moves to the side.',
        show: (d) => d.path === 'folded',
      },
      {
        key: 'meanderSide',
        label: 'Loops on the',
        type: 'select',
        options: opt([['right', 'Right'], ['left', 'Left']]),
        help: 'With alternating loops, the side of the first loop.',
        show: (d) => d.path === 'folded' && d.meander && d.loopDirection !== 'back',
      },
      {
        key: 'holeColumns',
        label: 'Two columns of holes, side by side',
        type: 'checkbox',
        help: 'Left-hand holes run down one column; the bore climbs back to the top and the right-hand holes run down a second column beside them. Needs a long gap between the hands, so suits bass instruments.',
        show: (d) => d.path === 'folded' && d.loopDirection !== 'back',
      },
      {
        key: 'columnGap',
        label: 'Distance between the columns (0 = closest)',
        type: 'number',
        unit: 'mm',
        step: 1,
        min: 0,
        max: 200,
        show: (d) => d.path === 'folded' && d.loopDirection !== 'back' && d.holeColumns,
      },
      {
        key: 'alternateLoops',
        label: 'Alternate sides (balanced)',
        type: 'checkbox',
        help: 'Loops go left and right in turn, so the instrument balances about the finger holes.',
        show: (d) => d.path === 'folded' && d.meander && d.loopDirection !== 'back',
      },
      { key: 'foldUpper', label: 'Fold the upper bore into legs', type: 'checkbox', help: 'Like a dulcian or rackett.', show: (d) => d.path === 'folded' },
      { key: 'legLength', label: 'Leg length (0 = match finger section)', type: 'number', unit: 'mm', step: 5, min: 0, max: 1000, show: (d) => d.path === 'folded' && d.foldUpper },
      { key: 'bellFold', label: 'Turn the bell up (saxophone style)', type: 'checkbox', show: (d) => d.path === 'folded' },
      {
        key: 'midPipe',
        label: 'Join upper and finger blocks with a pipe',
        type: 'checkbox',
        help: 'The hole-free upper bore prints as its own block. A length of the inlet pipe size joins it to the block with the finger holes.',
        show: (d) => d.pipeLengthMode !== 'auto',
      },
      { key: 'midPipeLength', label: 'Joining pipe length', type: 'number', unit: 'mm', step: 1, min: 20, max: 1000, help: 'Cut length, including the ends that sit in the sockets.', show: (d) => d.midPipe && d.pipeLengthMode !== 'auto' },
      { key: 'bendWall', label: 'Wall between bores in bends', type: 'number', unit: 'mm', step: 0.1, min: 0.8, max: 6, advanced: true, show: (d) => d.path === 'folded' },
    ],
  },
  {
    id: 'print',
    title: 'Body and printing',
    fields: [
      { key: 'wall', label: 'Wall thickness', type: 'number', unit: 'mm', step: 0.1, min: 1.2, max: 10 },
      { key: 'bodyStyle', label: 'Body shape', type: 'select', options: opt([['tube', 'Tube following the bore'], ['web', 'Tube with webs between bends'], ['slab', 'Flat slab following the bore'], ['blocks', 'Blocks (square corners)'], ['rounded', 'Blocks (rounded)']]), help: 'Block bodies hide the folded bore inside one rectangle per loop, and sink the inlet socket into the body.' },
      {
        key: 'edgeChamfer',
        label: 'Edge chamfer',
        type: 'number',
        unit: 'mm',
        step: 0.1,
        min: 0,
        max: 10,
        help: 'Bevels the front and back edges of a flat body so it sits comfortably in the hands. At most the wall thickness less 0.5 mm.',
        show: (d) => d.bodyStyle === 'slab' || d.bodyStyle === 'blocks' || d.bodyStyle === 'rounded',
      },
      { key: 'split', label: 'Print as', type: 'select', options: opt([['halves', 'Two halves glued along the bore'], ['none', 'One piece']]) },
      { key: 'boreShape', label: 'Bore cross-section', type: 'select', options: opt([['round', 'Round'], ['teardrop', 'Pointed top (no supports, same area)']]), help: 'A pointed top lets the bore roof print without sagging.' },
      { key: 'dowels', label: 'Alignment dowel holes', type: 'checkbox', show: (d) => d.split === 'halves' },
      { key: 'dowelDiameter', label: 'Dowel diameter', type: 'number', unit: 'mm', step: 0.05, min: 1, max: 5, help: '1.75 mm filament works.', show: (d) => d.split === 'halves' && d.dowels },
      { key: 'dowelDepth', label: 'Dowel depth each side', type: 'number', unit: 'mm', step: 0.5, min: 2, max: 10, show: (d) => d.split === 'halves' && d.dowels, advanced: true },
      { key: 'dowelSpacing', label: 'Dowel spacing', type: 'number', unit: 'mm', step: 5, min: 15, max: 200, show: (d) => d.split === 'halves' && d.dowels, advanced: true },
      { key: 'segment', label: 'Cut to fit the bed', type: 'checkbox' },
      { key: 'bedX', label: 'Bed width', type: 'number', unit: 'mm', step: 1, min: 80, max: 1000 },
      { key: 'bedY', label: 'Bed depth', type: 'number', unit: 'mm', step: 1, min: 80, max: 1000 },
      { key: 'bedZ', label: 'Bed height', type: 'number', unit: 'mm', step: 1, min: 80, max: 1000 },
      { key: 'jointLength', label: 'Joint length (one-piece)', type: 'number', unit: 'mm', step: 1, min: 5, max: 40, show: (d) => d.split === 'none', advanced: true },
      { key: 'fitTest', label: 'Include fit-test pieces', type: 'checkbox' },
      { key: 'resolution', label: 'Mesh resolution', type: 'number', step: 4, min: 16, max: 128, help: 'Segments around each circle.', advanced: true },
    ],
  },
];
