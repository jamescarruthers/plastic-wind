// Standard pipe sizes that the printed parts can be connected with.
// Dimensions are nominal; real pipe varies, so the clearance setting matters.

export interface PipeSize {
  id: string;
  label: string;
  group: string;
  od: number; // outside diameter, mm
  id_: number; // inside diameter, mm
}

export const PIPES: PipeSize[] = [
  { id: 'cu8', label: '8 mm copper (EN 1057)', group: 'Copper (UK/EU)', od: 8, id_: 6.8 },
  { id: 'cu10', label: '10 mm copper (EN 1057)', group: 'Copper (UK/EU)', od: 10, id_: 8.8 },
  { id: 'cu12', label: '12 mm copper (EN 1057)', group: 'Copper (UK/EU)', od: 12, id_: 10.8 },
  { id: 'cu15', label: '15 mm copper (EN 1057)', group: 'Copper (UK/EU)', od: 15, id_: 13.6 },
  { id: 'cu22', label: '22 mm copper (EN 1057)', group: 'Copper (UK/EU)', od: 22, id_: 20.2 },
  { id: 'cu28', label: '28 mm copper (EN 1057)', group: 'Copper (UK/EU)', od: 28, id_: 26.2 },
  { id: 'cuM38', label: '3/8" copper type M', group: 'Copper (US)', od: 12.7, id_: 11.43 },
  { id: 'cuM12', label: '1/2" copper type M', group: 'Copper (US)', od: 15.875, id_: 14.45 },
  { id: 'cuM34', label: '3/4" copper type M', group: 'Copper (US)', od: 22.225, id_: 20.6 },
  { id: 'cuM1', label: '1" copper type M', group: 'Copper (US)', od: 28.575, id_: 26.8 },
  { id: 'ovf215', label: '21.5 mm overflow pipe (UK)', group: 'Plastic', od: 21.5, id_: 18.3 },
  { id: 'waste32', label: '32 mm waste pipe (UK, 36.3 OD)', group: 'Plastic', od: 36.3, id_: 32.4 },
  { id: 'waste40', label: '40 mm waste pipe (UK, 42.8 OD)', group: 'Plastic', od: 42.8, id_: 38.9 },
  { id: 'cond20', label: '20 mm PVC conduit', group: 'Plastic', od: 20, id_: 17.4 },
  { id: 'cond25', label: '25 mm PVC conduit', group: 'Plastic', od: 25, id_: 22.2 },
  { id: 'pvc12', label: '1/2" PVC schedule 40', group: 'Plastic', od: 21.34, id_: 15.8 },
  { id: 'pvc34', label: '3/4" PVC schedule 40', group: 'Plastic', od: 26.67, id_: 20.93 },
  { id: 'pvc1', label: '1" PVC schedule 40', group: 'Plastic', od: 33.4, id_: 26.64 },
  { id: 'custom', label: 'Custom size…', group: 'Other', od: 15, id_: 13 },
];

export function getPipe(id: string, customOd: number, customId: number): PipeSize {
  const p = PIPES.find((x) => x.id === id) ?? PIPES[3];
  if (p.id === 'custom') return { ...p, od: customOd, id_: customId };
  return p;
}
