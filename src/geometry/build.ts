// Builds the printable solids from the resolved design, solved bore and layout.

import type { Manifold } from 'manifold-3d';
import type { ManifoldToplevel } from './manifold';
import type { Resolved } from '../model/derive';
import type { SolveResult } from '../acoustics/solver';
import type { Layout } from './layout';
import type { Path } from './path';
import { buildMouthpiece } from './mouthpiece';
import { isFlatStyle, loopsBehind } from '../model/design';

type V3 = [number, number, number];

export interface PartMesh {
  name: string;
  role: 'body' | 'mouthpiece' | 'accessory' | 'test' | 'pipe';
  color: string;
  positions: Float32Array;
  indices: Uint32Array;
  volume: number; // mm³
  size: V3;
  note?: string;
}

export interface BuildResult {
  preview: PartMesh[];
  print: PartMesh[];
  warnings: string[];
  dowels: { count: number; length: number; diameter: number };
  cuts: number;
  bounds: { min: V3; max: V3 };
  plates: [number, number][];
}

const COLORS = {
  front: '#d9b77e',
  back: '#c49a5c',
  body: '#d9b77e',
  mouthpiece: '#3d3d42',
  accessory: '#6b7a8f',
  test: '#7fa88b',
  pipe: '#b87333',
};

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const l2 = vx * vx + vy * vy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / l2)) : 0;
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

