// Plane-wave transfer-matrix model of a woodwind air column.
// SI units (m, Hz, Pa·s/m³). Time convention e^{jωt}.
//
// The bore is a chain of cylinders (cones are sliced into short cylinders),
// with tone holes as shunt/series impedances (Keefe; Lefebvre & Scavone 2012
// length corrections). The reed end is closed; the playing frequencies are
// taken as the peaks of the input impedance magnitude.

export interface Air {
  c: number;
  rho: number;
  mu: number;
}

export function airAt(tempC: number): Air {
  const T = tempC + 273.15;
  return {
    c: 331.45 * Math.sqrt(T / 273.15),
    rho: 1.2041 * (293.15 / T),
    mu: 1.846e-5 * (1 + 0.0025 * (T - 300)),
  };
}

/** Element of the network, listed from the open (bell) end towards the reed. */
export type Element =
  | { kind: 'seg'; L: number; a: number }
  | { kind: 'hole'; a: number; b: number; t: number; open: boolean };

export interface Network {
  air: Air;
  endRadius: number; // radius at the radiating open end
  elements: Element[]; // from open end to input
  inputRadius: number;
  inputCorrection: number; // extra closed length at the input (reed volume), m
}

type C = [number, number];

const cadd = (a: C, b: C): C => [a[0] + b[0], a[1] + b[1]];
const cmul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cdiv = (a: C, b: C): C => {
  const d = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
};
const cinv = (a: C): C => {
  const d = a[0] * a[0] + a[1] * a[1];
  return [a[0] / d, -a[1] / d];
};

/** Lossy wavenumber β - jα for a tube of radius a. Returns [β, α]. */
function wavenumber(air: Air, omega: number, a: number): [number, number] {
  const rv = a * Math.sqrt((air.rho * omega) / air.mu);
  const k0 = omega / air.c;
  const beta = k0 * (1 + 1.045 / rv);
  const alpha = k0 * (1.045 / rv + 1.08 / (rv * rv));
  return [beta, alpha];
}

/** Impedance seen at the upstream end of a cylinder loaded by Z downstream. */
function throughCylinder(air: Air, omega: number, L: number, a: number, Z: C): C {
  const [beta, alpha] = wavenumber(air, omega, a);
  const Zc = (air.rho * air.c) / (Math.PI * a * a);
  const x = beta * L;
  const y = alpha * L;
  const ch = Math.cosh(y);
  const sh = Math.sinh(y);
  const cos: C = [Math.cos(x) * ch, Math.sin(x) * sh];
  const sin: C = [Math.sin(x) * ch, -Math.cos(x) * sh];
  // (cos Z + j Zc sin) / (j sin Z / Zc + cos)
  const jsin: C = [-sin[1], sin[0]];
  const num = cadd(cmul(cos, Z), [jsin[0] * Zc, jsin[1] * Zc]);
  const den = cadd(cmul([jsin[0] / Zc, jsin[1] / Zc], Z), cos);
  return cdiv(num, den);
}

/** Radiation impedance of an unflanged open end (low-frequency form). */
function radiation(air: Air, omega: number, a: number, endCorr = 0.6133): C {
  const k = omega / air.c;
  const Zc = (air.rho * air.c) / (Math.PI * a * a);
  const ka = Math.min(k * a, 2);
  return [Zc * 0.25 * ka * ka, Zc * endCorr * ka];
}

/** Tone hole length corrections (Lefebvre & Scavone 2012). Values in m. */
export function holeCorrections(a: number, b: number) {
  const d = b / a;
  const ti = b * (0.822 - 0.095 * d - 1.566 * d * d + 2.138 * d ** 3 - 1.64 * d ** 4 + 0.502 * d ** 5);
  const tm = (b * d * (1 + 0.207 * d ** 3)) / 8;
  const taOpen = b * d * d * (-0.37 + 0.087 * d);
  const taClosed = b * d * d * -0.2;
  return { ti, tm, taOpen, taClosed };
}

