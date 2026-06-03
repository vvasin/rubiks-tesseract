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
