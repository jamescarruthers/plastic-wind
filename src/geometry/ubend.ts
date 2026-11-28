// A printed U-bend that joins two lengths of pipe, side by side.
//
// Local coordinates: the bottom of socket A is at the origin and the bore
// leaves it heading +y; it turns towards +x round a semicircle of radius R
// and comes back down to the bottom of socket B at (2R, 0). Both sockets
// open towards -y, and the U lies in the XY plane, split plane z = 0.
//
// The outside follows the body's shape: a round tube for tube and web
// bodies, a flat block for a slab, a square or rounded block for block
// bodies. The bore uses the body's section, so a fitting printed in halves
// or lying flat needs no support inside.

import type { Manifold } from 'manifold-3d';
import type { ManifoldToplevel } from './manifold';
import type { Resolved } from '../model/derive';
import { boreProfile } from './profile';

export function buildUBend(M: ManifoldToplevel, res: Resolved, keep: <T extends { delete(): void }>(m: T) => T): Manifold {
  const { Manifold, CrossSection } = M;
  const d = res.d;
  const b = res.pipeBend!;
  const n = Math.max(24, Math.round(d.resolution / 4) * 4);
  const R = b.R;
  const stub = b.stub;
  const depth = d.socketDepth;
  // Halves: the body's own section. One piece: lies flat, pointed roof.
  const section = d.split === 'halves' ? res.section : 'drop';
  const bp = boreProfile(section, n);
  const pointed = section !== 'round';
  const rb = (res.pipe.id_ / 2) * bp.scale; // same area as the pipe's bore
  const reach = (r: number) => (pointed ? r * Math.SQRT2 : r); // bore or socket to its point
  const ro = reach(rb) + b.wall; // outside of the bent tube
  const so = reach(b.sockR) + b.wall; // outside of a socket housing

  const rect = (x0: number, y0: number, x1: number, y1: number) => keep(new CrossSection([[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]]));

  // ---- Outside
  let body: Manifold;
  const style = d.bodyStyle;
  if (style === 'tube' || style === 'web') {
    // Round tube bent round the U, with round socket housings. Revolving a
    // disc that crosses the axis keeps only its outer part, so a tube
    // fatter than the bend simply fills the inside of the U.
    const disc = keep(keep(CrossSection.circle(ro, n)).translate([R, 0]));
    const bend = keep(keep(Manifold.revolve(disc, n * 2, 180)).translate([R, stub, 0]));
    const along = (r: number, x: number, y0: number, y1: number) =>
      keep(keep(keep(Manifold.cylinder(y1 - y0, r, r, n)).rotate([-90, 0, 0])).translate([x, y0, 0]));
    const parts = [bend, along(ro, 0, -0.01, stub + 0.01), along(ro, 2 * R, -0.01, stub + 0.01), along(so, 0, -depth, 0), along(so, 2 * R, -depth, 0)];
    if (so > ro) {
      // 45° shoulder from each socket housing down to the tube.
      const cone = (x: number) => keep(keep(keep(Manifold.cylinder(so - ro, so, ro, n)).rotate([-90, 0, 0])).translate([x, 0, 0]));
      parts.push(cone(0), cone(2 * R));
    }
    body = keep(Manifold.union(parts));
  } else {
    // Flat: a slab following the U, or a square or rounded block.
    const half = Math.max(so, ro);
    let outline;
    if (style === 'slab') {
      const ring = keep(keep(keep(CrossSection.circle(R + so, n)).subtract(keep(CrossSection.circle(Math.max(0.01, R - so), n)))).translate([R, stub]));
      const upper = rect(-so - 1, stub, 2 * R + so + 1, stub + R + so + 1);
      outline = keep(CrossSection.union([rect(-so, -depth, so, stub + 0.01), rect(2 * R - so, -depth, 2 * R + so, stub + 0.01), keep(ring.intersect(upper))]));
    } else {
      const box = rect(-so, -depth, 2 * R + so, stub + R + so);
      if (style === 'rounded') {
        const rr = Math.min(14, (0.9 * Math.min(2 * R + 2 * so, depth + stub + R + so)) / 2);
        outline = keep(keep(box.offset(-rr, 'Round', 2, 48)).offset(rr, 'Round', 2, 48));
        // Keep the socket faces square so each mouth has a full wall.
        outline = keep(CrossSection.union([outline, rect(-so, -depth, 2 * R + so, -depth + so)]));
      } else outline = box;
    }
    body = keep(keep(Manifold.extrude(outline, 2 * half)).translate([0, 0, -half]));
  }

  // ---- Bore and sockets
  const profileCs = (r: number, pts: [number, number][], dx = 0) => keep(new CrossSection([pts.map(([u, v]) => [dx + u * r, v * r] as [number, number])]));
  // Straight piece along y from y0 to y1 with the profile's apex towards +z:
  // extrude runs along +z, so turn it to run along -y, then shift it.
  const straight = (cs: ReturnType<typeof CrossSection.circle>, x: number, y0: number, y1: number) =>
    keep(keep(keep(Manifold.extrude(cs, y1 - y0)).rotate([90, 0, 0])).translate([x, y1, 0]));
  const bore = profileCs(rb, bp.pts);
  // Revolving about the y axis sweeps the semicircle: the profile's radial
  // direction is u, and its apex direction v becomes +z.
  const bend = keep(keep(Manifold.revolve(profileCs(rb, bp.pts, R), n * 2, 180)).translate([R, stub, 0]));
  // Sockets keep the full round inside a pointed roof, so the pipe fits.
  const sock = profileCs(b.sockR, boreProfile(section, n).pts);
  const cavities = [
    bend,
    straight(bore, 0, -0.5, stub + 0.01),
    straight(bore, 2 * R, -0.5, stub + 0.01),
    straight(sock, 0, -depth - 1, 0),
    straight(sock, 2 * R, -depth - 1, 0),
  ];
  return keep(body.subtract(keep(Manifold.union(cavities))));
}
