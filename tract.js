// tract.js — the mid-sagittal vocal tract around six EMA sensors (MNGU0 frame, cm), after anatomy.py / the Hold My Jaw page's
// src/head2d/anatomy.ts. Only the six sensor positions and the palate hull are data; every outline is schematic.
// Drawing frame: x flipped so the face points to +x; in 3D the drawing (x, y) is (Z, Y) on the mid-sagittal plane X = 0.

export const SENS = { TD: 0, TB: 2, TT: 4, LI: 6, UL: 8, LL: 10 };
export const TMJ = [-8.4, 1.1];
export const LA_CLOSED = 1.85;

function solve(A, b) {
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (p !== c) { [A[p], A[c]] = [A[c], A[p]]; [b[p], b[c]] = [b[c], b[p]]; }
    const d = A[c][c];
    for (let r = c + 1; r < n; r++) {
      const m = A[r][c] / d; if (m === 0) continue;
      for (let k = c; k < n; k++) A[r][k] -= m * A[c][k];
      b[r] -= m * b[c];
    }
  }
  for (let r = n - 1; r >= 0; r--) { let s = b[r]; for (let k = r + 1; k < n; k++) s -= A[r][k] * b[k]; b[r] = s / A[r][r]; }
  return b;
}

function slopes(u, y, m, closed) {
  const h = new Float64Array(m - 1), d = new Float64Array(m - 1);
  for (let i = 0; i < m - 1; i++) { h[i] = u[i + 1] - u[i]; d[i] = (y[i + 1] - y[i]) / h[i]; }
  if (closed) {
    const n = m - 1, A = Array.from({ length: n }, () => new Float64Array(n)), b = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = (i + n - 1) % n, c = (i + 1) % n;
      A[i][a] += h[i]; A[i][i] += 2 * (h[a] + h[i]); A[i][c] += h[a];
      b[i] = 3 * (h[i] * d[a] + h[a] * d[i]);
    }
    const s = solve(A, b), out = new Float64Array(m); out.set(s); out[m - 1] = s[0]; return out;
  }
  const A = Array.from({ length: m }, () => new Float64Array(m)), b = new Float64Array(m);
  for (let i = 1; i < m - 1; i++) {
    A[i][i - 1] = h[i]; A[i][i] = 2 * (h[i - 1] + h[i]); A[i][i + 1] = h[i - 1];
    b[i] = 3 * (h[i] * d[i - 1] + h[i - 1] * d[i]);
  }
  let w = u[2] - u[0];
  A[0][0] = h[1]; A[0][1] = w; b[0] = ((h[0] + 2 * w) * h[1] * d[0] + h[0] * h[0] * d[1]) / w;
  w = u[m - 1] - u[m - 3];
  A[m - 1][m - 1] = h[m - 3]; A[m - 1][m - 2] = w; b[m - 1] = (h[m - 2] * h[m - 2] * d[m - 3] + (2 * w + h[m - 2]) * h[m - 3] * d[m - 2]) / w;
  return solve(A, b);
}

/** smooth interpolating cubic through the points P (flat x, y pairs), as n points; closed: back to the first point */
export function smooth(P, n = 80, closed = false) {
  let m = P.length >> 1;
  const X = new Float64Array(m + 1), Y = new Float64Array(m + 1);
  for (let i = 0; i < m; i++) { X[i] = P[2 * i]; Y[i] = P[2 * i + 1]; }
  if (closed) { X[m] = X[0]; Y[m] = Y[0]; m += 1; }
  const u = new Float64Array(m);
  for (let i = 1; i < m; i++) u[i] = u[i - 1] + (Math.hypot(X[i] - X[i - 1], Y[i] - Y[i - 1]) || 1e-9);
  const L = u[m - 1]; for (let i = 0; i < m; i++) u[i] /= L; u[m - 1] = 1;
  const out = new Float64Array(2 * n);
  if (m <= 3 && !closed) {
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1);
      if (m === 2) { out[2 * k] = X[0] + (X[1] - X[0]) * t; out[2 * k + 1] = Y[0] + (Y[1] - Y[0]) * t; continue; }
      const a = (t - u[1]) * (t - u[2]) / ((u[0] - u[1]) * (u[0] - u[2])), b = (t - u[0]) * (t - u[2]) / ((u[1] - u[0]) * (u[1] - u[2])),
        c = (t - u[0]) * (t - u[1]) / ((u[2] - u[0]) * (u[2] - u[1]));
      out[2 * k] = a * X[0] + b * X[1] + c * X[2]; out[2 * k + 1] = a * Y[0] + b * Y[1] + c * Y[2];
    }
    return out;
  }
  const sx = slopes(u, X, m, closed), sy = slopes(u, Y, m, closed);
  let i = 0;
  for (let k = 0; k < n; k++) {
    const t = k === n - 1 ? 1 : k / (n - 1);
    while (i < m - 2 && t > u[i + 1]) i += 1;
    const h = u[i + 1] - u[i], r = (t - u[i]) / h, r2 = r * r, r3 = r2 * r;
    const a = 2 * r3 - 3 * r2 + 1, b = (r3 - 2 * r2 + r) * h, c = -2 * r3 + 3 * r2, e = (r3 - r2) * h;
    out[2 * k] = a * X[i] + b * sx[i] + c * X[i + 1] + e * sx[i + 1];
    out[2 * k + 1] = a * Y[i] + b * sy[i] + c * Y[i + 1] + e * sy[i + 1];
  }
  return out;
}

