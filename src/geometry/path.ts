// A planar centre-line made of straight lines and circular arcs (XY plane, mm).

export type Vec2 = [number, number];

export type Piece =
  | { kind: 'line'; a: Vec2; b: Vec2 }
  | { kind: 'arc'; c: Vec2; R: number; a0: number; sweep: number }; // angles in radians

export function pieceLength(p: Piece): number {
  return p.kind === 'line' ? Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]) : Math.abs(p.sweep) * p.R;
}

function pieceAt(p: Piece, u: number): { p: Vec2; t: Vec2 } {
  if (p.kind === 'line') {
    const L = pieceLength(p) || 1;
    const t: Vec2 = [(p.b[0] - p.a[0]) / L, (p.b[1] - p.a[1]) / L];
    return { p: [p.a[0] + t[0] * u, p.a[1] + t[1] * u], t };
  }
  const ang = p.a0 + (p.sweep * u) / (Math.abs(p.sweep) * p.R);
  const dir = Math.sign(p.sweep);
  return {
    p: [p.c[0] + p.R * Math.cos(ang), p.c[1] + p.R * Math.sin(ang)],
    t: [-Math.sin(ang) * dir, Math.cos(ang) * dir],
  };
}

function reversePiece(p: Piece): Piece {
  if (p.kind === 'line') return { kind: 'line', a: p.b, b: p.a };
  return { kind: 'arc', c: p.c, R: p.R, a0: p.a0 + p.sweep, sweep: -p.sweep };
}

export class Path {
  pieces: Piece[] = [];
  starts: number[] = [];
  length = 0;

  constructor(pieces: Piece[] = []) {
    for (const p of pieces) this.push(p);
  }

  push(p: Piece) {
    const L = pieceLength(p);
    if (L < 1e-9) return;
    this.starts.push(this.length);
    this.pieces.push(p);
    this.length += L;
  }

  at(s: number): { p: Vec2; t: Vec2 } {
    const ss = Math.min(Math.max(s, 0), this.length);
    let i = this.pieces.length - 1;
    while (i > 0 && this.starts[i] > ss) i--;
    return pieceAt(this.pieces[i], ss - this.starts[i]);
  }

  /** Piece boundaries plus intermediate samples, as arc-length values. */
  samples(maxStep: number, maxAngle = Math.PI / 18, extra: number[] = []): number[] {
    const out: number[] = [];
    this.pieces.forEach((p, i) => {
      const L = pieceLength(p);
      const n = p.kind === 'arc' ? Math.max(2, Math.ceil(Math.abs(p.sweep) / maxAngle)) : Math.max(1, Math.ceil(L / maxStep));
      for (let k = 0; k < n; k++) out.push(this.starts[i] + (L * k) / n);
    });
    out.push(this.length);
    for (const e of extra) if (e > 0 && e < this.length) out.push(e);
    out.sort((a, b) => a - b);
    return out.filter((v, i) => i === 0 || v - out[i - 1] > 1e-3);
  }

  reversed(): Path {
    return new Path(this.pieces.slice().reverse().map(reversePiece));
  }

  isArcAt(s: number): boolean {
    let i = this.pieces.length - 1;
    while (i > 0 && this.starts[i] > s) i--;
    return this.pieces[i].kind === 'arc';
  }

  bounds(): { min: Vec2; max: Vec2 } {
    const min: Vec2 = [Infinity, Infinity];
    const max: Vec2 = [-Infinity, -Infinity];
    for (const s of this.samples(5, Math.PI / 36)) {
      const { p } = this.at(s);
      min[0] = Math.min(min[0], p[0]);
      min[1] = Math.min(min[1], p[1]);
      max[0] = Math.max(max[0], p[0]);
      max[1] = Math.max(max[1], p[1]);
    }
    return { min, max };
  }
}

/** Turtle for building paths: forward and turn by arcs. */
export class Turtle {
  pos: Vec2;
  heading: number; // radians
  path = new Path();

  constructor(pos: Vec2, heading: number) {
    this.pos = pos;
    this.heading = heading;
  }

  forward(L: number) {
    if (L <= 1e-9) return;
    const b: Vec2 = [this.pos[0] + Math.cos(this.heading) * L, this.pos[1] + Math.sin(this.heading) * L];
    this.path.push({ kind: 'line', a: this.pos, b });
    this.pos = b;
  }

  /** Turn by `angle` (positive = left/anticlockwise) on a bend of radius R. */
  turn(angle: number, R: number) {
    const left = angle > 0 ? 1 : -1;
    const nx = -Math.sin(this.heading) * left;
    const ny = Math.cos(this.heading) * left;
    const c: Vec2 = [this.pos[0] + nx * R, this.pos[1] + ny * R];
    const a0 = Math.atan2(this.pos[1] - c[1], this.pos[0] - c[0]);
    this.path.push({ kind: 'arc', c, R, a0, sweep: angle });
    const a1 = a0 + angle;
    this.pos = [c[0] + R * Math.cos(a1), c[1] + R * Math.sin(a1)];
    this.heading += angle;
  }
}
