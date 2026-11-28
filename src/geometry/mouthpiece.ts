// Mouthpiece parts. Each is built standing on +z with its outlet end at z = 0,
// which is also how it should be printed.

import type { CrossSection, Manifold } from 'manifold-3d';
import type { ManifoldToplevel } from './manifold';
import type { Resolved } from '../model/derive';
import { boreProfile } from './profile';

export interface LocalPart {
  name: string;
  role: 'mouthpiece' | 'accessory' | 'test';
  m: Manifold;
  /** Where this part sits along the mouthpiece axis in the assembled preview. */
  previewZ: number;
  flipForPreview?: boolean;
  note?: string;
  /** Shown in the assembled view instead of `m` at previewZ, in mouthpiece
   *  coordinates, for a part that does not sit along the axis. */
  preview?: Manifold;
  /** Printed as these pieces instead of `m`. */
  printAs?: { name: string; m: Manifold; note?: string }[];
}

export interface MouthpieceBuild {
  parts: LocalPart[];
  /** z (in mouthpiece coordinates) of the top end of the inlet pipe, or of the
   *  body socket bottom when there is no pipe. */
  pipeTopZ: number;
}

type Keep = <T extends { delete(): void }>(m: T) => T;

export function buildMouthpiece(M: ManifoldToplevel, res: Resolved, keep: Keep): MouthpieceBuild {
  const { Manifold, CrossSection } = M;
  const d = res.d;
  const mp = res.mouthpiece;
  const seg = Math.max(24, Math.round(d.resolution / 4) * 4);
  const cyl = (h: number, r0: number, r1 = r0, z = 0) => keep(keep(Manifold.cylinder(h, r0, r1, seg)).translate([0, 0, z]));
  const ring = (r: number, z: number, n = seg): [number, number, number][] =>
    Array.from({ length: n }, (_, i) => {
      const a = (2 * Math.PI * i) / n;
      return [r * Math.cos(a), r * Math.sin(a), z];
    });
  const hull = (pts: (Manifold | [number, number, number])[]) => keep(Manifold.hull(pts));
  const union = (ms: Manifold[]) => keep(Manifold.union(ms));
  const sub = (a: Manifold, b: Manifold) => keep(a.subtract(b));

  // ---- Outlet: either a spigot into the body socket, or a socket for the pipe.
  const sd = mp.outletDepth;
  let z0: number; // top of the outlet section
  let outletOuter: number; // outside radius at z0
  const solids: Manifold[] = [];
  const cavities: Manifold[] = [];
  if (mp.outlet === 'spigot') {
    solids.push(cyl(sd, mp.outletOuterR));
    // Small lead-in chamfer at the tip.
    cavities.push(sub(cyl(0.8, mp.outletOuterR + 2), cyl(0.8, mp.outletOuterR - 0.6, mp.outletOuterR)));
    z0 = sd;
    outletOuter = mp.outletOuterR;
  } else {
    outletOuter = mp.outletOuterR + 2.4;
    solids.push(cyl(sd + 2, outletOuter));
    cavities.push(cyl(sd + 1, mp.outletOuterR, mp.outletOuterR, -1));
    z0 = sd + 2;
  }
  const pipeTopZ = mp.outlet === 'spigot' ? 0 : sd;
  const boreR = mp.outletBoreR;
  // A 45° cone from the outlet to a wider body, so nothing overhangs.
  const flare = (toR: number, z: number) => {
    if (toR <= outletOuter + 0.01) return z;
    solids.push(hull([...ring(outletOuter, z), ...ring(toR, z + (toR - outletOuter))]));
    return z + (toR - outletOuter);
  };

  const parts: LocalPart[] = [];

  if (mp.kind === 'single-reed' && mp.reed) {
    const reed = mp.reed;
    const yt = boreR + 1.8; // table plane at y = -yt
    const Rb = Math.max(Math.sqrt(yt * yt + (reed.width / 2 + 0.6) ** 2) + 0.3, outletOuter);
    const zb = flare(Rb, z0);
    const Lm = mp.bodyLength ?? reed.length + 2;
    const zTip = z0 + Lm;
    const beak = Math.min(Lm * 0.4, 30);
    const z1 = zTip - beak;
    solids.push(cyl(z1 - zb, Rb, Rb, zb));
    const tipThick = 4;
    const tipPts: [number, number, number][] = [];
    for (const x of [-reed.width / 2, reed.width / 2])
      for (const y of [-yt, -yt + tipThick]) tipPts.push([x, y, zTip]);
    solids.push(hull([...ring(Rb, z1), ...tipPts]));

    // Table and facing curve: remove everything below y_cut(z).
    const zf = zTip - reed.facing;
    const poly: [number, number][] = [[z0 - 1, -yt]];
    for (let k = 0; k <= 24; k++) {
      const z = zf + ((zTip + 1 - zf) * k) / 24;
      const u = (z - zf) / reed.facing;
      poly.push([z, -yt + reed.tip * u * u]);
    }
    poly.push([zTip + 3, -Rb - 20], [z0 - 1, -Rb - 20]);
    const cut = extrudeYZ(M, poly, 2 * Rb + 20, keep);
    cavities.push(cut);

    // Window through the table, with a tip rail of 1.5 mm.
    const zw1 = zTip - 1.5;
    const zw0 = zw1 - reed.windowL;
    const wr = reed.windowW / 2;
    const slot = (z: number) => keep(keep(keep(Manifold.cylinder(10, wr, wr, seg)).rotate([90, 0, 0])).translate([0, -yt + 4, z]));
    cavities.push(hull([slot(zw0 + wr), slot(zw1 - wr)]));
    // Chamber and baffle: from the bore up to the window, closing towards the tip.
    const ch: [number, number, number][] = [...ring(boreR, zw0 - 10)];
    for (const x of [-wr, wr]) {
      ch.push([x, -yt - 0.5, zw0], [x, Math.min(boreR * 0.9, Rb - 2.5), zw0]);
      ch.push([x, -yt - 0.5, zw1 - 1], [x, -yt + 1.2, zw1 - 1]);
    }
    cavities.push(hull(ch));
    cavities.push(cyl(zw0 - 9 + 1, boreR, boreR, -1));
    // Ligature grooves for a rubber band or cord.
    for (const zg of [zb + 6, zb + 15]) {
      cavities.push(sub(cyl(2.5, Rb + 5, Rb + 5, zg), cyl(2.5, Rb - 0.8, Rb - 0.8, zg)));
    }
    parts.push({
      name: 'Mouthpiece (single reed)',
      role: 'mouthpiece',
      m: sub(union(solids), union(cavities)),
      previewZ: 0,
      note: `Print standing. Sand the table flat on glass. Tip opening ${reed.tip} mm over a ${reed.facing} mm facing.`,
    });
  } else if (mp.kind === 'single-reed') {
    // Adapter for a shop-bought mouthpiece.
    const shankR = d.adapterShankDiameter / 2 + 0.15;
    const Ro = shankR + 2.4;
    const zb = flare(Ro, z0);
    const zCup = Math.max(zb, z0 + 10);
    solids.push(cyl(zCup + d.adapterShankDepth - zb, Ro, Ro, zb));
    cavities.push(cyl(d.adapterShankDepth + 1, shankR, shankR, zCup));
    cavities.push(cyl(zCup + 1, boreR, boreR, -1));
    // Ease the step from the shank seat to the bore.
    cavities.push(hull([...ring(boreR, zCup - Math.max(0, shankR - boreR)), ...ring(shankR - 0.5, zCup + 0.01)]));
    parts.push({ name: 'Mouthpiece adapter', role: 'mouthpiece', m: sub(union(solids), union(cavities)), previewZ: 0, note: 'Wrap the mouthpiece cork with tape if the fit is loose.' });
  } else if (mp.kind === 'double-reed' && mp.seat) {
    const seat = mp.seat;
    const collarR = Math.max(outletOuter, (seat.topR || 2.6) + 2.4, 6);
    const zb = flare(collarR, z0);
    const zWell = z0 + 22;
    let zTop: number;
    if (seat.kind === 'bassoon' && seat.bocal) {
      // Printed bocal tip that the reed slides onto.
      const b = seat.bocal;
      zTop = zWell;
      solids.push(cyl(zTop - zb, collarR, collarR, zb));
      solids.push(cyl(b.L, b.r1, b.r0, zTop));
      cavities.push(cyl(zTop + b.L + 2, 1.3, 1.3, zTop - 4));
      cavities.push(hull([...ring(boreR, 0), ...ring(1.3, zTop - 4)]));
      cavities.push(cyl(1, boreR, boreR, -1));
    } else {
      zTop = zWell + seat.depth;
      solids.push(cyl(zTop - zb, collarR, collarR, zb));
      cavities.push(cyl(seat.depth + 1, seat.bottomR, seat.topR, zWell));
      const reedR = seat.kind === 'oboe' ? 2.35 : Math.max(0.8, seat.bottomR - 0.35);
      cavities.push(hull([...ring(boreR, 0), ...ring(reedR, zWell + 0.01)]));
      cavities.push(cyl(1, boreR, boreR, -1));
    }
    parts.push({
      name: 'Reed seat',
      role: 'mouthpiece',
      m: sub(union(solids), union(cavities)),
      previewZ: 0,
      note: seat.kind === 'straw' ? `Takes a ${d.strawDiameter} mm drinking straw. Flatten 15 mm of one end and cut it to a point.` : undefined,
    });
    if (mp.windcap) {
      const capSock = collarR + 0.15;
      const innerR = Math.max(mp.windcap.innerR, capSock);
      const outerR = innerR + 2;
      const sockLen = 12;
      const L = mp.windcap.length;
      const mouthR = 3;
      const zc = sockLen + L;
      const cs: Manifold[] = [cyl(zc, outerR), hull([...ring(outerR, zc), ...ring(mouthR + 2, zc + (outerR - mouthR - 2))])];
      const top = zc + (outerR - mouthR - 2);
      cs.push(cyl(8, mouthR + 2, mouthR + 2, top));
      const cc: Manifold[] = [cyl(sockLen + 0.01, capSock, capSock, -1), cyl(L, innerR, innerR, sockLen)];
      cc.push(hull([...ring(innerR, zc - 0.01), ...ring(mouthR, zc + (innerR - mouthR))]));
      cc.push(cyl(top + 9 - zc, mouthR, mouthR, zc));
      parts.push({
        name: 'Wind cap',
        role: 'accessory',
        m: sub(union(cs), union(cc)),
        previewZ: zTop - sockLen,
        note: 'Push over the reed seat collar. Blow through the top; the reed should not touch the cap.',
      });
    }
  } else if (mp.kind === 'membrane' && mp.membrane) {
    const mb = mp.membrane;
    const wall = mb.wall;
    const chOuter = mb.innerR + wall;
    if (mb.facing === 'front') {
      parts.push(...frontMembrane(M, res, keep, { solids, cavities, z0, outletOuter, seg }));
      return { parts, pipeTopZ };
    }
    let zFloor: number;
    if (mb.pipeThrough) {
      // Sleeve that the pipe slides through; the pipe end is the nozzle.
      const pr = (res.pipe.od + Math.min(d.clearance, 0.15)) / 2;
      const sleeveR = pr + 2.4;
      solids.push(cyl(24, sleeveR));
      cavities.push(cyl(200, pr, pr, -1));
      outletOuter = sleeveR;
      zFloor = flare(chOuter, 20);
      zFloor = Math.max(zFloor, 24);
    } else {
      zFloor = flare(chOuter, z0);
      zFloor = Math.max(zFloor, z0 + 2);
    }
    const zBase = zFloor + mb.base;
    const zRim = zBase + mb.chamberDepth;
    solids.push(cyl(zRim - zFloor, chOuter, chOuter, zFloor));
    cavities.push(cyl(zRim - zBase + 1, mb.innerR, mb.innerR, zBase));
    // Rubber-band groove below the rim.
    cavities.push(sub(cyl(2, chOuter + 5, chOuter + 5, zRim - 4.5), cyl(2, chOuter - 0.9, chOuter - 0.9, zRim - 4.5)));
    // Round over the rim so the latex is not cut.
    cavities.push(sub(cyl(0.8, chOuter + 3, chOuter + 3, zRim - 0.8), cyl(0.8, chOuter, chOuter - 0.8, zRim - 0.8)));
    // The nozzle stands inside the chamber, so it is added after the chamber
    // is cut out, and its bore cut after that.
    const nozzle: Manifold[] = [];
    let nozzleBore: Manifold | null = null;
    if (!mb.pipeThrough) {
      const nTop = zRim + mb.protrusion;
      const no = mb.nozzleR + mb.nozzleWall;
      nozzle.push(cyl(nTop - 0.6 - zBase + 0.5, no, no, zBase - 0.5));
      nozzle.push(cyl(0.6, no, no - 0.5, nTop - 0.6));
      nozzleBore = cyl(nTop + 2, mb.nozzleR, mb.nozzleR, -1);
      cavities.push(nozzleBore);
    }
    const tubeR = 5.5;
    const tubeBoreR = 3.8;
    if (d.blowTube === 'flat') {
      // Level blow tube, straight out of the side. It sits low, so its top
      // clears the clamp ring and the rubber-band groove. To print standing
      // without supports, the outside has a 45° keel underneath and the bore
      // a pointed roof of the same area as the round bore.
      const zc = Math.min(zBase + mb.chamberDepth * 0.35, zRim - 6.5 - tubeR);
      const drop = boreProfile('drop', seg);
      // Extrude along local z, then turn so local z -> +x, local x -> -z and
      // local y -> y. A profile point (u, v) has v upwards in the world.
      const tube = (r: number, pointDown: boolean, x0: number, len: number) => {
        const pts = drop.pts.map(([u, v]) => [pointDown ? v * r : -v * r, u * r] as [number, number]);
        const cs = new CrossSection([pts], 'NonZero');
        const ex = keep(Manifold.extrude(cs, len));
        cs.delete();
        return keep(keep(ex.rotate([0, 90, 0])).translate([x0, 0, zc]));
      };
      const x0 = mb.innerR - 2;
      solids.push(tube(tubeR, true, x0, 24));
      cavities.push(tube(tubeBoreR * drop.scale, false, x0 - 1, 26));
    } else {
      // Blow tube, 45° up and out.
      const tubeLen = 30;
      const tube = (r: number, len: number) =>
        keep(keep(keep(Manifold.cylinder(len, r, r, seg)).rotate([0, 45, 0])).translate([mb.innerR - 2, 0, zBase + mb.chamberDepth * 0.35]));
      solids.push(tube(tubeR, tubeLen));
      cavities.push(tube(tubeBoreR, tubeLen + 1));
    }
    let body = sub(union(solids), union(cavities));
    if (nozzleBore) body = sub(union([body, ...nozzle]), nozzleBore);
    parts.push({
      name: 'Membrane mouthpiece',
      role: 'mouthpiece',
      m: body,
      previewZ: 0,
      note: mb.pipeThrough
        ? 'Stretch latex over the rim and clamp it. Slide the pipe up until it presses into the latex.'
        : `Stretch a piece of latex glove over the rim so it presses on the nozzle (${mb.protrusion} mm proud). Clamp with the ring or a rubber band.`,
    });
    // Clamp ring for the latex.
    const ringIn = chOuter + 0.45;
    const ringM = sub(cyl(7, ringIn + 2.4), cyl(9, ringIn, ringIn, -1));
    parts.push({ name: 'Membrane clamp ring', role: 'accessory', m: ringM, previewZ: zRim - 6, note: 'Press over the latex and rim.' });
  }

  return { parts, pipeTopZ };
}