export function sensors(z) {
  const o = {};
  for (const k of Object.keys(SENS)) o[k] = [-z[SENS[k]], z[SENS[k] + 1]];
  return o;
}

export function jawTransform(LI, LI0) {
  const a0 = Math.atan2(LI0[1] - TMJ[1], LI0[0] - TMJ[0]), th = Math.atan2(LI[1] - TMJ[1], LI[0] - TMJ[0]) - a0;
  const c = Math.cos(th), s = Math.sin(th), x = LI0[0] - TMJ[0], y = LI0[1] - TMJ[1];
  return { th, c, s, tx: LI[0] - (c * x - s * y + TMJ[0]), ty: LI[1] - (s * x + c * y + TMJ[1]) };
}
export const onJaw = (J, x, y) => [J.c * (x - TMJ[0]) - J.s * (y - TMJ[1]) + TMJ[0] + J.tx, J.s * (x - TMJ[0]) + J.c * (y - TMJ[1]) + TMJ[1] + J.ty];
export function jawLine(J, P, out = new Float64Array(P.length)) {
  for (let i = 0; i < P.length; i += 2) {
    const x = P[i] - TMJ[0], y = P[i + 1] - TMJ[1];
    out[i] = J.c * x - J.s * y + TMJ[0] + J.tx; out[i + 1] = J.s * x + J.c * y + TMJ[1] + J.ty;
  }
  return out;
}
export const cat = (...parts) => { let n = 0; for (const p of parts) n += p.length; const o = new Float64Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; };
const rev = (P, from = 0, count = (P.length >> 1) - from) => {
  const n = P.length >> 1, o = new Float64Array(2 * count);
  for (let k = 0; k < count; k++) { const i = n - 1 - from - k; o[2 * k] = P[2 * i]; o[2 * k + 1] = P[2 * i + 1]; }
  return o;
};

const VALL = [-6.35, -3.85];
const FLOOR = [-1.75, -3.05, -2.6, -3.8, -4.1, -4.25, -5.35, -4.35];
export function tongueParts(S, J) {
  const TT = S.TT, TB = S.TB, TD = S.TD;
  let dx = TT[0] - TB[0], dy = TT[1] - TB[1];
  const dn = Math.hypot(dx, dy) || 1e-9; dx /= dn; dy /= dn;
  const tip = [TT[0] + .95 * dx, TT[1] + .95 * dy - .22];
  const r1 = [TD[0] - .85, TD[1] - .95], r2 = [Math.min(TD[0] - 1.25, -6.55), TD[1] - 2.35];
  const vall = onJaw(J, VALL[0], VALL[1]);
  const dorsum = smooth([...tip, ...TT, ...TB, ...TD, ...r1, ...r2, ...vall], 140);
  const lower = smooth(cat(vall, rev(jawLine(J, FLOOR)), [tip[0] - .4, tip[1] - .85, tip[0] - .22, tip[1] - .38], tip), 90);
  return { dorsum, body: cat(dorsum, lower.subarray(2, lower.length - 2)), tip };
}

const TOP = [-9.8, 4.1, -1, 4.1, .45, 3.85, 1.2, 2.75, 2.05, 1.62, 1.98, 1.22, 1.3, 1.05];
const CHIN = [.48, -3.55, .8, -4.1, .64, -4.7, 0, -5.12, -1.7, -5.35, -3.5, -5.55];
const NECK = [-4.3, -6.1, -4.6, -6.8, -9.8, -6.8];
const NASAL = [1.25, 1.12, .4, 1.75, -1.6, 2.25, -4, 2.45, -6.3, 2.25, -7.45, 1.75, -7.7, 1, -6.5, .9, -4, 1.25, -1.2, 1.1, .4, .95];
const PW = [-7.45, 1.75, -7.85, .6, -8.05, -1.4, -7.98, -3.4, -7.8, -5.1, -7.7, -6.8];
const UI = [-.3, -.55, -.22, -1.1, -.33, -1.7, -.48, -1.8, -.72, -1.35, -1.12, -.82, -1.02, -.5];
const LI_TOOTH = [-.62, -1.98, -.66, -2.4, -.78, -2.95, -1.05, -3.3, -1.32, -2.95, -1.18, -2.35, -.8, -2];
const SYM = [-.8, -2.95, -.45, -3.55, -.38, -4.25, -.85, -4.78, -1.65, -4.65, -1.95, -3.95, -1.62, -3.2, -1.25, -2.92];
const EPI = [-6.55, -4.75, -6.95, -3.75, -7.22, -2.95, -7.02, -2.98, -6.72, -3.78, -6.32, -4.65];
const HY = [-5.05, -4.62, -5.55, -4.48, -5.95, -4.62, -5.55, -4.8];

