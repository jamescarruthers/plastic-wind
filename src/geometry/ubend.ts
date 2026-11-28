// A printed U-bend that joins two lengths of pipe, side by side.
//
// Local coordinates: the bottom of socket A is at the origin and the bore
// leaves it heading +y; it turns towards +x round a semicircle of radius R
// and comes back down to the bottom of socket B at (2R, 0). Both sockets
// open towards -y. The fitting lies flat (the U in the XY plane) with a
// pointed bore roof towards +z, so it prints without supports.

import type { Manifold } from 'manifold-3d';
import type { ManifoldToplevel } from './manifold';
import type { Resolved } from '../model/derive';
import { boreProfile } from './profile';

export function buildUBend(M: ManifoldToplevel, res: Resolved, keep: <T extends { delete(): void }>(m: T) => T): Manifold {
  const { Manifold, CrossSection } = M;
  const b = res.pipeBend!;
  const n = Math.max(24, Math.round(res.d.resolution / 4) * 4);
  const R = b.R;
  const stub = b.stub;
  const depth = res.d.socketDepth;
  const so = b.sockR + b.wall; // outside radius around a socket

  // Outline: two socket housings and a half-ring joining them.
  const rect = (x0: number, y0: number, x1: number, y1: number) =>
    keep(new CrossSection([[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]]));
  const ring = keep(keep(keep(CrossSection.circle(R + so, n)).subtract(keep(CrossSection.circle(Math.max(0.01, R - so), n)))).translate([R, stub]));
  const upper = rect(-so - 1, stub, 2 * R + so + 1, stub + R + so + 1);
  const outline = keep(
    CrossSection.union([rect(-so, -depth, so, stub + 0.01), rect(2 * R - so, -depth, 2 * R + so, stub + 0.01), keep(ring.intersect(upper))]),
  );
  // Bore: pointed roof, same area as the pipe's bore.
  const bp = boreProfile('drop', n);
  const rb = (res.pipe.id_ / 2) * bp.scale;
  // Thick enough for a full wall over the socket and over the bore's point.
  const half = Math.max(so, b.sockR * Math.SQRT2 + b.wall, rb * Math.SQRT2 + b.wall);
  const T = 2 * half;
  const body = keep(keep(Manifold.extrude(outline, T)).translate([0, 0, -T / 2]));
  const boreCs = (r: number, pts: [number, number][]) => keep(new CrossSection([pts.map(([u, v]) => [u * r, v * r] as [number, number])]));
  // Straight piece along y from y0 to y1, profile apex towards +z.
  const straight = (cs: ReturnType<typeof CrossSection.circle>, x: number, y0: number, y1: number) => {
    const ex = keep(Manifold.extrude(cs, y1 - y0));
    // extrude runs along +z; turn it so it runs along -y with the profile's
    // apex pointing +z, then shift into place.
    return keep(keep(ex.rotate([90, 0, 0])).translate([x, y1, 0]));
  };
  const boreRing = boreCs(rb, bp.pts);
  // Revolving the profile about the y axis sweeps the semicircle; the
  // profile's radial direction is u, its apex direction v becomes +z.
  const torusCs = keep(new CrossSection([bp.pts.map(([u, v]) => [R + u * rb, v * rb] as [number, number])]));
  const bend = keep(keep(Manifold.revolve(torusCs, n * 2, 180)).translate([R, stub, 0]));
  const sockRing = boreCs(b.sockR, boreProfile('drop', n).pts);
  const cavities = [
    bend,
    straight(boreRing, 0, -0.5, stub + 0.01),
    straight(boreRing, 2 * R, -0.5, stub + 0.01),
    straight(sockRing, 0, -depth - 1, 0),
    straight(sockRing, 2 * R, -depth - 1, 0),
  ];
  return keep(body.subtract(keep(Manifold.union(cavities))));
}
