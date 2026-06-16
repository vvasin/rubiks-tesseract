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

// Ordered Bayer (8×8) threshold for screen-door (dither) transparency. An ordered
// matrix gives a uniform frosted stipple — which reads as natural semitransparency for
// the translucent side cells — instead of the grainy TV-static of a per-pixel hash.
// Recursive 2→4→8 construction (no array indexing; WebGL-1 friendly), output in [0,1).
float bayer2(vec2 a) { a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(a * 0.5) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(a * 0.5) * 0.25 + bayer2(a); }

void main() {
  // Screen-door transparency — order-independent (writes depth, no blending/sorting):
  // keep each fragment when its ordered-dither threshold is below v_opacity. A cubie
  // fading solid→wireframe sprouts holes; a translucent side cell shows a steady stipple.
  if (v_opacity < 0.999 && bayer8(gl_FragCoord.xy) >= v_opacity) discard;
  vec3 n = normalize(v_normal);
  // two-sided lighting so inner cell faces (revealed by morphing) still shade
  float diff = max(abs(dot(n, normalize(u_lightDir))), 0.0);
  vec3 lit = v_color * (u_ambient + (1.0 - u_ambient) * diff);
  gl_FragColor = vec4(lit, 1.0);
}
`;