/** The drawing for one speaker: palate (flat x, y pairs, MNGU0 cm frame, x not flipped), z0 = the posture the jaw is drawn in. */
export class Anatomy {
  constructor(z0, pal, laClosed = LA_CLOSED) {
    this.LI0 = [-z0[SENS.LI], z0[SENS.LI + 1]];
    this.laClosed = laClosed;
    const P = [];
    for (let i = 0; i < pal.length; i += 2) P.push([-pal[i], pal[i + 1]]);
    P.sort((a, b) => b[0] - a[0]);
    this.hard = Float64Array.from(P.filter((p) => p[0] >= -5.3).flat());
    this.velOr = Float64Array.from(P.filter((p) => p[0] < -5.3).flat());
    const hard = this.hard, vel = this.velOr, hN = hard.length, vN = vel.length;
    this.pw = smooth(PW, 80);
    this.nasal = smooth(NASAL, 140, true);
    this.bone = cat(hard, smooth([hard[hN - 2], hard[hN - 1], -5.6, .95, -4, 1.25, -1.2, 1.1, .4, .95, .35, .15, -.3, -.55], 70), hard.subarray(0, 2));
    this.velum = vN >= 4 ? cat(vel, smooth([vel[vN - 2], vel[vN - 1], -6.95, -.98, -7.28, -.55, -7.32, .3, -6.5, .9, -5.6, .95], 60), vel.subarray(0, 2))
      : smooth([-5.4, .99, -6.2, .3, -6.95, -.98, -7.28, -.55, -7.32, .3, -6.5, .9, -5.6, .95], 60, true);
    this.ui = smooth(UI, 60, true);
    this.epi = smooth(EPI, 40, true);
    this.liTooth = smooth(LI_TOOTH, 60, true);
    this.sym = smooth(SYM, 70, true);
    this.hy = smooth(HY, 30, true);
    this.verts = [0, 1, 2, 3].map((k) => { const y = .35 - 1.6 * k; return smooth([-8.6, y, -9.7, y + .08, -9.7, y - 1.2, -8.62, y - 1.25, -8.48, y - .62], 40, true); });
  }
  /** the outlines that move with posture z (12-vector, cm) */
  pose(z) {
    const S = sensors(z), J = jawTransform(S.LI, this.LI0), UL = S.UL, LL = S.LL;
    const LA = UL[1] - LL[1], gap = Math.max(LA - this.laClosed, 0), ym = .5 * (UL[1] + LL[1]) + .08;
    const eu = ym + gap / 2, el = ym - gap / 2;
    const ulOut = [1.02, .8, UL[0] + .1, UL[1] + .4, UL[0] + .19, UL[1] - .02, UL[0] + .07, .5 * (UL[1] + eu) - .05, UL[0] - .22, eu];
    const llOut = [LL[0] - .24, el, LL[0] + .06, .5 * (LL[1] + el) + .05, LL[0] + .15, LL[1] + .02, LL[0] + 0, LL[1] - .4, LL[0] - .3, LL[1] - .72];
    const chin = jawLine(J, CHIN);
    const profUp = smooth(cat(TOP.slice(4), ulOut), 90), profLo = smooth(cat(llOut, chin), 90);
    const skin = cat(TOP.slice(0, 4), profUp, profLo, NECK);
    const tongue = tongueParts(S, J), D = tongue.dorsum, n = D.length >> 1, inner = new Float64Array(2 * n);
    for (let i = 0; i < n; i++) {
      const a = i === 0 ? 0 : i === n - 1 ? n - 2 : i - 1, b = i === 0 ? 1 : i === n - 1 ? n - 1 : i + 1, f = i === 0 || i === n - 1 ? 1 : .5;
      const gx = (D[2 * b] - D[2 * a]) * f, gy = (D[2 * b + 1] - D[2 * a + 1]) * f, g = Math.hypot(gx, gy) || 1e-9;
      inner[2 * i] = D[2 * i] + .45 * (-gy / g); inner[2 * i + 1] = D[2 * i + 1] + .45 * (gx / g);
    }
    const pharynx = cat(this.pw, [-6.95, -6.8, -6.75, -5.4, -6.35, -4.4], rev(inner, 0, 60), [-6.9, -.6, -6.6, .95]);
    const liEdge = onJaw(J, -.62, -1.98);
    const oral = cat(this.hard, this.velOr, [-6.9, -.9], rev(inner), liEdge, llOut.slice(0, 2), ulOut.slice(8, 10), [-.38, -1.75]);
    const ulip = smooth(cat([.9, .85], ulOut.slice(2), [UL[0] - .75, eu + .05, -.24, -1.3, -.22, -.6, .35, .45]), 80, true);
    const llip = smooth(cat(llOut, onJaw(J, -.7, -3.3), onJaw(J, -.66, -2.45), [LL[0] - .75, el - .05]), 80, true);
    return { S, J, LA, gap, eu, el, skin, profUp, profLo, tongue, pharynx, oral, li: jawLine(J, this.liTooth), sym: jawLine(J, this.sym),
      hy: jawLine(J, this.hy), ulip, llip };
  }
}
