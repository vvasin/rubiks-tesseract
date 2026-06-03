// WebGL renderer. Each frame it receives a list of cells (one per visible
// sticker), each an 8-corner hexahedron already projected to 3D, and draws them
// as solid colored, depth-sorted, semi-transparent boxes.
import { VERT_SRC, FRAG_SRC } from './shaders.js';

const FLOATS_PER_VERT = 10;        // pos3 + normal3 + color3 + opacity1
const VERTS_PER_CELL  = 6;         // 1 quad = 2 tris × 3 verts

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', { antialias: true, alpha: false, preserveDrawingBuffer: true });
    if (!this.gl) throw new Error('WebGL not supported');
    this._init();
  }

  _init() {
    const gl = this.gl;
    gl.clearColor(0.04, 0.04, 0.06, 1.0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    // Opaque rendering: the depth buffer handles occlusion, no blending/sorting.

    this.program = this._buildProgram(VERT_SRC, FRAG_SRC);
    this._cacheLocations();

    this.vbo = gl.createBuffer();
    this.cpuBuf = new Float32Array(0);   // grown as needed
  }

  _buildProgram(vs, fs) {
    const gl = this.gl;
    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
        throw new Error('Shader: ' + gl.getShaderInfoLog(sh));
      return sh;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
      throw new Error('Link: ' + gl.getProgramInfoLog(prog));
    return prog;
  }

  _cacheLocations() {
    const gl = this.gl, p = this.program;
    this.loc = {
      a_pos:     gl.getAttribLocation(p, 'a_pos'),
      a_normal:  gl.getAttribLocation(p, 'a_normal'),
      a_color:   gl.getAttribLocation(p, 'a_color'),
      a_opacity: gl.getAttribLocation(p, 'a_opacity'),
      u_proj:    gl.getUniformLocation(p, 'u_proj'),
      u_view:    gl.getUniformLocation(p, 'u_view'),
      u_rot:     gl.getUniformLocation(p, 'u_rot'),
      u_lightDir:gl.getUniformLocation(p, 'u_lightDir'),
      u_ambient: gl.getUniformLocation(p, 'u_ambient'),
    };
  }

  resize() {
    // Match the backing store to physical device pixels so the image is crisp on
    // HiDPI / retina displays instead of being rendered low-res and upscaled.
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; this.gl.viewport(0, 0, w, h); }
  }

  draw(cells, viewRot, segments = null, camDist = 15) {
    const gl = this.gl;
    this.resize();
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);

    const aspect = this.canvas.width / this.canvas.height;
    gl.uniformMatrix4fv(this.loc.u_proj, false, perspectiveMatrix(Math.PI / 3.2, aspect, 0.1, 200));
    gl.uniformMatrix4fv(this.loc.u_view, false, lookAtMatrix([0, 0, camDist], [0, 0, 0], [0, 1, 0]));
    gl.uniformMatrix3fv(this.loc.u_rot, false, viewRot);
    gl.uniform3fv(this.loc.u_lightDir, [0.5, 0.7, 0.6]);
    gl.uniform1f(this.loc.u_ambient, 0.42);

    // Back-to-front sort by view-rotated centroid depth.
    for (const cell of cells) {
      const q = cell.quad;
      const cx = (q[0][0]+q[1][0]+q[2][0]+q[3][0])*0.25;
      const cy = (q[0][1]+q[1][1]+q[2][1]+q[3][1])*0.25;
      const cz = (q[0][2]+q[1][2]+q[2][2]+q[3][2])*0.25;
      cell.sortDepth = viewRot[2]*cx + viewRot[5]*cy + viewRot[8]*cz;
    }
    const order = cells.map((_, i) => i).sort((a, b) => cells[a].sortDepth - cells[b].sortDepth);

    // Fill the CPU buffer (one quad per sticker tile).
    const need = cells.length * VERTS_PER_CELL * FLOATS_PER_VERT;
    if (this.cpuBuf.length < need) this.cpuBuf = new Float32Array(need);
    const buf = this.cpuBuf;
    let o = 0;
    for (const idx of order) {
      const cell = cells[idx];
      if (cell.opacity < 0.02) continue;
      const q = cell.quad, col = cell.color, op = cell.opacity;
      const n = cell.normal || faceNormal(q[0], q[1], q[2]);
      // No back-face cull: the depth buffer handles occlusion, and culling made a
      // cell's face vanish (leaving a hole) as its surface went edge-on to the camera.
      o = emitTri(buf, o, q[0], q[1], q[2], n, col, op);
      o = emitTri(buf, o, q[0], q[2], q[3], n, col, op);
    }

    const vertCount = o / FLOATS_PER_VERT;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, buf.subarray(0, o), gl.DYNAMIC_DRAW);

    const stride = FLOATS_PER_VERT * 4;
    this._attr(this.loc.a_pos,     3, stride, 0);
    this._attr(this.loc.a_normal,  3, stride, 12);
    this._attr(this.loc.a_color,   3, stride, 24);
    this._attr(this.loc.a_opacity, 1, stride, 36);

    gl.drawArrays(gl.TRIANGLES, 0, vertCount);

    // Wireframe: segments = [{ a:[x,y,z], b:[x,y,z], color:[r,g,b] }, ...]
    if (segments && segments.length) {
      const total = segments.length * 2 * FLOATS_PER_VERT;
      if (!this.lineBuf || this.lineBuf.length < total) this.lineBuf = new Float32Array(total);
      const lb = this.lineBuf;
      const n = [0, 0, 1];
      let p = 0;
      for (const s of segments) { p = emitVert(lb, p, s.a, n, s.color, 1); p = emitVert(lb, p, s.b, n, s.color, 1); }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, lb.subarray(0, p), gl.DYNAMIC_DRAW);
      this._attr(this.loc.a_pos,     3, stride, 0);
      this._attr(this.loc.a_normal,  3, stride, 12);
      this._attr(this.loc.a_color,   3, stride, 24);
      this._attr(this.loc.a_opacity, 1, stride, 36);
      gl.uniform1f(this.loc.u_ambient, 1.0);   // flat, unlit lines
      gl.drawArrays(gl.LINES, 0, p / FLOATS_PER_VERT);
    }
  }

  _attr(loc, size, stride, offset) {
    const gl = this.gl;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
  }
}

