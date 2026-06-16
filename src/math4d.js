// 4D math utilities: vectors, 4x4 rotation matrices, plane rotations

export const AXES = { X: 0, Y: 1, Z: 2, W: 3 };

// Axis-pair index for a rotation plane
// Plane names: 'XY','XZ','XW','YZ','YW','ZW'
export const PLANE_AXES = {
  XY: [0, 1], XZ: [0, 2], XW: [0, 3],
  YZ: [1, 2], YW: [1, 3], ZW: [2, 3],
};

export function vec4(x = 0, y = 0, z = 0, w = 0) {
  return new Float64Array([x, y, z, w]);
}

export function vec4Clone(v) {
  return new Float64Array(v);
}

export function vec4Add(a, b) {
  return new Float64Array([a[0]+b[0], a[1]+b[1], a[2]+b[2], a[3]+b[3]]);
}

export function vec4Scale(v, s) {
  return new Float64Array([v[0]*s, v[1]*s, v[2]*s, v[3]*s]);
}

export function vec4Lerp(a, b, t) {
  const s = 1 - t;
  return new Float64Array([a[0]*s+b[0]*t, a[1]*s+b[1]*t, a[2]*s+b[2]*t, a[3]*s+b[3]*t]);
}

export function vec4Dot(a, b) {
  return a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3];
}

export function vec4Len(v) {
  return Math.sqrt(vec4Dot(v, v));
}

// 4x4 matrix stored column-major as Float64Array[16]
export function mat4Identity() {
  const m = new Float64Array(16);
  m[0]=m[5]=m[10]=m[15]=1;
  return m;
}

export function mat4Mul(a, b) {
  const r = new Float64Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k*4+row] * b[col*4+k];
      r[col*4+row] = s;
    }
  }
  return r;
}

export function mat4MulVec4(m, v) {
  const r = new Float64Array(4);
  for (let row = 0; row < 4; row++) {
    r[row] = m[row]*v[0] + m[4+row]*v[1] + m[8+row]*v[2] + m[12+row]*v[3];
  }
  return r;
}

// Rotation matrix in the plane (a, b) by angle radians (right-hand rule: a→b positive)
export function mat4PlaneRotation(a, b, angle) {
  const m = mat4Identity();
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  m[a*4+a] = c;
  m[b*4+a] = -s;
  m[a*4+b] = s;
  m[b*4+b] = c;
  return m;
}

// Build a column-major 4×4 from four column vectors (each length-4).
export function mat4FromCols(c0, c1, c2, c3) {
  return new Float64Array([
    c0[0], c0[1], c0[2], c0[3],
    c1[0], c1[1], c1[2], c1[3],
    c2[0], c2[1], c2[2], c2[3],
    c3[0], c3[1], c3[2], c3[3],
  ]);
}

export function mat4Transpose(m) {
  const r = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let row = 0; row < 4; row++) r[row*4+c] = m[c*4+row];
  return r;
}

// Determinant of a column-major 4×4 (used to test frame handedness).
export function mat4Det(m) {
  const a = (i, j) => m[j*4 + i];          // (row i, col j)
  const det3 = (a00,a01,a02,a10,a11,a12,a20,a21,a22) =>
    a00*(a11*a22 - a12*a21) - a01*(a10*a22 - a12*a20) + a02*(a10*a21 - a11*a20);
  let det = 0;
  for (let j = 0; j < 4; j++) {
    // minor of (row 0, col j)
    const cols = [0,1,2,3].filter(c => c !== j);
    const mnr = det3(
      a(1,cols[0]), a(1,cols[1]), a(1,cols[2]),
      a(2,cols[0]), a(2,cols[1]), a(2,cols[2]),
      a(3,cols[0]), a(3,cols[1]), a(3,cols[2]));
    det += (j % 2 ? -1 : 1) * a(0, j) * mnr;
  }
  return det;
}

// ── SO(4) geodesic interpolation (double-quaternion / van Elfrinkhof) ──────────
//
// Any 4D rotation factors as M = L(λ)·R(ρ): left- and right-isoclinic rotations by
// unit quaternions λ, ρ. Interpolating each quaternion from identity gives the
// constant-speed geodesic — smooth for ANY angle, including the 180° opposite-cell
// case that a naive matrix lerp can't do (it would pass through the zero vector).

