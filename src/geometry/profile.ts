// Bore cross-sections shared by the body and the printed pipe fittings.

/** Unit cross-section of the bore. "lemon" is pointed at ±z, "drop" at +z only,
 *  with the radius scaled so the area matches a circle of the nominal radius. */
export function boreProfile(shape: 'round' | 'lemon' | 'drop', n: number): { pts: [number, number][]; scale: number } {
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