function throughHole(air: Air, omega: number, h: Extract<Element, { kind: 'hole' }>, Z: C): C {
  const { a, b, t, open } = h;
  const { ti, tm, taOpen, taClosed } = holeCorrections(a, b);
  const Zch = (air.rho * air.c) / (Math.PI * b * b);
  const k = omega / air.c;
  const tEff = t + tm;
  let Zs: C;
  if (open) {
    const Zr = radiation(air, omega, b, 0.7);
    Zs = throughCylinder(air, omega, tEff, b, Zr);
    Zs = cadd(Zs, [0, k * Zch * ti]);
  } else {
    // Closed chimney: -j Zch cot(k t) plus the inner inertance.
    const [beta, alpha] = wavenumber(air, omega, b);
    const x = beta * tEff;
    const y = alpha * tEff;
    const cos: C = [Math.cos(x) * Math.cosh(y), Math.sin(x) * Math.sinh(y)];
    const sin: C = [Math.sin(x) * Math.cosh(y), -Math.cos(x) * Math.sinh(y)];
    Zs = cdiv([Zch * cos[0], Zch * cos[1]], [-sin[1], sin[0]]);
    Zs = cadd(Zs, [0, k * Zch * ti]);
  }
  const ta = open ? taOpen : taClosed;
  const Za2: C = [0, (k * Zch * ta) / 2];
  const Z1 = cadd(Z, Za2);
  const Z2 = cinv(cadd(cinv(Z1), cinv(Zs)));
  return cadd(Z2, Za2);
}

/** Input impedance magnitude at the reed. */
export function inputImpedance(net: Network, f: number): C {
  const omega = 2 * Math.PI * f;
  const { air } = net;
  let Z = radiation(air, omega, net.endRadius);
  for (const e of net.elements) {
    Z = e.kind === 'seg' ? throughCylinder(air, omega, e.L, e.a, Z) : throughHole(air, omega, e, Z);
  }
  if (net.inputCorrection > 0) {
    // Reed/mouthpiece volume in parallel with the air column.
    const V = Math.PI * net.inputRadius ** 2 * net.inputCorrection;
    const Yv: C = [0, (omega * V) / (air.rho * air.c * air.c)];
    Z = cinv(cadd(cinv(Z), Yv));
  }
  return Z;
}

export function impedanceMag(net: Network, f: number): number {
  const z = inputImpedance(net, f);
  return Math.hypot(z[0], z[1]);
}

export interface Peak {
  f: number;
  mag: number;
}

/** All local maxima of |Z| between fLo and fHi, refined. */
export function findPeaks(net: Network, fLo: number, fHi: number, stepCents = 12): Peak[] {
  const r = Math.pow(2, stepCents / 1200);
  const fs: number[] = [];
  const ms: number[] = [];
  for (let f = fLo; f <= fHi * r; f *= r) {
    fs.push(f);
    ms.push(impedanceMag(net, f));
  }
  const peaks: Peak[] = [];
  for (let i = 1; i < fs.length - 1; i++) {
    if (ms[i] > ms[i - 1] && ms[i] >= ms[i + 1]) peaks.push(refinePeak(net, fs[i - 1], fs[i + 1]));
  }
  return peaks;
}

/** Golden-section search for the maximum of |Z| in [a, b] (log frequency). */
export function refinePeak(net: Network, fa: number, fb: number): Peak {
  let a = Math.log(fa);
  let b = Math.log(fb);
  const g = (Math.sqrt(5) - 1) / 2;
  let x1 = b - g * (b - a);
  let x2 = a + g * (b - a);
  let m1 = impedanceMag(net, Math.exp(x1));
  let m2 = impedanceMag(net, Math.exp(x2));
  for (let i = 0; i < 22; i++) {
    if (m1 > m2) {
      b = x2;
      x2 = x1;
      m2 = m1;
      x1 = b - g * (b - a);
      m1 = impedanceMag(net, Math.exp(x1));
    } else {
      a = x1;
      x1 = x2;
      m1 = m2;
      x2 = a + g * (b - a);
      m2 = impedanceMag(net, Math.exp(x2));
    }
  }
  const x = (a + b) / 2;
  return { f: Math.exp(x), mag: impedanceMag(net, Math.exp(x)) };
}

/** Lowest prominent resonance above fLo. */
export function firstResonance(net: Network, fLo: number, fHi: number): Peak | null {
  const peaks = findPeaks(net, fLo, fHi, 15);
  if (!peaks.length) return null;
  const max = Math.max(...peaks.map((p) => p.mag));
  return peaks.find((p) => p.mag >= 0.2 * max) ?? peaks[0];
}

/** Prominent resonance nearest (in cents) to fGuess, searching ±windowCents. */
export function resonanceNear(net: Network, fGuess: number, windowCents = 250): Peak | null {
  const w = Math.pow(2, windowCents / 1200);
  const peaks = findPeaks(net, fGuess / w, fGuess * w, 10);
  if (!peaks.length) return null;
  let best = peaks[0];
  for (const p of peaks) if (Math.abs(Math.log(p.f / fGuess)) < Math.abs(Math.log(best.f / fGuess))) best = p;
  return best;
}