// Left-multiplication matrix L(λ) (column-major), λ=(a,b,c,d).
function quatLeftMat(q) {
  const [a, b, c, d] = q;
  return new Float64Array([
    a, b, c, d,        // col0
   -b, a, d,-c,        // col1
   -c,-d, a, b,        // col2
   -d, c,-b, a,        // col3
  ]);
}
// Right-multiplication matrix R(ρ) (column-major), ρ=(p,q,r,s).
function quatRightMat(q) {
  const [p, qq, r, s] = q;
  return new Float64Array([
    p, qq, r, s,       // col0
   -qq, p,-s, r,       // col1
   -r, s, p,-qq,       // col2
   -s,-r, qq, p,       // col3
  ]);
}

// Decompose a 4×4 rotation (column-major, det +1) into its two unit quaternions
// λ, ρ. Uses the rank-1 associate matrix O = λ·ρᵀ recovered from M, then reads λ,ρ
// off its largest row (robust at every angle). Global sign chosen for the shortest
// geodesic (max λ₀+ρ₀ ⇒ min total isoclinic angle).
export function so4Decompose(M) {
  const m = (i, j) => M[j*4 + i];          // (row i, col j)
  // Associate matrix O[i][j] = λ_i · ρ_j (16 closed-form combinations of M's entries).
  const O = [
    [ (m(0,0)+m(1,1)+m(2,2)+m(3,3))/4, (m(1,0)-m(0,1)+m(2,3)-m(3,2))/4, (m(2,0)-m(0,2)+m(3,1)-m(1,3))/4, (m(3,0)-m(0,3)+m(1,2)-m(2,1))/4 ],
    [ (m(1,0)-m(0,1)-m(2,3)+m(3,2))/4, (m(2,2)+m(3,3)-m(0,0)-m(1,1))/4, (m(0,3)+m(3,0)-m(1,2)-m(2,1))/4, -(m(0,2)+m(2,0)+m(1,3)+m(3,1))/4 ],
    [ (m(2,0)-m(0,2)-m(3,1)+m(1,3))/4, -(m(0,3)+m(3,0)+m(1,2)+m(2,1))/4, (m(1,1)+m(3,3)-m(0,0)-m(2,2))/4, (m(0,1)+m(1,0)-m(2,3)-m(3,2))/4 ],
    [ (m(3,0)-m(0,3)-m(1,2)+m(2,1))/4, (m(0,2)+m(2,0)-m(1,3)-m(3,1))/4, -(m(0,1)+m(1,0)+m(2,3)+m(3,2))/4, (m(1,1)+m(2,2)-m(0,0)-m(3,3))/4 ],
  ];
  // ρ = the largest-norm row, normalized; λ_i = O[i]·ρ.
  let bi = 0, bn = -1;
  for (let i = 0; i < 4; i++) {
    const n = O[i][0]**2 + O[i][1]**2 + O[i][2]**2 + O[i][3]**2;
    if (n > bn) { bn = n; bi = i; }
  }
  let rho = O[bi].slice();
  const rl = Math.hypot(rho[0], rho[1], rho[2], rho[3]) || 1;
  rho = rho.map(v => v / rl);
  const lam = O.map(row => row[0]*rho[0] + row[1]*rho[1] + row[2]*rho[2] + row[3]*rho[3]);
  const ll = Math.hypot(lam[0], lam[1], lam[2], lam[3]) || 1;
  const lambda = lam.map(v => v / ll);
  // Shortest geodesic: pick the global sign (λ,ρ)→−(λ,ρ) that maximizes λ₀+ρ₀.
  if (lambda[0] + rho[0] < 0) { for (let i = 0; i < 4; i++) { lambda[i] = -lambda[i]; rho[i] = -rho[i]; } }
  return { qL: lambda, qR: rho };
}

// Slerp a unit quaternion from identity (1,0,0,0) to q by t.
function quatSlerpFromIdentity(q, t) {
  let w = Math.max(-1, Math.min(1, q[0]));
  const theta = Math.acos(w);
  const sin = Math.sin(theta);
  if (sin < 1e-7) return [1, 0, 0, 0].map((v, i) => v*(1-t) + q[i]*t);  // ~identity
  const s0 = Math.sin((1 - t) * theta) / sin;
  const s1 = Math.sin(t * theta) / sin;
  return [s0 + s1*q[0], s1*q[1], s1*q[2], s1*q[3]];
}