/**
 * Membrane facing forwards (local -y, which the assembly turns to face the
 * same way as the finger holes). The bore rises from the outlet behind the
 * chamber, turns forwards and runs out through the back wall as the nozzle.
 * The blow tube leaves the top of the chamber towards the player.
 *
 * A chamber lying on its side cannot print standing, so this mouthpiece is
 * split down its middle (the plane x = 0, which holds every axis) and each
 * half prints cut face down. The chamber has a lemon section, pointed at
 * ±x, so neither half has a flat roof; the small bores stay round.
 */
function frontMembrane(
  M: ManifoldToplevel,
  res: Resolved,
  keep: Keep,
  o: { solids: Manifold[]; cavities: Manifold[]; z0: number; outletOuter: number; seg: number },
): LocalPart[] {
  const { Manifold, CrossSection } = M;
  const d = res.d;
  const mp = res.mouthpiece;
  const mb = mp.membrane!;
  const { solids, cavities, seg } = o;
  const chOuter = mb.innerR + mb.wall;
  const { zc, yRim, yBack } = mb;
  const boreR = mb.nozzleR;
  const no = mb.nozzleR + mb.nozzleWall;
  const yTip = yRim - mb.protrusion;

  // Lemon section in the x-z plane, pointed at ±x.
  const lemon = boreProfile('lemon', seg * 2).pts;
  const lemonCs = (r: number) => keep(new CrossSection([lemon.map(([u, v]) => [v * r, u * r] as [number, number])], 'NonZero'));
  const circleCs = (r: number) => keep(CrossSection.circle(r, seg));
  // Prism along y from y0 to y1, centred on (x = 0, z = zc): extrude runs
  // along +z; rotating about x by 90° sends it along -y.
  const prismY = (cs: CrossSection, y0: number, y1: number) =>
    keep(keep(keep(Manifold.extrude(cs, y1 - y0)).rotate([90, 0, 0])).translate([0, y1, zc]));
  const ball = (r: number) => keep(keep(Manifold.sphere(r, seg)).translate([0, 0, zc]));

  // ---- Riser and elbow, behind the chamber.
  const rr = Math.max(o.outletOuter, boreR + mb.wall);
  solids.push(keep(keep(Manifold.cylinder(zc - o.z0 + 0.5, rr, rr, seg)).translate([0, 0, o.z0 - 0.5])));
  solids.push(ball(rr));
  solids.push(prismY(circleCs(rr), yBack, 0));
  cavities.push(keep(keep(Manifold.cylinder(zc + 1, boreR, boreR, seg)).translate([0, 0, -1])));
  cavities.push(ball(boreR));
  cavities.push(prismY(circleCs(boreR), yTip - 1, 0));

  // ---- Chamber, rim and nozzle.
  solids.push(prismY(lemonCs(chOuter), yRim, yBack + mb.base));
  cavities.push(prismY(lemonCs(mb.innerR), yRim - 1, yBack));
  // Round over the rim so the latex is not cut.
  const bevel = keep(Manifold.hull([prismY(lemonCs(chOuter), yRim + 0.8, yRim + 0.81), prismY(lemonCs(chOuter - 0.8), yRim - 0.01, yRim)]));
  // Only the outer edge: the nozzle tip stands proud of the rim inside it.
  cavities.push(keep(keep(prismY(lemonCs(chOuter + 3), yRim - 1, yRim + 0.8).subtract(bevel)).subtract(prismY(lemonCs(chOuter - 0.8), yRim - 1.1, yRim + 0.9))));
  // Rubber-band groove behind the rim.
  cavities.push(keep(prismY(lemonCs(chOuter + 5), yRim + 2.5, yRim + 4.5).subtract(prismY(lemonCs(chOuter - 0.9), yRim + 2.4, yRim + 4.6))));
  // The nozzle stands inside the chamber: added after the chamber is cut.
  const nozzle = [
    prismY(circleCs(no), yTip + 0.6, yBack + 0.5),
    keep(keep(keep(Manifold.cylinder(0.6, no, no - 0.5, seg)).rotate([90, 0, 0])).translate([0, yTip + 0.6, zc])),
  ];
  const nozzleBore = prismY(circleCs(boreR), yTip - 1, 0);

  // ---- Blow tube, from the top of the chamber back towards the player:
  // rising at 45°, or level. It starts above the nozzle and far enough back
  // to clear the clamp ring.
  const tubeR = 5.5;
  const tubeBoreR = 3.8;
  const angled = d.blowTube !== 'flat';
  const sy = yRim + mb.chamberDepth * 0.6;
  const sz = zc + Math.max(mb.innerR * 0.5, no + 3.5);
  const len = angled ? 30 : rr + 15 - sy;
  const tube = (r: number, l: number, back: number) => {
    const t = keep(keep(Manifold.cylinder(l, r, r, seg)).rotate([angled ? -45 : -90, 0, 0]));
    const k = angled ? Math.SQRT1_2 : 1;
    return keep(t.translate([0, sy - back * (angled ? Math.SQRT1_2 : 1), sz - back * (angled ? k : 0)]));
  };
  solids.push(tube(tubeR, len, 0));
  cavities.push(tube(tubeBoreR, len + 2, 1));

  let body = keep(keep(Manifold.union(solids)).subtract(keep(Manifold.union(cavities))));
  body = keep(keep(Manifold.union([body, ...nozzle])).subtract(nozzleBore));
  // Halves: +x and -x, each turned cut face down.
  const halfA = keep(keep(body.trimByPlane([1, 0, 0], 0)).rotate([0, -90, 0]));
  const halfB = keep(keep(body.trimByPlane([-1, 0, 0], 0)).rotate([0, 90, 0]));
  const glue = 'Glue the halves with the rim and outlet lined up, and sand the rim smooth across the joint.';
  const ringCs = keep(keep(lemonCs(chOuter).offset(0.45 + 2.4, 'Miter', 4)).subtract(keep(lemonCs(chOuter).offset(0.45, 'Miter', 4))));
  return [
    {
      name: 'Membrane mouthpiece',
      role: 'mouthpiece',
      m: body,
      previewZ: 0,
      note: `Membrane faces forwards. Stretch a piece of latex glove over the rim so it presses on the nozzle (${mb.protrusion} mm proud). Clamp with the ring or a rubber band.`,
      printAs: [
        { name: 'Membrane mouthpiece half 1/2', m: halfA, note: `Print cut face down. ${glue}` },
        { name: 'Membrane mouthpiece half 2/2', m: halfB, note: `Print cut face down. ${glue}` },
      ],
    },
    {
      name: 'Membrane clamp ring',
      role: 'accessory',
      m: keep(Manifold.extrude(ringCs, 7)),
      previewZ: 0,
      preview: prismY(ringCs, yRim - 1, yRim + 6),
      note: 'Print flat. Press over the latex and rim.',
    },
  ];
}

/** Extrude a polygon given in (z, y) across x, centred on x = 0. */
function extrudeYZ(M: ManifoldToplevel, poly: [number, number][], width: number, keep: (m: Manifold) => Manifold): Manifold {
  const { CrossSection, Manifold } = M;
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  const pts = area < 0 ? poly.slice().reverse() : poly;
  const cs = new CrossSection([pts]);
  // Extrusion axis is the CrossSection's z; map (u, v, w) -> (-w, v, u).
  const ex = keep(Manifold.extrude(cs, width));
  cs.delete();
  return keep(keep(ex.rotate([0, -90, 0])).translate([width / 2, 0, 0]));
}
