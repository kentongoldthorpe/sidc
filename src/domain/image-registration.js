// Registering a photo or scan to the ground (Epic 6 E6-5, D48): from control points (a pixel on the
// image and its grid), the transform from image pixels to UTM metres.
//
//   3 points: affine (shift, rotation, scale, shear: a flat scan, or a photo taken square on);
//   4 or more: projective (also the perspective of a photo taken at an angle), by least squares.
// Each point's residual (metres between where its grid is and where the fit puts its pixel) and the
// RMS show how well the photo fits: one bad click or mistyped grid stands out.

/** Solve A x = b (n × n) by Gaussian elimination with partial pivoting; null when singular. */
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Least squares: minimise |A x − b| through the normal equations (AᵀA) x = Aᵀb. */
function leastSquares(A, b) {
  const n = A[0].length;
  const AtA = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => A.reduce((s, row) => s + row[i] * row[j], 0)));
  const Atb = Array.from({ length: n }, (_, i) => A.reduce((s, row, k) => s + row[i] * b[k], 0));
  return solve(AtA, Atb);
}

/**
 * Fit the transform from image pixels to ground metres.
 * @param {{ px: { x: number, y: number }, at: { e: number, n: number } }[]} points control points (≥ 3)
 * @returns {{ kind: 'affine'|'projective', apply(x: number, y: number): { e: number, n: number }, residuals: number[], rms: number } | { problem: string }}
 */
export function fitTransform(points) {
  if (!Array.isArray(points) || points.length < 3) return { problem: 'needs at least 3 points' };
  // Centre and scale the numbers so the equations are well conditioned.
  const mean = (f) => points.reduce((s, p) => s + f(p), 0) / points.length;
  const [cx, cy, ce, cn] = [mean((p) => p.px.x), mean((p) => p.px.y), mean((p) => p.at.e), mean((p) => p.at.n)];
  const sp = Math.max(1e-9, mean((p) => Math.hypot(p.px.x - cx, p.px.y - cy)));
  const sg = Math.max(1e-9, mean((p) => Math.hypot(p.at.e - ce, p.at.n - cn)));
  const P = points.map((p) => ({ x: (p.px.x - cx) / sp, y: (p.px.y - cy) / sp, e: (p.at.e - ce) / sg, n: (p.at.n - cn) / sg }));
  let apply;
  let kind;
  if (points.length < 4) {
    kind = 'affine';
    const A = P.map((p) => [p.x, p.y, 1]);
    const ex = solve(A, P.map((p) => p.e));
    const nx = solve(A, P.map((p) => p.n));
    if (!ex || !nx) return { problem: 'the points are in a line: spread them over the photo' };
    apply = (x, y) => ({ e: ex[0] * x + ex[1] * y + ex[2], n: nx[0] * x + nx[1] * y + nx[2] });
  } else {
    kind = 'projective';
    // e = (h0 x + h1 y + h2) / (h6 x + h7 y + 1), n = (h3 x + h4 y + h5) / (h6 x + h7 y + 1)
    const A = [];
    const b = [];
    for (const p of P) {
      A.push([p.x, p.y, 1, 0, 0, 0, -p.x * p.e, -p.y * p.e]); b.push(p.e);
      A.push([0, 0, 0, p.x, p.y, 1, -p.x * p.n, -p.y * p.n]); b.push(p.n);
    }
    const h = leastSquares(A, b);
    if (!h) return { problem: 'the points are in a line: spread them over the photo' };
    apply = (x, y) => { const w = h[6] * x + h[7] * y + 1; return { e: (h[0] * x + h[1] * y + h[2]) / w, n: (h[3] * x + h[4] * y + h[5]) / w }; };
  }
  const toGround = (x, y) => { const r = apply((x - cx) / sp, (y - cy) / sp); return { e: r.e * sg + ce, n: r.n * sg + cn }; };
  const residuals = points.map((p) => { const g = toGround(p.px.x, p.px.y); return Math.hypot(g.e - p.at.e, g.n - p.at.n); });
  const rms = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / residuals.length);
  return { kind, apply: toGround, residuals, rms };
}