function signedArea(pl: readonly (readonly [number, number] | { x: number; y: number })[]): number {
  let a = 0;
  const xy = (p: (typeof pl)[number]) => (Array.isArray(p) ? (p as [number, number]) : [(p as { x: number }).x, (p as { y: number }).y]);
  for (let i = 0; i < pl.length; i++) {
    const [x0, y0] = xy(pl[i]);
    const [x1, y1] = xy(pl[(i + 1) % pl.length]);
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

/** Unit cross-section of the bore. "lemon" is pointed at ±z, "drop" at +z only,
 *  with the radius scaled so the area matches a circle of the nominal radius. */
function boreProfile(shape: 'round' | 'lemon' | 'drop', n: number): { pts: [number, number][]; scale: number } {
  const pts: [number, number][] = [];
  const q = Math.PI / 4;
  for (let i = 0; i < n; i++) {
    const phi = (2 * Math.PI * i) / n;
    let rho = 1;
    const s = Math.sin(phi);
    const top = s > Math.sin(q) + 1e-9;
    const bottom = s < -Math.sin(q) - 1e-9;
    if ((shape === 'lemon' && (top || bottom)) || (shape === 'drop' && top)) {
      const ref = top ? (phi < Math.PI / 2 + 1e-9 ? q : 3 * q) : phi < (3 * Math.PI) / 2 + 1e-9 ? 5 * q : 7 * q;
      rho = 1 / Math.cos(phi - ref);
    }
    pts.push([rho * Math.cos(phi), rho * Math.sin(phi)]);
  }
  const extra = 1 - Math.PI / 4; // cap area per pointed side, × r²
  const caps = shape === 'lemon' ? 2 : shape === 'drop' ? 1 : 0;
  return { pts, scale: 1 / Math.sqrt(1 + (caps * extra) / Math.PI) };
}

export async function buildInstrument(M: ManifoldToplevel, res: Resolved, sol: SolveResult, lay: Layout): Promise<BuildResult> {
  const { Manifold, Mesh, CrossSection } = M;
  const d = res.d;
  const warnings: string[] = [];
  const garbage: { delete(): void }[] = [];
  const keep = <T extends { delete(): void }>(m: T): T => {
    garbage.push(m);
    return m;
  };
  try {
    const path = lay.path;
    const L = path.length;
    const r = lay.radiusAt;
    const wall = d.wall;
    const ro = (s: number) => r(s) + wall;
    const n = Math.max(16, Math.round(d.resolution / 4) * 4);
    const split = d.split === 'halves';
    const lyingOnePiece = !split && d.path === 'folded';
    const shape = res.section;
    if (lyingOnePiece && d.boreShape !== 'teardrop') warnings.push('A folded body printed in one piece lies flat, so the bore uses a pointed (teardrop) top to avoid supports.');
    const bp = boreProfile(shape, n);
    const round = boreProfile('round', n);
    // The outside follows the bore's shape so the wall stays even, with the
    // ridge blunted to a narrow flat: a knife edge upsets the booleans.
    const outerProf: [number, number][] = bp.pts.map(([u, v]) => [u, Math.max(-1.32, Math.min(1.32, v))]);
    const roP = (s: number) => r(s) * bp.scale + wall;
    const conical = res.body.type === 'conical';
    const bellStart = res.body.bellLength > 0 ? L - res.body.bellLength : L;

    const sampleS = (s0: number, s1: number): number[] => {
      const step = conical ? 6 : 25;
      const base = path.samples(step, Math.PI / 24).filter((s) => s >= s0 - 1e-6 && s <= s1 + 1e-6);
      const extra: number[] = [s0, s1];
      for (let s = Math.max(s0, bellStart); s < s1; s += 2) extra.push(s);
      const all = [...base, ...extra].filter((s) => s >= s0 - 1e-6 && s <= s1 + 1e-6).sort((a, b) => a - b);
      // Drop near-duplicates (keep the ends exact).
      const out: number[] = [];
      for (const s of all) if (!out.length || s - out[out.length - 1] > 0.05) out.push(s);
      if (out[out.length - 1] < s1 - 1e-9) {
        if (s1 - out[out.length - 1] < 0.05 && out.length > 1) out.pop();
        out.push(s1);
      }
      return out;
    };

    const frame = (s: number): { p: V3; t: V3; nrm: V3 } => {
      const a = path.at(Math.min(Math.max(s, 0), L));
      let px = a.p[0];
      let py = a.p[1];
      if (s < 0) {
        px += a.t[0] * s;
        py += a.t[1] * s;
      } else if (s > L) {
        px += a.t[0] * (s - L);
        py += a.t[1] * (s - L);
      }
      return { p: [px, py, 0], t: [a.t[0], a.t[1], 0], nrm: [-a.t[1], a.t[0], 0] };
    };

    const ringPts = (s: number, rad: number, prof: [number, number][]): V3[] => {
      const f = frame(s);
      return prof.map(([u, v]) => [f.p[0] + rad * u * f.nrm[0], f.p[1] + rad * u * f.nrm[1], rad * v]);
    };

    const sweep = (ss: number[], rad: (s: number) => number, prof: [number, number][], profAt?: (s: number) => [number, number][]): Manifold => {
      const m = prof.length;
      const verts: number[] = [];
      for (const s of ss) for (const q of ringPts(s, rad(s), profAt ? profAt(s) : prof)) verts.push(q[0], q[1], q[2]);
      const c0 = frame(ss[0]).p;
      const c1 = frame(ss[ss.length - 1]).p;
      const i0 = ss.length * m;
      verts.push(...c0, ...c1);
      const tris: number[] = [];
      for (let i = 0; i + 1 < ss.length; i++) {
        for (let j = 0; j < m; j++) {
          const a = i * m + j;
          const b = i * m + ((j + 1) % m);
          const c = (i + 1) * m + ((j + 1) % m);
          const e = (i + 1) * m + j;
          tris.push(a, b, c, a, c, e);
        }
      }
      const last = (ss.length - 1) * m;
      for (let j = 0; j < m; j++) {
        tris.push(i0, (j + 1) % m, j);
        tris.push(i0 + 1, last + j, last + ((j + 1) % m));
      }
      const mesh = new Mesh({ numProp: 3, vertProperties: new Float32Array(verts), triVerts: new Uint32Array(tris) });
      return keep(new Manifold(mesh));
    };

    const hullOf = (pts: (V3 | Manifold)[]) => keep(Manifold.hull(pts));
    const union = (ms: Manifold[]) => (ms.length === 1 ? ms[0] : keep(Manifold.union(ms)));

    // Cylinder whose axis runs along an in-plane direction `dir`, from `p`.
    const cylAlong = (p: V3, dir: V3, len: number, r0: number, r1 = r0): Manifold => {
      const c = keep(Manifold.cylinder(len, r0, r1, n));
      const phi = (Math.atan2(dir[1], dir[0]) * 180) / Math.PI - 90;
      return keep(keep(keep(c.rotate([-90, 0, 0])).rotate([0, 0, phi])).translate(p));
    };

    /**
     * Flat body whose outline is one rectangle per feature of the air path
     * (the finger line, each loop, the folded legs, the upturned bell).
     * The ends stay flush with the inlet socket mouth and the bell opening.
     * `rounded` turns each rectangle into a rounded one and fillets the
     * inside corners.
     */
    const blocks = (rounded: boolean): Manifold => {
      type Box = { x0: number; y0: number; x1: number; y1: number; m: number; start: boolean; end: boolean };
      const groups = new Map<number, Box>();
      path.pieces.forEach((pc, i) => {
        const s0 = path.starts[i];
        const s1 = i + 1 < path.pieces.length ? path.starts[i + 1] : L;
        const g = pc.group ?? 0;
        const b = groups.get(g) ?? { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, m: 0, start: false, end: false };
        for (const s of [s0, ...sampleS(s0, s1), s1]) {
          const p = path.at(s).p;
          b.x0 = Math.min(b.x0, p[0]);
          b.x1 = Math.max(b.x1, p[0]);
          b.y0 = Math.min(b.y0, p[1]);
          b.y1 = Math.max(b.y1, p[1]);
          b.m = Math.max(b.m, roP(s));
        }
        if (i === 0) b.start = true;
        if (i === path.pieces.length - 1) b.end = true;
        groups.set(g, b);
      });
      const fs = frame(0);
      const fe = frame(L);
      const sockDepth = res.socket.kind === 'socket' ? res.socket.depth : 0;
      const sr = res.socket.kind === 'socket' ? res.socket.r + Math.max(2.4, wall * 0.8) : 0;
      const mouth: [number, number] = [fs.p[0] - fs.t[0] * sockDepth, fs.p[1] - fs.t[1] * sockDepth];
      // Pull one side of a rectangle in to a given coordinate, on the axis
      // the end of the bore points along.
      const clampTo = (b: { x0: number; y0: number; x1: number; y1: number }, dir: V3, at: [number, number]) => {
        if (dir[1] > 0.9) b.y1 = at[1];
        else if (dir[1] < -0.9) b.y0 = at[1];
        else if (dir[0] > 0.9) b.x1 = at[0];
        else if (dir[0] < -0.9) b.x0 = at[0];
      };
      const rects: { x0: number; y0: number; x1: number; y1: number }[] = [];
      for (const [g, b] of groups) {
        const r0 = { x0: b.x0 - b.m, y0: b.y0 - b.m, x1: b.x1 + b.m, y1: b.y1 + b.m };
        // The bell block starts where the bell section starts.
        if (g === 3) r0.y1 = b.y1;
        if (b.start) clampTo(r0, [-fs.t[0], -fs.t[1], 0], mouth);
        if (b.end) clampTo(r0, fe.t, [fe.p[0], fe.p[1]]);
        rects.push(r0);
      }
      if (sr > 0) {
        // Block around the inlet socket.
        const a = fs.p;
        const xs = [a[0], mouth[0]];
        const ys = [a[1], mouth[1]];
        const across = Math.abs(fs.t[1]) > 0.5;
        rects.push(
          across
            ? { x0: a[0] - sr, x1: a[0] + sr, y0: Math.min(...ys), y1: Math.max(...ys) }
            : { x0: Math.min(...xs), x1: Math.max(...xs), y0: a[1] - sr, y1: a[1] + sr },
        );
      }
      const toCs = (q: { x0: number; y0: number; x1: number; y1: number }) =>
        keep(new CrossSection([[[q.x0, q.y0], [q.x1, q.y0], [q.x1, q.y1], [q.x0, q.y1]]]));
      const shapes = rects.map((q) => {
        const cs = toCs(q);
        if (!rounded) return cs;
        const rr = Math.min(14, 0.9 * Math.min(q.x1 - q.x0, q.y1 - q.y0) / 2);
        return keep(keep(cs.offset(-rr, 'Round', 2, 48)).offset(rr, 'Round', 2, 48));
      });
      let outline = keep(CrossSection.union(shapes));
      if (rounded) {
        // Fillet the inside corners, then square the two ends back off so
        // the inlet and the bell opening keep a full wall around them.
        const c = 5;
        outline = keep(keep(outline.offset(c, 'Round', 2, 48)).offset(-c, 'Round', 2, 48));
        const cap = (at: [number, number], dir: V3, m: number) => {
          const tx = Math.abs(dir[0]) > 0.5;
          return toCs(
            tx
              ? { x0: Math.min(at[0], at[0] - dir[0] * m), x1: Math.max(at[0], at[0] - dir[0] * m), y0: at[1] - m, y1: at[1] + m }
              : { x0: at[0] - m, x1: at[0] + m, y0: Math.min(at[1], at[1] - dir[1] * m), y1: Math.max(at[1], at[1] - dir[1] * m) },
          );
        };
        const back0: V3 = [-fs.t[0], -fs.t[1], 0];
        outline = keep(CrossSection.union([outline, cap(mouth, back0, Math.max(sr, roP(0))), cap([fe.p[0], fe.p[1]], fe.t, roP(L))]));
      }
      const half = slabHalfFor();
      return keep(keep(Manifold.extrude(outline, 2 * half)).translate([0, 0, -half]));
    };

    // ---------------- Outer body
    const outerParts: Manifold[] = [];
    if (d.bodyStyle === 'slab') {
      outerParts.push(slab(path, ro, slabHalfFor()));
    } else if (d.bodyStyle === 'blocks' || d.bodyStyle === 'rounded') {
      outerParts.push(blocks(d.bodyStyle === 'rounded'));
    } else {
      // All pieces take their cross-sections from one shared list and meet
      // exactly on a shared section, without overlapping. Touching faces
      // with identical vertices union exactly; overlapping pieces whose
      // surfaces nearly coincide would leave slivers.
      const shared = sampleS(0, L);
      path.pieces.forEach((pc, i) => {
        const a = path.starts[i];
        const b = i + 1 < path.pieces.length ? path.starts[i + 1] : L;
        const lo = Math.max(0, shared.findIndex((s) => s >= a - 1e-6));
        let hi = shared.length - 1;
        while (hi > 0 && shared[hi] > b + 1e-6) hi--;
        const ss = shared.slice(lo, hi + 1);
        if (ss.length < 2) return;
        let rmax = 0;
        for (const s of ss) rmax = Math.max(rmax, roP(s));
        if (pc.kind === 'arc' && pc.R < rmax * 1.05) {
          // Tight bend: a sweep would fold through itself on the inside, so
          // build it from short convex segments. Their inner sides overlap
          // and fill the inside of the bend.
          for (let k = 0; k + 1 < ss.length; k++) {
            outerParts.push(hullOf([...ringPts(ss[k], roP(ss[k]), outerProf), ...ringPts(ss[k + 1], roP(ss[k + 1]), outerProf)]));
          }
        } else {
          outerParts.push(sweep(ss, roP, outerProf));
        }
      });
      if (d.bodyStyle === 'web' && (lay.legs > 0 || lay.loops > 0)) {
        let rmin = Infinity;
        for (const s of sampleS(0, L)) rmin = Math.min(rmin, r(s));
        outerParts.push(slab(path, ro, (rmin + wall) * 0.7));
      }
    }

    // Inlet fitting
    const f0 = frame(0);
    const back: V3 = [-f0.t[0], -f0.t[1], 0];
    const sock = res.socket;
    const cavities: Manifold[] = [];
    if (sock.kind === 'socket') {
      // Wide enough to cover the pointed top of the bore where it starts.
      const apex = shape === 'round' ? 0 : roP(0) * 1.32 + 0.5;
      const sr = Math.max(sock.r + Math.max(2.4, wall * 0.8), apex);
      const start: V3 = [f0.p[0] + back[0] * sock.depth, f0.p[1] + back[1] * sock.depth, 0];
      outerParts.push(cylAlong(start, f0.t, sock.depth + 0.01, sr));
      if (sr > roP(0)) {
        // 45° shoulder down to the body
        const len = sr - roP(0);
        outerParts.push(hullOf([...ringPts(0, sr, round.pts), ...ringPts(len, roP(len), outerProf)]));
      }
      cavities.push(cylAlong([start[0] + back[0], start[1] + back[1], 0], f0.t, sock.depth + 1, sock.r));
      // Lead-in chamfer
      cavities.push(cylAlong([start[0] + back[0], start[1] + back[1], 0], f0.t, 1.8, sock.r + 0.8, sock.r));
    } else {
      const start: V3 = [f0.p[0] + back[0] * sock.depth, f0.p[1] + back[1] * sock.depth, 0];
      outerParts.push(cylAlong(start, f0.t, sock.depth + 0.5, sock.r));
      if (ro(0) > sock.r) outerParts.push(hullOf([...ringPts(0, sock.r, round.pts), ...ringPts(ro(0) - sock.r, ro(ro(0) - sock.r), round.pts)]));
    }

    // ---------------- Dowel positions (halves only)
    const dowelR = (d.dowelDiameter + 0.15) / 2;
    const dowels: V3[] = [];
    if (split && d.dowels) {
      const boreSamples = path.samples(2, Math.PI / 36).map((s) => ({ p: frame(s).p, r: r(s) }));
      const ok = (q: V3) => {
        for (const b of boreSamples) if (Math.hypot(q[0] - b.p[0], q[1] - b.p[1]) < b.r + dowelR + 0.8) return false;
        for (const h of lay.holes) {
          // Holes drilled in the bore plane run along a line, not a point.
          const len = Math.abs(h.dir[2]) > 0.5 ? 0 : res.maxBoreR * 2 + wall + 20;
          const ex = h.pos[0] + h.dir[0] * len;
          const ey = h.pos[1] + h.dir[1] * len;
          if (distToSegment(q[0], q[1], h.pos[0], h.pos[1], ex, ey) < h.diameter / 2 + dowelR + 2) return false;
        }
        for (const o of dowels) if (Math.hypot(q[0] - o[0], q[1] - o[1]) < 10) return false;
        return true;
      };
      for (let s = 8; s < L - 4; s += Math.max(15, d.dowelSpacing)) {
        const f = frame(s);
        const off = r(s) + 0.9 + dowelR;
        for (const side of [1, -1]) {
          const q: V3 = [f.p[0] + f.nrm[0] * off * side, f.p[1] + f.nrm[1] * off * side, 0];
          if (ok(q)) dowels.push(q);
        }
      }
      const bossH = d.dowelDepth + 1;
      for (const q of dowels) {
        if (isFlatStyle(d.bodyStyle)) continue;
        outerParts.push(keep(keep(Manifold.cylinder(2 * bossH, dowelR + 1.8, dowelR + 1.8, 24)).translate([q[0], q[1], -bossH])));
      }
    }

    // ---------------- Cavities: bore, holes
    const boreSS = sampleS(0, L);
    const ext0 = sock.kind === 'socket' ? -0.6 : -(sock.depth + 1);
    // Inside the inlet fitting (s < 0) the bore is round: the fitting is.
    const boreR = (s: number) => (s < 0 ? r(0) : r(s) * bp.scale);
    cavities.push(sweep([ext0, ...boreSS, L + 1], boreR, bp.pts, (s) => (s < 0 ? round.pts : bp.pts)));
    const slabHalf = slabHalfFor();
    // Front edge of the finger section, for holes drilled in the bore plane.
    let spineMargin = 0;
    path.pieces.forEach((pc, i) => {
      if ((pc.group ?? 0) !== 0) return;
      const s1 = i + 1 < path.pieces.length ? path.starts[i + 1] : L;
      for (const s of sampleS(path.starts[i], s1)) spineMargin = Math.max(spineMargin, roP(s));
    });
    for (const h of lay.holes) {
      const rad = Math.max(0.5, (h.diameter - d.pilotUndersize) / 2);
      const outOfPlane = Math.abs(h.dir[2]) > 0.5;
      let surf: number;
      if (outOfPlane) {
        const pointed = shape === 'lemon' || (shape === 'drop' && h.dir[2] > 0);
        surf = isFlatStyle(d.bodyStyle) ? slabHalf : pointed ? roP(h.s) * 1.32 : roP(h.s);
      } else {
        surf = d.bodyStyle === 'blocks' || d.bodyStyle === 'rounded' ? spineMargin : d.bodyStyle === 'slab' ? Math.max(ro(h.s), roP(h.s)) : roP(h.s);
      }
      const c = keep(Manifold.cylinder(surf + 3, rad, rad, n));
      const cone = d.holeChamfer > 0 ? keep(keep(Manifold.cylinder(d.holeChamfer + 2, rad, rad + d.holeChamfer + 2, n)).translate([0, 0, surf - d.holeChamfer])) : null;
      let hm = cone ? union([c, cone]) : c;
      // Built along +z; turn it to the drilling direction.
      if (outOfPlane) {
        if (h.dir[2] < 0) hm = keep(hm.rotate([180, 0, 0]));
      } else {
        hm = keep(hm.rotate([0, h.dir[0] < 0 ? -90 : 90, 0]));
      }
      cavities.push(keep(hm.translate([h.pos[0], h.pos[1], 0])));
    }
    if (dowels.length) {
      for (const q of dowels) cavities.push(keep(keep(Manifold.cylinder(2 * d.dowelDepth, dowelR, dowelR, 16)).translate([q[0], q[1], -d.dowelDepth])));
    }

    let outer = union(outerParts);
    {
      // Where tubes run side by side they can enclose thin gaps, which would
      // be tunnels through the part. Plug every hole in the mid-plane outline.
      const sl = keep(outer.slice(0));
      const holes = sl.toPolygons().filter((pl) => signedArea(pl) < 0);
      if (holes.length) {
        let rmin = Infinity;
        for (const s of sampleS(0, L)) rmin = Math.min(rmin, r(s));
        const T = isFlatStyle(d.bodyStyle) ? 2 * slabHalfFor() : 2 * (rmin + wall) * 0.8;
        const plug = keep(new CrossSection(holes.map((pl) => pl.slice().reverse())));
        const plugM = keep(keep(Manifold.extrude(keep(plug.offset(0.3)), T)).translate([0, 0, -T / 2]));
        outer = keep(Manifold.union(outer, plugM));
      }
    }
    const cav = union(cavities);
    const solid = keep(outer.subtract(cav));
    if ((globalThis as any).__dbg) {
      const bx = (m: Manifold) => { const b = m.boundingBox(); return b.min.map((v: number) => v.toFixed(0)).join(',') + ' .. ' + b.max.map((v: number) => v.toFixed(0)).join(','); };
      console.log('outer genus', outer.genus(), 'parts', outer.decompose().length);
      let acc = outer;
      cavities.forEach((c, i) => { const g0 = acc.genus(); acc = keep(acc.subtract(c)); const dg = acc.genus() - g0; if (dg !== 1 || i < 3) console.log('cavity', i, 'dgenus', dg, bx(c)); });
      console.log('sequential genus', acc.genus(), 'solid genus', solid.genus(), 'solid parts', solid.decompose().map((c) => c.volume().toFixed(1)).join(' '), 'cav genus', cav.genus(), 'cav parts', cav.decompose().length);
      {
        const mm = solid.getMesh();
        const np = mm.numProp; const nv = mm.vertProperties.length / np; const pos = new Float32Array(nv * 3);
        for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) pos[i * 3 + k] = mm.vertProperties[i * np + k];
        const re = keep(new Manifold(new Mesh({ numProp: 3, vertProperties: pos, triVerts: new Uint32Array(mm.triVerts) })));
        console.log('reimported genus', re.genus(), 'tris', solid.numTri(), re.numTri());
        // Find thin places: tiny triangles
        let tiny = 0; const v = mm.vertProperties; const t = mm.triVerts; const where: string[] = [];
        for (let i = 0; i < t.length; i += 3) {
          const a = t[i] * np, b = t[i + 1] * np, c = t[i + 2] * np;
          const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2];
          const wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
          const area = Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) / 2;
          if (area < 1e-6) { tiny++; if (where.length < 8) where.push(`(${v[a].toFixed(2)},${v[a + 1].toFixed(2)},${v[a + 2].toFixed(2)})`); }
        }
        console.log('tiny tris', tiny, where.join(' '));
      }
      const out = keep(cav.subtract(outer));
      for (const c of out.decompose()) console.log('cav outside', c.volume().toFixed(1), bx(c));
    }
    if (solid.status() !== 'NoError') warnings.push(`Geometry status: ${solid.status()}`);
    const bb = solid.boundingBox();
    const bounds = { min: [bb.min[0], bb.min[1], bb.min[2]] as V3, max: [bb.max[0], bb.max[1], bb.max[2]] as V3 };

    // With the loops behind, turn the preview so the finger holes face the viewer.
    const pv = (m: Manifold): Manifold => (loopsBehind(d) ? keep(m.rotate([0, 90, 0])) : m);

    // ---------------- Split into halves and cut to fit the bed
    const preview: PartMesh[] = [];
    const print: PartMesh[] = [];
    let cuts = 0;
    const bedMax = Math.max(d.bedX, d.bedY) - 10;
    const bedMin = Math.min(d.bedX, d.bedY) - 10;
    const holeAt = [0, 1].map((ax) => lay.holes.map((h) => ({ c: h.pos[ax], r: h.diameter / 2 + 3 })));
    const cutPositions = (ax: 0 | 1, c0: number, c1: number, maxLen: number, stagger = false): number[] => {
      const H = c1 - c0;
      if (H <= maxLen) return [];
      const k = Math.ceil(H / maxLen);
      const seg = H / k;
      const raw = stagger ? Array.from({ length: k }, (_, i) => c0 + seg / 2 + i * seg) : Array.from({ length: k - 1 }, (_, i) => c0 + (i + 1) * seg);
      const out: number[] = [];
      for (let c of raw) {
        // Keep cuts clear of tone holes.
        for (let tries = 0; tries < 40; tries++) {
          const bad = holeAt[ax].find((h) => Math.abs(h.c - c) < h.r);
          if (!bad) break;
          c = bad.c - bad.r - 0.5;
        }
        if (c > c0 + 5 && c < c1 - 5) out.push(c);
      }
      return out;
    };
    const cutAlong = (ms: Manifold[], ax: 0 | 1, cs: number[]): Manifold[] => {
      const normal: V3 = ax === 0 ? [1, 0, 0] : [0, 1, 0];
      const out: Manifold[] = [];
      for (const m of ms) {
        let rest = m;
        const found: Manifold[] = [];
        for (const c of cs.slice().sort((a, b) => b - a)) {
          const [above, below] = rest.splitByPlane(normal, c);
          keep(above);
          keep(below);
          if (!above.isEmpty()) found.push(above);
          rest = below;
        }
        if (!rest.isEmpty()) found.push(rest);
        out.push(...found.reverse());
      }
      return out;
    };

    if (split) {
      const front = keep(solid.trimByPlane([0, 0, 1], 0));
      const backH = keep(solid.trimByPlane([0, 0, -1], 0));
      preview.push(toMesh(pv(front), 'Body front half', 'body', COLORS.front));
      preview.push(toMesh(pv(backH), 'Body back half', 'body', COLORS.back));
      const w = bb.max[0] - bb.min[0];
      const h = bb.max[1] - bb.min[1];
      // Try both ways round on the bed and keep the one with fewer pieces.
      const count = (lx: number, ly: number) => Math.ceil(w / lx) * Math.ceil(h / ly);
      const [lx, ly] = count(bedMin, bedMax) <= count(bedMax, bedMin) ? [bedMin, bedMax] : [bedMax, bedMin];
      const fits = w <= lx && h <= ly;
      let fronts = [front];
      let backs = [backH];
      if (!fits && d.segment) {
        // The back half is cut half a section later, so the joints overlap like brickwork.
        const fy = cutPositions(1, bb.min[1], bb.max[1], ly * 0.95);
        const by = cutPositions(1, bb.min[1], bb.max[1], ly * 0.95, true);
        const fx = cutPositions(0, bb.min[0], bb.max[0], lx * 0.95);
        const bx = cutPositions(0, bb.min[0], bb.max[0], lx * 0.95, fy.length === 0);
        fronts = cutAlong(cutAlong([front], 1, fy), 0, fx);
        backs = cutAlong(cutAlong([backH], 1, by), 0, bx);
        cuts = fy.length + by.length + fx.length + bx.length;
      } else if (!fits) {
        warnings.push('The halves do not fit the bed. Turn on "Cut to fit the bed".');
      }
      fronts.forEach((m, i) => print.push(toMesh(m, `Front half${fronts.length > 1 ? ` ${i + 1}/${fronts.length}` : ''}`, 'body', COLORS.front, 'Print cut face down.')));
      backs.forEach((m, i) => {
        const flipped = keep(m.rotate([0, 180, 0]));
        print.push(toMesh(flipped, `Back half${backs.length > 1 ? ` ${i + 1}/${backs.length}` : ''}`, 'body', COLORS.back, 'Print cut face down.'));
      });
    } else {
      preview.push(toMesh(pv(solid), 'Body', 'body', COLORS.body));
      if (lyingOnePiece) {
        print.push(toMesh(solid, 'Body', 'body', COLORS.body, 'Print lying flat on its back with supports under the curved underside only.'));
        if (Math.max(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1]) > bedMax) warnings.push('The one-piece folded body is larger than the bed. Use split halves to cut it.');
      } else {
        // Standing up: the bore axis (y) becomes z.
        const H = bb.max[1] - bb.min[1];
        let pieces = [solid];
        if (H > d.bedZ - 5 && d.segment) {
          if (wall < 2.4) warnings.push('Walls under 2.4 mm make weak joints between sections.');
          const ys = cutPositions(1, bb.min[1], bb.max[1], d.bedZ - 5 - d.jointLength);
          pieces = jointedSections(ys);
          cuts = ys.length;
        } else if (H > d.bedZ - 5) {
          warnings.push(`The body is ${H.toFixed(0)} mm tall; the bed allows ${d.bedZ} mm. Turn on cutting or split into halves.`);
        }
        pieces.forEach((m, i) => {
          const up = keep(m.rotate([90, 0, 0]));
          print.push(toMesh(up, `Body${pieces.length > 1 ? ` section ${i + 1}/${pieces.length}` : ''}`, 'body', COLORS.body, 'Print standing, bell end down.'));
        });
      }
    }

    function jointedSections(ys: number[]): Manifold[] {
      // Sections joined by a spigot on the upper piece and a socket in the lower.
      const out: Manifold[] = [];
      let rest = outer;
      const J = d.jointLength;
      const cl = d.clearance / 2;
      for (const y of ys.slice().sort((a, b) => b - a)) {
        const s = Math.max(0, Math.min(L, L - y)); // straight path: y = L - s
        const rj = r(s) + wall / 2;
        const [above, below] = rest.splitByPlane([0, 1, 0], y);
        keep(above);
        keep(below);
        const spig = keep(keep(keep(Manifold.cylinder(J, rj - cl, rj - cl, n)).rotate([90, 0, 0])).translate([0, y, 0]));
        const sockC = keep(keep(keep(Manifold.cylinder(J + 0.4, rj + cl, rj + cl, n)).rotate([90, 0, 0])).translate([0, y + 0.01, 0]));
        out.push(keep(keep(above.add(spig)).subtract(cav)));
        rest = keep(below.subtract(sockC));
      }
      out.push(keep(rest.subtract(cav)));
      return out.reverse();
    }

    // ---------------- Mouthpiece and accessories
    const mpb = buildMouthpiece(M, res, keep);
    const pipeLen = res.usePipe ? sol.pipeLength : 0;
    // Mouthpiece axis points away from the body along -t at the inlet.
    const originOffset = pipeLen - mpb.pipeTopZ; // distance from body socket bottom to mouthpiece z = 0
    const place = (m: Manifold, z: number): Manifold => {
      const phi = (Math.atan2(back[1], back[0]) * 180) / Math.PI - 90;
      const o: V3 = [f0.p[0] + back[0] * (originOffset + z), f0.p[1] + back[1] * (originOffset + z), 0];
      return keep(keep(keep(m.rotate([-90, 0, 0])).rotate([0, 0, phi])).translate(o));
    };
    for (const p of mpb.parts) {
      preview.push(toMesh(pv(place(p.m, p.previewZ)), p.name, p.role, p.role === 'mouthpiece' ? COLORS.mouthpiece : COLORS.accessory));
      print.push(toMesh(p.m, p.name, p.role, p.role === 'mouthpiece' ? COLORS.mouthpiece : COLORS.accessory, p.note));
    }
    if (pipeLen > 0) {
      const pr = res.pipe.od / 2;
      const pipeM = keep(keep(Manifold.cylinder(pipeLen, pr, pr, n)).subtract(keep(keep(Manifold.cylinder(pipeLen + 2, res.pipe.id_ / 2, res.pipe.id_ / 2, n)).translate([0, 0, -1]))));
      preview.push(toMesh(pv(place(pipeM, -originOffset)), `${res.pipe.label} pipe`, 'pipe', COLORS.pipe));
    }

    // Fit-test coupons
    if (d.fitTest) {
      const so = sock.kind === 'socket' ? sock.r + 2.4 : sock.r;
      const coupon = sock.kind === 'socket'
        ? keep(keep(Manifold.cylinder(10, so, so, n)).subtract(keep(keep(Manifold.cylinder(12, sock.r, sock.r, n)).translate([0, 0, -1]))))
        : keep(keep(Manifold.cylinder(10, so, so, n)).subtract(keep(keep(Manifold.cylinder(12, Math.max(1, so - 1.6), Math.max(1, so - 1.6), n)).translate([0, 0, -1]))));
      print.push(toMesh(coupon, sock.kind === 'socket' ? 'Fit test: body socket' : 'Fit test: body spigot', 'test', COLORS.test, 'Print first and try it on your pipe or mouthpiece before printing the body.'));
      if (res.mouthpiece.outlet === 'spigot') {
        const sr = res.mouthpiece.outletOuterR;
        const sp = keep(keep(Manifold.union([keep(Manifold.cylinder(3, sr + 3, sr + 3, n)), keep(keep(Manifold.cylinder(10, sr, sr, n)).translate([0, 0, 3]))])).subtract(keep(keep(Manifold.cylinder(15, sr - 1.6, sr - 1.6, n)).translate([0, 0, -1]))));
        print.push(toMesh(sp, 'Fit test: mouthpiece spigot', 'test', COLORS.test, 'Should slide into the socket test with a light push.'));
      }
    }

    const plates = arrange(print, d.bedX, d.bedY);

    return {
      preview,
      print,
      warnings,
      dowels: { count: dowels.length, length: 2 * d.dowelDepth - 0.5, diameter: d.dowelDiameter },
      cuts,
      bounds,
      plates,
    };
  } finally {
    for (const g of garbage) {
      try {
        g.delete();
      } catch {
        /* already freed */
      }
    }
  }

  function slabHalfFor() {
    return res.slabHalf;
  }

  // ----- helpers that need M
  /**
   * Flat body whose outline follows the bore. The outline is filleted so the
   * notches where one run of tube meets the next become smooth curves, and
   * the bell end is cut square so the bore opens.
   */
  function slab(path: Path, rad: (s: number) => number, half: number): Manifold {
    const ss = path.samples(4, Math.PI / 24);
    const segs = 48;
    const circles = ss.map((s) => {
      const { p } = path.at(s);
      return keep(keep(CrossSection.circle(rad(s), segs)).translate([p[0], p[1]]));
    });
    const hulls: ReturnType<typeof CrossSection.circle>[] = [];
    for (let i = 0; i + 1 < circles.length; i++) hulls.push(keep(CrossSection.hull([circles[i], circles[i + 1]])));
    let outline = keep(CrossSection.union(hulls));
    let minR = Infinity;
    for (const s of ss) minR = Math.min(minR, rad(s));
    const c = Math.max(3, minR);
    outline = keep(keep(outline.offset(c, 'Round', 2, 64)).offset(-c, 'Round', 2, 64));
    // Square off the bell end, just wider than the body there.
    const L = path.length;
    const e = path.at(L);
    const n: [number, number] = [-e.t[1], e.t[0]];
    const w = rad(L) + 0.3;
    const len = rad(L) + c + 2;
    const pt = (a: number, b: number): [number, number] => [e.p[0] + n[0] * a + e.t[0] * b, e.p[1] + n[1] * a + e.t[1] * b];
    let cut = [pt(-w, 0), pt(w, 0), pt(w, len), pt(-w, len)];
    if (signedArea(cut) < 0) cut = cut.reverse();
    outline = keep(outline.subtract(keep(new CrossSection([cut]))));
    return keep(keep(Manifold.extrude(outline, 2 * half)).translate([0, 0, -half]));
  }

  function toMesh(m: Manifold, name: string, role: PartMesh['role'], color: string, note?: string): PartMesh {
    const mesh = m.getMesh();
    const np = mesh.numProp;
    const nv = mesh.vertProperties.length / np;
    const positions = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) {
      positions[i * 3] = mesh.vertProperties[i * np];
      positions[i * 3 + 1] = mesh.vertProperties[i * np + 1];
      positions[i * 3 + 2] = mesh.vertProperties[i * np + 2];
    }
    const b = m.boundingBox();
    return {
      name,
      role,
      color,
      positions,
      indices: new Uint32Array(mesh.triVerts),
      volume: m.volume(),
      size: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]],
      note,
    };
  }
}

