// Flat bodies: an outline extruded to a slab, with its front and back edges
// chamfered at 45° so the body sits comfortably in the hands.

import type { CrossSection, Manifold } from 'manifold-3d';
import type { ManifoldToplevel } from './manifold';

/** Overlap between the pieces: solids that only touch stay separate. */
const OVERLAP = 0.02;
/** Step height for the fallback stepped chamfer. */
const STEP = 0.3;

type Keep = <T extends { delete(): void }>(m: T) => T;

/**
 * Extrude `outline` from z = -half to +half, chamfering the edges of both
 * faces by `chamfer`.
 *
 * The chamfer is a straight 45° bevel: a thin band on each face whose outer
 * ring is moved inwards along each corner's bisector. If the outline has a
 * feature too tight for that (the moved ring would cross itself), it falls
 * back to fine steps, each inset by the chamfer's depth at its mid-height.
 */
export function chamferedExtrude(M: ManifoldToplevel, keep: Keep, outline: CrossSection, half: number, chamfer: number): Manifold {
  const { Manifold } = M;
  const c = Math.max(0, Math.min(chamfer, half * 0.9));
  if (c < 0.05) return keep(keep(Manifold.extrude(outline, 2 * half)).translate([0, 0, -half]));
  const core = keep(keep(Manifold.extrude(outline, 2 * (half - c))).translate([0, 0, -(half - c)]));
  const bands = bevelBands(M, keep, outline, half, c) ?? steppedBands(M, keep, outline, half, c);
  return keep(Manifold.union([core, ...bands]));
}

/** The two bevelled bands, or null if the outline is too tight to bevel. */
function bevelBands(M: ManifoldToplevel, keep: Keep, outline: CrossSection, half: number, c: number): Manifold[] | null {
  const { Manifold, CrossSection: CS } = M;
  // Inward offset vector at each vertex: material lies to the left of every
  // contour, so the inward normal of an edge is its left normal.
  const shift = new Map<string, [number, number]>();
  const key = (x: number, y: number) => `${x.toFixed(4)},${y.toFixed(4)}`;
  const moved: [number, number][][] = [];
  for (const poly of outline.toPolygons()) {
    const pts = poly as [number, number][];
    const out: [number, number][] = [];
    for (let i = 0; i < pts.length; i++) {
      const p0 = pts[(i - 1 + pts.length) % pts.length];
      const p1 = pts[i];
      const p2 = pts[(i + 1) % pts.length];
      const n1 = leftNormal(p0, p1);
      const n2 = leftNormal(p1, p2);
      let mx = n1[0] + n2[0];
      let my = n1[1] + n2[1];
      const ml = Math.hypot(mx, my);
      if (ml < 1e-9) return null; // a hairpin: no sensible bevel
      mx /= ml;
      my /= ml;
      // Scale so the edges move by exactly c.
      const cos = mx * n1[0] + my * n1[1];
      if (cos < 0.25) return null; // very sharp corner
      const v: [number, number] = [(mx / cos) * c, (my / cos) * c];
      shift.set(key(p1[0], p1[1]), v);
      out.push([p1[0] + v[0], p1[1] + v[1]]);
    }
    moved.push(out);
  }
  // The moved ring must match a true inward offset; if a tight feature made
  // it fold over itself, the areas differ. A fold can be tiny next to the
  // whole outline, so the tolerance is absolute.
  const want = keep(outline.offset(-c, 'Miter', 4)).area();
  const got = keep(new CS(moved, 'Positive')).area();
  if (want <= 0 || Math.abs(got - want) > 0.5 + want * 1e-5) return null;

  const band = keep(Manifold.extrude(outline, c + OVERLAP));
  // Band from z = 0 (the core's face, less the overlap) up to c: move the
  // top ring inwards.
  let missing = false;
  const top = keep(
    band.warp((v) => {
      if (v[2] < c + OVERLAP - 1e-6) return;
      const s = shift.get(key(v[0], v[1]));
      if (!s) {
        missing = true;
        return;
      }
      v[0] += s[0];
      v[1] += s[1];
    }),
  );
  if (missing || top.status() !== 'NoError') return null;
  const z0 = half - c - OVERLAP;
  return [keep(top.translate([0, 0, z0])), keep(keep(top.mirror([0, 0, 1])).translate([0, 0, -z0]))];
}

function leftNormal(a: [number, number], b: [number, number]): [number, number] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  return [-dy / l, dx / l];
}

/** Fallback: fine steps, each inset by the chamfer's depth at its mid-height. */
function steppedBands(M: ManifoldToplevel, keep: Keep, outline: CrossSection, half: number, c: number): Manifold[] {
  const { Manifold } = M;
  const steps = Math.max(2, Math.ceil(c / STEP));
  const dz = c / steps;
  const out: Manifold[] = [];
  for (let k = 1; k <= steps; k++) {
    const inset = keep(outline.offset(-(k - 0.5) * dz, 'Round', 2, 32));
    if (inset.isEmpty()) break;
    const layer = keep(Manifold.extrude(inset, dz + OVERLAP));
    const z0 = half - c + (k - 1) * dz;
    out.push(keep(layer.translate([0, 0, z0 - OVERLAP])), keep(layer.translate([0, 0, -z0 - dz])));
  }
  return out;
}