// Interpolate the rotation M (column-major SO(4)) from identity to M by t, along
// the geodesic. so4Slerp(M, 0) = I, so4Slerp(M, 1) = M.
export function so4Slerp(M, t) {
  const { qL, qR } = so4Decompose(M);
  const lt = quatSlerpFromIdentity(qL, t);
  const rt = quatSlerpFromIdentity(qR, t);
  return mat4Mul(quatLeftMat(lt), quatRightMat(rt));
}

// Snap a vec4 to nearest integer grid (removes floating point drift after moves)
export function vec4Snap(v) {
  return new Float64Array([
    Math.round(v[0]), Math.round(v[1]), Math.round(v[2]), Math.round(v[3]),
  ]);
}

// Apply a 90° plane rotation to an integer-grid vec4, snapped to avoid drift
export function applyPlaneRotation90(v, a, b, sign) {
  const r = vec4Clone(v);
  const va = v[a], vb = v[b];
  // +90°: a → -b, b → a   i.e. new_a = -b, new_b = a
  // -90°: a → b, b → -a   i.e. new_a = b, new_b = -a
  if (sign > 0) { r[a] = -vb; r[b] = va; }
  else          { r[a] = vb;  r[b] = -va; }
  return r;
}

// 3x3 matrix (for 3D view rotation), stored as Float64Array[9], column-major
export function mat3Identity() {
  const m = new Float64Array(9);
  m[0]=m[4]=m[8]=1;
  return m;
}

export function mat3Mul(a, b) {
  const r = new Float64Array(9);
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 3; row++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += a[k*3+row] * b[col*3+k];
      r[col*3+row] = s;
    }
  }
  return r;
}

export function mat3MulVec3(m, v) {
  return [
    m[0]*v[0] + m[3]*v[1] + m[6]*v[2],
    m[1]*v[0] + m[4]*v[1] + m[7]*v[2],
    m[2]*v[0] + m[5]*v[1] + m[8]*v[2],
  ];
}

// 3D rotation around axis (0=X,1=Y,2=Z) by angle
export function mat3AxisRotation(axis, angle) {
  const m = mat3Identity();
  const c = Math.cos(angle), s = Math.sin(angle);
  const a = (axis + 1) % 3, b = (axis + 2) % 3;
  m[a*3+a]=c; m[b*3+a]=-s;
  m[a*3+b]=s; m[b*3+b]=c;
  return m;
}

// Rotation in the (axisA, axisB) plane by `angle`, column-major 3×3.
// Matches applyPartialRot3: new[axisA] = c·old[axisA] − s·old[axisB].
export function mat3PlaneRotation(axisA, axisB, angle) {
  const m = mat3Identity();
  const c = Math.cos(angle), s = Math.sin(angle);
  m[axisA*3+axisA] = c;  m[axisB*3+axisA] = -s;
  m[axisA*3+axisB] = s;  m[axisB*3+axisB] = c;
  return m;
}

// Spherically interpolate two 3x3 rotation matrices via angle-axis (approx: normalize)
export function mat3Slerp(a, b, t) {
  // Simple element-wise lerp + re-orthogonalize via Gram-Schmidt — good enough for view
  const r = new Float64Array(9);
  for (let i = 0; i < 9; i++) r[i] = a[i]*(1-t) + b[i]*t;
  return mat3Orthonormalize(r);
}

function mat3Orthonormalize(m) {
  // Gram-Schmidt on columns
  const c0 = [m[0],m[1],m[2]];
  let c1 = [m[3],m[4],m[5]];
  let c2 = [m[6],m[7],m[8]];

  const norm0 = Math.sqrt(c0[0]**2+c0[1]**2+c0[2]**2);
  for (let i=0;i<3;i++) c0[i]/=norm0;

  const d01 = c0[0]*c1[0]+c0[1]*c1[1]+c0[2]*c1[2];
  for (let i=0;i<3;i++) c1[i]-=d01*c0[i];
  const norm1 = Math.sqrt(c1[0]**2+c1[1]**2+c1[2]**2);
  for (let i=0;i<3;i++) c1[i]/=norm1;

  // c2 = c0 × c1
  c2 = [c0[1]*c1[2]-c0[2]*c1[1], c0[2]*c1[0]-c0[0]*c1[2], c0[0]*c1[1]-c0[1]*c1[0]];

  return new Float64Array([c0[0],c0[1],c0[2], c1[0],c1[1],c1[2], c2[0],c2[1],c2[2]]);
}