function emitVert(buf, o, p, n, col, op) {
  buf[o++] = p[0]; buf[o++] = p[1]; buf[o++] = p[2];
  buf[o++] = n[0]; buf[o++] = n[1]; buf[o++] = n[2];
  buf[o++] = col[0]; buf[o++] = col[1]; buf[o++] = col[2];
  buf[o++] = op;
  return o;
}

function emitTri(buf, o, a, b, c, n, col, op) {
  o = emitVert(buf, o, a, n, col, op);
  o = emitVert(buf, o, b, n, col, op);
  o = emitVert(buf, o, c, n, col, op);
  return o;
}

function faceNormal(a, b, c) {
  const ux = b[0]-a[0], uy = b[1]-a[1], uz = b[2]-a[2];
  const vx = c[0]-a[0], vy = c[1]-a[1], vz = c[2]-a[2];
  let nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx/l, ny/l, nz/l];
}

function perspectiveMatrix(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2), nf = 1 / (near - far);
  return new Float32Array([
    f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,2*far*near*nf,0,
  ]);
}

function lookAtMatrix(eye, center, up) {
  const e=eye,c=center,u=up;
  let fx=c[0]-e[0],fy=c[1]-e[1],fz=c[2]-e[2];
  const fl=Math.hypot(fx,fy,fz); fx/=fl;fy/=fl;fz/=fl;
  let sx=fy*u[2]-fz*u[1],sy=fz*u[0]-fx*u[2],sz=fx*u[1]-fy*u[0];
  const sl=Math.hypot(sx,sy,sz); sx/=sl;sy/=sl;sz/=sl;
  const ux=sy*fz-sz*fy,uy=sz*fx-sx*fz,uz=sx*fy-sy*fx;
  return new Float32Array([
    sx,ux,-fx,0, sy,uy,-fy,0, sz,uz,-fz,0,
    -(sx*e[0]+sy*e[1]+sz*e[2]), -(ux*e[0]+uy*e[1]+uz*e[2]), (fx*e[0]+fy*e[1]+fz*e[2]), 1,
  ]);
}
