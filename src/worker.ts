/// <reference lib="webworker" />
// Runs the solver and the geometry off the main thread.

import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { loadManifold } from './geometry/manifold';
import { generate } from './pipeline';
import type { Design } from './model/design';
import { buildNotesText, holeRows, instrumentTitle, noteRows } from './report';
import { build3mf } from './export/threemf';

export type WorkerRequest = { id: number; type: 'generate'; design: Design; geometry: boolean } | { id: number; type: 'export'; design: Design };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  try {
    const M = msg.type === 'export' || msg.geometry ? await loadManifold(wasmUrl) : null;
    const g = await generate(M, msg.design);
    if (msg.type === 'export') {
      const title = instrumentTitle(g);
      const notes = buildNotesText(g);
      const bytes = build3mf(g.build!.print, title, notes);
      ctx.postMessage({ id: msg.id, type: 'export', bytes, title, notes }, [bytes.buffer]);
      return;
    }
    const transfer: Transferable[] = [];
    const strip = (parts: NonNullable<typeof g.build>['preview']) =>
      parts.map((p) => {
        transfer.push(p.positions.buffer, p.indices.buffer);
        return p;
      });
    const result = {
      title: instrumentTitle(g),
      notes: noteRows(g),
      holes: holeRows(g),
      text: buildNotesText(g),
      warnings: g.warnings,
      timings: g.timings,
      bodyLength: g.sol.bodyLength,
      pipeLength: g.sol.pipeLength,
      pipePieces: g.res.pipeRun?.pieces ?? 1,
      pipePieceLength: g.res.pipeRun?.pieceLength ?? g.sol.pipeLength,
      usePipe: g.res.usePipe,
      jointLength: g.res.joint?.length ?? 0,
      conical: g.res.body.type === 'conical',
      loops: g.lay.loops,
      legs: g.lay.legs,
      boreProfile: Array.from({ length: 121 }, (_, i) => {
        const s = (g.sol.bodyLength * i) / 120;
        return [s, g.lay.radiusAt(s) * 2] as [number, number];
      }),
      preview: g.build ? strip(g.build.preview) : [],
      print: g.build ? strip(g.build.print).map((p) => ({ ...p })) : [],
      dowels: g.build?.dowels ?? null,
      bed: [msg.design.bedX, msg.design.bedY, msg.design.bedZ],
      plates: g.build?.plates ?? [[0, 0]],
    };
    ctx.postMessage({ id: msg.id, type: 'result', result }, transfer);
  } catch (e) {
    ctx.postMessage({ id: msg.id, type: 'error', message: e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e) });
  }
};
