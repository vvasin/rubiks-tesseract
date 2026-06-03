// GLSL shader sources. Geometry arrives already projected to 3D (per-cell
// corners); the shader only applies the view rotation + camera.

export const VERT_SRC = `
attribute vec3 a_pos;       // 3D world position (pre view-rotation)
attribute vec3 a_normal;    // face normal (pre view-rotation)
attribute vec3 a_color;     // sticker colour
attribute float a_opacity;  // per-vertex opacity

uniform mat4 u_proj;
uniform mat4 u_view;
uniform mat3 u_rot;         // view rotation (mouse / keys)

varying vec3 v_color;
varying float v_opacity;
varying vec3 v_normal;

void main() {
  vec3 world = u_rot * a_pos;
  v_normal = u_rot * a_normal;
  v_color = a_color;
  v_opacity = a_opacity;
  gl_Position = u_proj * u_view * vec4(world, 1.0);
}
`;

export const FRAG_SRC = `
precision mediump float;

varying vec3 v_color;
varying float v_opacity;
varying vec3 v_normal;

uniform vec3 u_lightDir;
uniform float u_ambient;

void main() {
  vec3 n = normalize(v_normal);
  // two-sided lighting so inner cell faces (revealed by morphing) still shade
  float diff = max(abs(dot(n, normalize(u_lightDir))), 0.0);
  vec3 lit = v_color * (u_ambient + (1.0 - u_ambient) * diff);
  gl_FragColor = vec4(lit, v_opacity);
}
`;