/**
 * Rest each print part on z = 0 and pack the parts onto bed-sized plates,
 * shelf by shelf. Plates sit side by side along +x, 30 mm apart.
 * Returns the origin of each plate.
 */
function arrange(parts: PartMesh[], bedX: number, bedY: number): [number, number][] {
  const gap = 6;
  const margin = 5;
  const plates: [number, number][] = [];
  type Shelf = { y: number; h: number; x: number };
  let shelves: Shelf[] = [];
  let plateUsedY = 0;
  const newPlate = () => {
    const x0 = plates.length * (bedX + 30);
    plates.push([x0, 0]);
    shelves = [];
    plateUsedY = margin;
  };
  newPlate();
  const bounds = (p: PartMesh) => {
    const min: V3 = [Infinity, Infinity, Infinity];
    const max: V3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.positions.length; i += 3)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], p.positions[i + k]);
        max[k] = Math.max(max[k], p.positions[i + k]);
      }
    return { min, max };
  };
  const rotate90 = (p: PartMesh) => {
    for (let i = 0; i < p.positions.length; i += 3) {
      const x = p.positions[i];
      p.positions[i] = -p.positions[i + 1];
      p.positions[i + 1] = x;
    }
    p.size = [p.size[1], p.size[0], p.size[2]];
  };
  const usableX = bedX - 2 * margin;
  const usableY = bedY - 2 * margin;
  // Long side along y when it fits that way; otherwise whichever way fits.
  for (const p of parts) {
    const fitsAsIs = p.size[0] <= usableX && p.size[1] <= usableY;
    const fitsTurned = p.size[1] <= usableX && p.size[0] <= usableY;
    if ((!fitsAsIs && fitsTurned) || (fitsAsIs && fitsTurned && p.size[0] > p.size[1])) rotate90(p);
  }
  const order = parts.slice().sort((a, b) => b.size[1] - a.size[1]);
  for (const p of order) {
    const [w, h] = [p.size[0], p.size[1]];
    let placed: [number, number] | null = null;
    for (const sh of shelves) {
      if (sh.x + w <= bedX - margin && h <= sh.h) {
        placed = [sh.x, sh.y];
        sh.x += w + gap;
        break;
      }
    }
    if (!placed) {
      if (plateUsedY + h > bedY - margin && shelves.length) newPlate();
      const sh: Shelf = { y: plateUsedY, h, x: margin };
      shelves.push(sh);
      plateUsedY += h + gap;
      placed = [sh.x, sh.y];
      sh.x += w + gap;
    }
    const b = bounds(p);
    const plate = plates[plates.length - 1];
    for (let i = 0; i < p.positions.length; i += 3) {
      p.positions[i] += plate[0] + placed[0] - b.min[0];
      p.positions[i + 1] += plate[1] + placed[1] - b.min[1];
      p.positions[i + 2] -= b.min[2];
    }
  }
  return plates;
}
