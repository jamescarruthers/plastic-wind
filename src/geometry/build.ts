// Builds the printable solids from the resolved design, solved bore and layout.

import type { Manifold } from 'manifold-3d';
import type { ManifoldToplevel } from './manifold';
import type { Resolved } from '../model/derive';
import { insertSpan, type SolveResult } from '../acoustics/solver';
import { PIPE_GROUP, type Layout } from './layout';
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
  /** Only when asked for: checks that the air path is open. */
  verify?: Verification;
}

export interface Verification {
  holes: { number: number; reachesBore: boolean; breaksOut: boolean }[];
  bellOpen: boolean;
  /** Places, other than the bell and inlet, where the bore breaks through the wall. */
  strayOpenings: number;
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

export async function buildInstrument(M: ManifoldToplevel, res: Resolved, sol: SolveResult, lay: Layout, opts: { verify?: boolean } = {}): Promise<BuildResult> {
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
    // The outside is round, sized so the wall over a pointed bore roof is
    // still a full wall thick. (A pointed outside would print no better and
    // its knife edge upsets the booleans.)
    const outerProf = round.pts;
    const roP = (s: number) => (shape === 'round' ? r(s) : r(s) * bp.scale * Math.SQRT2) + wall;
    const conical = res.body.type === 'conical';
    const bellStart = res.body.bellLength > 0 ? L - res.body.bellLength : L;
    // Pipe joining the upper block to the finger block: [start, end] along s.
    const jointSpan = res.joint ? insertSpan(res.body, L) : null;
    const jointR = (res.pipe.od + d.clearance) / 2; // socket bore for the joining pipe
    const jointDepth = d.socketDepth;
    const inJoint = (s: number) => !!jointSpan && s > jointSpan[0] + 1e-6 && s < jointSpan[1] - 1e-6;

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
     * Channel in front of the bell mouth, as wide as the bore there and
     * running out to the nearest other part of the instrument. Fillets,
     * gap plugs and flat bodies are kept out of it so the bell stays open,
     * even when it opens into a pocket between other parts.
     */
    const mouthChannel = (): ReturnType<typeof CrossSection.circle> => {
      const e = frame(L);
      const t: [number, number] = [e.t[0], e.t[1]];
      const nn: [number, number] = [-t[1], t[0]];
      const rb = r(L) * (shape === 'round' ? 1 : bp.scale) + 0.3;
      let len = 2 * roP(L) + 20;
      for (const sq of path.samples(3, Math.PI / 36)) {
        const q = path.at(sq).p;
        const dx = q[0] - e.p[0];
        const dy = q[1] - e.p[1];
        const ahead = dx * t[0] + dy * t[1];
        const side = Math.abs(dx * nn[0] + dy * nn[1]);
        if (ahead > 0 && side < rb + roP(sq)) len = Math.min(len, ahead - roP(sq) - 0.5);
      }
      len = Math.max(len, 1);
      const pt = (a: number, b: number): [number, number] => [e.p[0] + nn[0] * a + t[0] * b, e.p[1] + nn[1] * a + t[1] * b];
      let poly = [pt(-rb, -0.5), pt(rb, -0.5), pt(rb, len), pt(-rb, len)];
      if (signedArea(poly) < 0) poly = poly.reverse();
      return keep(new CrossSection([poly]));
    };

    /** The gap between the two blocks, between their socket mouths. */
    const jointKeepOut = (): ReturnType<typeof CrossSection.circle> | null => {
      if (!jointSpan) return null;
      const a = frame(jointSpan[0]);
      const b = frame(jointSpan[1]);
      const p0: [number, number] = [a.p[0] + a.t[0] * jointDepth, a.p[1] + a.t[1] * jointDepth];
      const p1: [number, number] = [b.p[0] - b.t[0] * jointDepth, b.p[1] - b.t[1] * jointDepth];
      const hw = jointR + Math.max(2.4, wall * 0.8) + 12;
      const n2: [number, number] = [-a.t[1], a.t[0]];
      let poly: [number, number][] = [
        [p0[0] + n2[0] * hw, p0[1] + n2[1] * hw],
        [p0[0] - n2[0] * hw, p0[1] - n2[1] * hw],
        [p1[0] - n2[0] * hw, p1[1] - n2[1] * hw],
        [p1[0] + n2[0] * hw, p1[1] + n2[1] * hw],
      ];
      if (signedArea(poly) < 0) poly = poly.reverse();
      return keep(new CrossSection([poly]));
    };

    /**
     * Flat body whose outline is one rectangle per feature of the air path
     * (the finger line, each loop, the folded legs, the upturned bell).
     * The ends stay flush with the inlet socket mouth and the bell opening.
     * `rounded` turns each rectangle into a rounded one and fillets the
     * inside corners.
     */
    const blocks = (rounded: boolean): Manifold => {
      type Box = { x0: number; y0: number; x1: number; y1: number; cy0: number; cy1: number; ends: End[] };
      type End = { at: [number, number]; dir: V3; hw: number };
      const fs = frame(0);
      const fe = frame(L);
      const sockDepth = res.socket.kind === 'socket' ? res.socket.depth : 0;
      const sr = res.socket.kind === 'socket' ? res.socket.r + Math.max(2.4, wall * 0.8) : 0;
      // Open ends of the bore, each with the direction it opens towards: the
      // block's outline stops flush there.
      const inletEnd: End = { at: [fs.p[0] - fs.t[0] * sockDepth, fs.p[1] - fs.t[1] * sockDepth], dir: [-fs.t[0], -fs.t[1], 0], hw: Math.max(sr, roP(0)) };
      const bellEnd: End = { at: [fe.p[0], fe.p[1]], dir: fe.t, hw: roP(L) };
      const jointEnds: End[] = [];
      if (jointSpan) {
        const jsr = jointR + Math.max(2.4, wall * 0.8);
        const a = frame(jointSpan[0]);
        const b = frame(jointSpan[1]);
        jointEnds.push({ at: [a.p[0] + a.t[0] * jointDepth, a.p[1] + a.t[1] * jointDepth], dir: a.t, hw: Math.max(jsr, roP(jointSpan[0])) });
        jointEnds.push({ at: [b.p[0] - b.t[0] * jointDepth, b.p[1] - b.t[1] * jointDepth], dir: [-b.t[0], -b.t[1], 0], hw: Math.max(jsr, roP(jointSpan[1])) });
      }
      const groups = new Map<number, Box>();
      path.pieces.forEach((pc, i) => {
        const g = pc.group ?? 0;
        if (g === PIPE_GROUP) return;
        const s0 = path.starts[i];
        const s1 = i + 1 < path.pieces.length ? path.starts[i + 1] : L;
        const b = groups.get(g) ?? { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, cy0: Infinity, cy1: -Infinity, ends: [] };
        // Bounds of the tube itself, using the local radius at each point,
        // so a flared bell does not widen the block along its whole length.
        for (const s of [s0, ...sampleS(s0, s1), s1]) {
          const p = path.at(s).p;
          const m = roP(s);
          b.x0 = Math.min(b.x0, p[0] - m);
          b.x1 = Math.max(b.x1, p[0] + m);
          b.y0 = Math.min(b.y0, p[1] - m);
          b.y1 = Math.max(b.y1, p[1] + m);
          b.cy0 = Math.min(b.cy0, p[1]);
          b.cy1 = Math.max(b.cy1, p[1]);
        }
        if (i === 0) b.ends.push(inletEnd);
        if (i === path.pieces.length - 1) b.ends.push(bellEnd);
        if (jointSpan && Math.abs(s1 - jointSpan[0]) < 1e-6) b.ends.push(jointEnds[0]);
        if (jointSpan && Math.abs(s0 - jointSpan[1]) < 1e-6) b.ends.push(jointEnds[1]);
        groups.set(g, b);
      });
      type Rect = { x0: number; y0: number; x1: number; y1: number };
      // Pull one side of a rectangle in to a given coordinate, on the axis
      // the end of the bore points along.
      const clampTo = (q: Rect, e: End) => {
        if (e.dir[1] > 0.9) q.y1 = e.at[1];
        else if (e.dir[1] < -0.9) q.y0 = e.at[1];
        else if (e.dir[0] > 0.9) q.x1 = e.at[0];
        else if (e.dir[0] < -0.9) q.x0 = e.at[0];
      };
      // Rectangle from an end back into the body by `depth`, `hw` either side.
      const endRect = (e: End, depth: number, hw: number): Rect => {
        const bx = e.at[0] - e.dir[0] * depth;
        const by = e.at[1] - e.dir[1] * depth;
        return Math.abs(e.dir[1]) > 0.5
          ? { x0: e.at[0] - hw, x1: e.at[0] + hw, y0: Math.min(e.at[1], by), y1: Math.max(e.at[1], by) }
          : { x0: Math.min(e.at[0], bx), x1: Math.max(e.at[0], bx), y0: e.at[1] - hw, y1: e.at[1] + hw };
      };
      const rects: Rect[] = [];
      for (const [g, b] of groups) {
        const q: Rect = { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 };
        // The bell block starts where the bell section starts; the crossover
        // block above the finger section stops at its top.
        if (g === 3) q.y1 = b.cy1;
        if (g === 4) q.y0 = b.cy0;
        for (const e of b.ends) clampTo(q, e);
        rects.push(q);
      }
      // Blocks around the sockets.
      if (sr > 0) rects.push(endRect(inletEnd, sockDepth, sr));
      for (const e of jointEnds) rects.push(endRect(e, jointDepth, e.hw));
      const toCs = (q: Rect) => keep(new CrossSection([[[q.x0, q.y0], [q.x1, q.y0], [q.x1, q.y1], [q.x0, q.y1]]]));
      const shapes = rects.map((q) => {
        const cs = toCs(q);
        if (!rounded) return cs;
        const rr = Math.min(14, (0.9 * Math.min(q.x1 - q.x0, q.y1 - q.y0)) / 2);
        return keep(keep(cs.offset(-rr, 'Round', 2, 48)).offset(rr, 'Round', 2, 48));
      });
      let outline = keep(CrossSection.union(shapes));
      if (rounded) {
        // Fillet the inside corners, then square the ends back off so each
        // opening keeps a full wall around it.
        const c = 5;
        outline = keep(keep(outline.offset(c, 'Round', 2, 48)).offset(-c, 'Round', 2, 48));
        const ends = [inletEnd, bellEnd, ...jointEnds];
        outline = keep(CrossSection.union([outline, ...ends.map((e) => toCs(endRect(e, e.hw, e.hw)))]));
      }
      if (jointEnds.length === 2) {
        // Keep the gap between the blocks clear: the pipe shows there.
        const [a, b] = jointEnds;
        const hw = Math.max(a.hw, b.hw) + 8;
        const gap: Rect = Math.abs(a.dir[1]) > 0.5
          ? { x0: a.at[0] - hw, x1: a.at[0] + hw, y0: Math.min(a.at[1], b.at[1]), y1: Math.max(a.at[1], b.at[1]) }
          : { x0: Math.min(a.at[0], b.at[0]), x1: Math.max(a.at[0], b.at[0]), y0: a.at[1] - hw, y1: a.at[1] + hw };
        outline = keep(outline.subtract(toCs(gap)));
      }
      outline = keep(outline.subtract(mouthChannel()));
      const half = slabHalfFor();
      return keep(keep(Manifold.extrude(outline, 2 * half)).translate([0, 0, -half]));
    };

    // ---------------- Outer body
    const outerParts: Manifold[] = [];
    const cavities: Manifold[] = [];
    if (d.bodyStyle === 'slab') {
      outerParts.push(slab(path, ro, slabHalfFor(), mouthChannel(), inJoint, jointKeepOut()));
    } else if (d.bodyStyle === 'blocks' || d.bodyStyle === 'rounded') {
      outerParts.push(blocks(d.bodyStyle === 'rounded'));
    } else {
      // All pieces take their cross-sections from one shared list, and each
      // reaches one section into its neighbours. Where two pieces overlap
      // their surfaces are then identical, which the union handles exactly;
      // slightly different surfaces would leave slivers.
      const shared = sampleS(0, L);
      path.pieces.forEach((pc, i) => {
        if ((pc.group ?? 0) === PIPE_GROUP) return; // the joining pipe has no body
        const a = path.starts[i];
        const b = i + 1 < path.pieces.length ? path.starts[i + 1] : L;
        let lo = shared.findIndex((s) => s >= a - 1e-6);
        let hi = shared.length - 1;
        while (hi > 0 && shared[hi] > b + 1e-6) hi--;
        lo = Math.max(0, lo - 1);
        hi = Math.min(shared.length - 1, hi + 1);
        const ss = shared.slice(lo, hi + 1).filter((x) => !inJoint(x));
        let rmax = 0;
        for (const s of ss) rmax = Math.max(rmax, roP(s));
        if (pc.kind === 'arc' && pc.R < rmax * 1.05) {
          // Tight bend: its convex hull is solid and fills the inside of the U.
          const pts: V3[] = [];
          for (const s of ss) pts.push(...ringPts(s, roP(s), outerProf));
          outerParts.push(hullOf(pts));
        } else {
          outerParts.push(sweep(ss, roP, outerProf));
        }
      });
      if (d.bodyStyle === 'web' && (lay.legs > 0 || lay.loops > 0)) {
        let rmin = Infinity;
        for (const s of sampleS(0, L)) rmin = Math.min(rmin, r(s));
        outerParts.push(slab(path, ro, (rmin + wall) * 0.7, mouthChannel(), inJoint, jointKeepOut()));
      }
    }

    // Inlet fitting
    const f0 = frame(0);
    const back: V3 = [-f0.t[0], -f0.t[1], 0];
    const sock = res.socket;
    let socketCavity: Manifold | null = null;
    // A socket at path position `at`, opening towards +t (opens = 1) or -t.
    // Returns the socket's cavity.
    const addSocket = (at: number, opens: 1 | -1, rS: number, depth: number): Manifold => {
      const f = frame(at);
      const out: V3 = [f.t[0] * opens, f.t[1] * opens, 0];
      const inward: V3 = [-out[0], -out[1], 0];
      // Wide enough to cover the pointed top of the bore where it starts.
      const apex = shape === 'round' ? 0 : roP(at) + 0.5;
      const sr = Math.max(rS + Math.max(2.4, wall * 0.8), apex);
      const mouth: V3 = [f.p[0] + out[0] * depth, f.p[1] + out[1] * depth, 0];
      outerParts.push(cylAlong(mouth, inward, depth + 0.01, sr));
      if (sr > roP(at)) {
        // 45° shoulder down to the body
        const s2 = at - opens * (sr - roP(at));
        outerParts.push(hullOf([...ringPts(at, sr, round.pts), ...ringPts(s2, roP(s2), outerProf)]));
      }
      const lip: V3 = [mouth[0] + out[0], mouth[1] + out[1], 0];
      const cavity = cylAlong(lip, inward, depth + 1, rS);
      cavities.push(cavity);
      // Lead-in chamfer
      cavities.push(cylAlong(lip, inward, 1.8, rS + 0.8, rS));
      return cavity;
    };
    const jointCavities: Manifold[] = [];
    if (jointSpan) {
      jointCavities.push(addSocket(jointSpan[0], 1, jointR, jointDepth));
      jointCavities.push(addSocket(jointSpan[1], -1, jointR, jointDepth));
    }
    if (sock.kind === 'socket') {
      socketCavity = addSocket(0, -1, sock.r, sock.depth);
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
        if (jointSpan && s > jointSpan[0] - jointDepth - 6 && s < jointSpan[1] + jointDepth + 6) continue;
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
    const boreCavity = sweep([ext0, ...boreSS, L + 1], boreR, bp.pts, (s) => (s < 0 ? round.pts : bp.pts));
    cavities.push(boreCavity);
    const holeCavities: Manifold[] = [];
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
        surf = isFlatStyle(d.bodyStyle) ? slabHalf : roP(h.s);
      } else {
        surf = d.bodyStyle === 'blocks' || d.bodyStyle === 'rounded' ? spineMargin : d.bodyStyle === 'slab' ? ro(h.s) : roP(h.s);
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
      const placed = keep(hm.translate([h.pos[0], h.pos[1], 0]));
      holeCavities.push(placed);
      cavities.push(placed);
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
        const plug = keep(keep(new CrossSection(holes.map((pl) => pl.slice().reverse()))).subtract(mouthChannel()));
        const plugM = keep(keep(Manifold.extrude(keep(plug.offset(0.3)), T)).translate([0, 0, -T / 2]));
        outer = keep(Manifold.union(outer, plugM));
      }
    }
    const cav = union(cavities);
    const solid = keep(outer.subtract(cav));
    let verify: Verification | undefined;
    if (opts.verify) {
      // The bore must break out of the body only at the inlet and the bell,
      // and every tone hole must meet the bore and break out of the body.
      const bore = boreCavity;
      const fEnd = frame(L).p;
      const near = (m: Manifold, p: V3, d: number) => {
        const b = m.boundingBox();
        const cx = Math.max(b.min[0], Math.min(p[0], b.max[0]));
        const cy = Math.max(b.min[1], Math.min(p[1], b.max[1]));
        return Math.hypot(cx - p[0], cy - p[1]) < d;
      };
      let outside = keep(bore.subtract(outer));
      if (socketCavity) outside = keep(outside.subtract(socketCavity));
      for (const jc of jointCavities) outside = keep(outside.subtract(jc));
      const pieces = outside.decompose().map((c) => keep(c)).filter((c) => c.volume() > 0.5);
      const rEnd = r(L) * 2 + 5;
      const bellOpen = pieces.some((c) => near(c, fEnd, rEnd));
      // Where the joining pipe runs, the bore is meant to be outside the body.
      const jointMid: V3 | null = jointSpan ? frame((jointSpan[0] + jointSpan[1]) / 2).p : null;
      const jointReach = jointSpan ? (jointSpan[1] - jointSpan[0]) / 2 + 2 : 0;
      const strayOpenings = pieces.filter(
        (c) => !near(c, fEnd, rEnd) && !near(c, f0.p, sock.depth + r(0) * 2 + 5) && !(jointMid && near(c, jointMid, jointReach)),
      ).length;
      verify = {
        holes: lay.holes.map((h, i) => ({
          number: h.number,
          reachesBore: keep(holeCavities[i].intersect(bore)).volume() > 0.5,
          breaksOut: keep(holeCavities[i].subtract(outer)).volume() > 0.5,
        })),
        bellOpen,
        strayOpenings,
      };
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

    // Bodies to print: one, or the upper and finger blocks when a pipe joins
    // them. The blocks are separate pieces of the solid already.
    const bodies: { name: string; solid: Manifold }[] = [];
    if (jointSpan) {
      const comps = solid.decompose().map((c) => keep(c));
      const inletPt = frame(0).p;
      const holds = (m: Manifold, q: V3) => {
        const b = m.boundingBox();
        return q[0] >= b.min[0] - 0.01 && q[0] <= b.max[0] + 0.01 && q[1] >= b.min[1] - 0.01 && q[1] <= b.max[1] + 0.01;
      };
      const upper = comps.filter((c) => holds(c, inletPt));
      const lower = comps.filter((c) => !holds(c, inletPt));
      if (upper.length && lower.length) {
        bodies.push({ name: 'Upper block', solid: union(upper) });
        bodies.push({ name: 'Finger block', solid: union(lower) });
      } else {
        warnings.push('The upper and finger blocks touch, so they print as one body. Use a longer joining pipe.');
        bodies.push({ name: 'Body', solid });
      }
    } else {
      bodies.push({ name: 'Body', solid });
    }

    for (const body of bodies) {
      // "Body front half" becomes "Upper block front half", and so on.
      const label = (rest: string) =>
        bodies.length === 1 ? rest : rest.startsWith('Body') ? body.name + rest.slice(4) : `${body.name} ${rest.charAt(0).toLowerCase()}${rest.slice(1)}`;
      const bbb = body.solid.boundingBox();
      if (split) {
        const front = keep(body.solid.trimByPlane([0, 0, 1], 0));
        const backH = keep(body.solid.trimByPlane([0, 0, -1], 0));
        preview.push(toMesh(pv(front), label('Body front half'), 'body', COLORS.front));
        preview.push(toMesh(pv(backH), label('Body back half'), 'body', COLORS.back));
        const w = bbb.max[0] - bbb.min[0];
        const h = bbb.max[1] - bbb.min[1];
        // Try both ways round on the bed and keep the one with fewer pieces.
        const count = (lx: number, ly: number) => Math.ceil(w / lx) * Math.ceil(h / ly);
        const [lx, ly] = count(bedMin, bedMax) <= count(bedMax, bedMin) ? [bedMin, bedMax] : [bedMax, bedMin];
        const fits = w <= lx && h <= ly;
        let fronts = [front];
        let backs = [backH];
        if (!fits && d.segment) {
          // The back half is cut half a section later, so the joints overlap like brickwork.
          const fy = cutPositions(1, bbb.min[1], bbb.max[1], ly * 0.95);
          const by = cutPositions(1, bbb.min[1], bbb.max[1], ly * 0.95, true);
          const fx = cutPositions(0, bbb.min[0], bbb.max[0], lx * 0.95);
          const bx = cutPositions(0, bbb.min[0], bbb.max[0], lx * 0.95, fy.length === 0);
          fronts = cutAlong(cutAlong([front], 1, fy), 0, fx);
          backs = cutAlong(cutAlong([backH], 1, by), 0, bx);
          cuts = fy.length + by.length + fx.length + bx.length;
        } else if (!fits) {
          warnings.push('The halves do not fit the bed. Turn on "Cut to fit the bed".');
        }
        fronts.forEach((m, i) => print.push(toMesh(m, label(`Front half${fronts.length > 1 ? ` ${i + 1}/${fronts.length}` : ''}`), 'body', COLORS.front, 'Print cut face down.')));
        backs.forEach((m, i) => {
          const flipped = keep(m.rotate([0, 180, 0]));
          print.push(toMesh(flipped, label(`Back half${backs.length > 1 ? ` ${i + 1}/${backs.length}` : ''}`), 'body', COLORS.back, 'Print cut face down.'));
        });
      } else {
        preview.push(toMesh(pv(body.solid), label('Body'), 'body', COLORS.body));
        if (lyingOnePiece) {
          print.push(toMesh(body.solid, label('Body'), 'body', COLORS.body, 'Print lying flat on its back with supports under the curved underside only.'));
          if (Math.max(bbb.max[0] - bbb.min[0], bbb.max[1] - bbb.min[1]) > bedMax) warnings.push('The one-piece folded body is larger than the bed. Use split halves to cut it.');
        } else {
          // Standing up: the bore axis (y) becomes z.
          const H = bbb.max[1] - bbb.min[1];
          let pieces = [body.solid];
          if (H > d.bedZ - 5 && d.segment) {
            if (wall < 2.4) warnings.push('Walls under 2.4 mm make weak joints between sections.');
            const ys = cutPositions(1, bbb.min[1], bbb.max[1], d.bedZ - 5 - d.jointLength);
            pieces = jointedSections(ys, bbb);
            cuts = ys.length;
          } else if (H > d.bedZ - 5) {
            warnings.push(`The body is ${H.toFixed(0)} mm tall; the bed allows ${d.bedZ} mm. Turn on cutting or split into halves.`);
          }
          pieces.forEach((m, i) => {
            const up = keep(m.rotate([90, 0, 0]));
            print.push(toMesh(up, label(`Body${pieces.length > 1 ? ` section ${i + 1}/${pieces.length}` : ''}`), 'body', COLORS.body, 'Print standing, bell end down.'));
          });
        }
      }

    }

    function jointedSections(ys: number[], within: { min: V3; max: V3 }): Manifold[] {
      // Sections joined by a spigot on the upper piece and a socket in the lower.
      const out: Manifold[] = [];
      const box = keep(
        keep(Manifold.cube([within.max[0] - within.min[0] + 2, within.max[1] - within.min[1] + 2, within.max[2] - within.min[2] + 2])).translate([within.min[0] - 1, within.min[1] - 1, within.min[2] - 1]),
      );
      let rest = keep(outer.intersect(box));
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
    if (jointSpan) {
      // The pipe joining the blocks runs from one socket bottom to the other.
      const a = frame(jointSpan[0]);
      const len = jointSpan[1] - jointSpan[0];
      const ring = keep(cylAlong(a.p, a.t, len, res.pipe.od / 2).subtract(cylAlong([a.p[0] - a.t[0], a.p[1] - a.t[1], 0], a.t, len + 2, res.pipe.id_ / 2)));
      preview.push(toMesh(pv(ring), `Joining pipe (${res.pipe.label})`, 'pipe', COLORS.pipe));
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
      verify,
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
  function slab(
    path: Path,
    rad: (s: number) => number,
    half: number,
    keepOut?: ReturnType<typeof CrossSection.circle>,
    skip: (s: number) => boolean = () => false,
    gapKeepOut?: ReturnType<typeof CrossSection.circle> | null,
  ): Manifold {
    const ss = path.samples(4, Math.PI / 24).filter((s) => !skip(s));
    const segs = 48;
    const circles = ss.map((s) => {
      const { p } = path.at(s);
      return keep(keep(CrossSection.circle(rad(s), segs)).translate([p[0], p[1]]));
    });
    const hulls: ReturnType<typeof CrossSection.circle>[] = [];
    for (let i = 0; i + 1 < circles.length; i++) {
      // Do not bridge the gap where the joining pipe runs.
      if (ss[i + 1] - ss[i] > 8 && skip((ss[i] + ss[i + 1]) / 2)) continue;
      hulls.push(keep(CrossSection.hull([circles[i], circles[i + 1]])));
    }
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
    if (keepOut) outline = keep(outline.subtract(keepOut));
    if (gapKeepOut) outline = keep(outline.subtract(gapKeepOut));
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
