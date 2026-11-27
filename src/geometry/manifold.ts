import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';

let loading: Promise<ManifoldToplevel> | null = null;

/** Load the manifold WASM once. Pass the .wasm URL in the browser. */
export function loadManifold(wasmUrl?: string): Promise<ManifoldToplevel> {
  if (!loading) {
    loading = Module(wasmUrl ? { locateFile: () => wasmUrl } : undefined).then((m) => {
      m.setup();
      return m;
    });
  }
  return loading;
}

export type { ManifoldToplevel };
