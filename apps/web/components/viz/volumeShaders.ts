/**
 * volumeShaders.ts — the GLSL behind VolumeRenderer.tsx, kept as plain strings
 * in a module with no DOM or React so a headless script can compile them in a
 * real WebGL2 context (see the header of VolumeRenderer.tsx for the model).
 *
 * Both are written for three.js's GLSL3 ShaderMaterial, which prepends the
 * `#version 300 es` line, the precision statements, and the declarations of
 * `position`, `modelViewMatrix` and `projectionMatrix` — so none of those
 * appear here.
 *
 * Uniforms (all set by VolumeRenderer.tsx):
 *   uVolume     sampler3D  RGBA8; R = √(|ψ|²/max), G = (phase+π)/2π  (see encodeVolumeRgba)
 *   uCameraObj  vec3       camera position in the unit cube's object space
 *   uThreshold  float      normalised density below which nothing is drawn
 *   uOpacity    float      absorption multiplier
 *   uSteps      int        samples per ray (≤ 512)
 *   uColorMode  int        0 = density ramp uLow→uHigh, 1 = phase wheel uPhase0..3
 *   uClip       vec4       half-space (normal.xyz, offset): keep where dot(p, n) ≤ w
 */

/** Passes the unit-cube surface position through; the fragment shader casts from it. */
export const VOLUME_VERTEX_SHADER = /* glsl */ `
out vec3 vObjPos;
void main() {
  vObjPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/**
 * Emission–absorption ray march through the unit cube [−0.5, 0.5]³.
 *
 * The cube is drawn BACK-face only so the ray is always cast from the camera
 * to the far wall; the near entry point comes from the slab test, clamped to
 * the camera itself when it sits inside the box. The clip half-space then
 * trims the [tNear, tFar] interval analytically — no per-sample branch.
 *
 * Texture axes are physics (x, y, z). The cube's object-space (local, unit
 * [−0.5, 0.5]³) axes relate to physics by the same proper rotation as
 * volumeLayout.ts's `physicsToThree` — physics (x, y, z) → object (x, z, −y) —
 * so inverting it to go from an object-space sample `p` back to a physics
 * texture coordinate gives physics (x, y, z) = object (p.x, −p.z, p.y), hence
 * the `uvw` swizzle below (with the sign on the middle term). Getting that
 * sign wrong — or getting it right here but leaving volumeLayout.ts's
 * `boxWorldScale` also signed — reintroduces the mirror this fixes, because
 * `boxWorldScale` feeds a mesh `.scale`, a magnitude that must never go
 * negative independently of this sampling convention.
 */
export const VOLUME_FRAGMENT_SHADER = /* glsl */ `
uniform sampler3D uVolume;
uniform vec3 uCameraObj;   // camera position in the cube's object space
uniform float uThreshold;  // normalised density cut-off
uniform float uOpacity;    // absorption multiplier
uniform int uSteps;        // samples along each ray
uniform int uColorMode;    // 0 density ramp, 1 phase wheel
uniform vec3 uLow;         // density ramp start
uniform vec3 uHigh;        // density ramp end
uniform vec3 uPhase0;      // wheel at phase 0
uniform vec3 uPhase1;      // π/2
uniform vec3 uPhase2;      // π
uniform vec3 uPhase3;      // 3π/2
uniform vec4 uClip;        // xyz normal, w offset; keep where dot(p, n) <= w

in vec3 vObjPos;
out vec4 outColor;

// Slab test: (entry, exit) parameters of the ray against the unit cube.
vec2 boxHit(vec3 ro, vec3 rd) {
  vec3 inv = 1.0 / rd;
  vec3 t0 = (vec3(-0.5) - ro) * inv;
  vec3 t1 = (vec3(0.5) - ro) * inv;
  vec3 tmin = min(t0, t1);
  vec3 tmax = max(t0, t1);
  return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
}

// Four-stop hue wheel, piecewise linear. Mirrors phaseColor() in volumeLayout.ts.
vec3 wheel(float t) {
  float s = fract(t) * 4.0;
  float f = fract(s);
  int i = int(floor(s));
  if (i == 0) return mix(uPhase0, uPhase1, f);
  if (i == 1) return mix(uPhase1, uPhase2, f);
  if (i == 2) return mix(uPhase2, uPhase3, f);
  return mix(uPhase3, uPhase0, f);
}

// Cheap per-pixel jitter so the sample planes do not band.
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec3 ro = uCameraObj;
  vec3 rd = normalize(vObjPos - ro);
  vec2 hit = boxHit(ro, rd);
  float tNear = max(hit.x, 0.0);
  float tFar = hit.y;

  // Clip: f(t) = dot(ro + t·rd, n) − w must stay <= 0.
  float a = dot(ro, uClip.xyz) - uClip.w;
  float b = dot(rd, uClip.xyz);
  if (abs(b) < 1e-6) {
    if (a > 0.0) discard;
  } else {
    float tc = -a / b;
    if (b > 0.0) tFar = min(tFar, tc);
    else tNear = max(tNear, tc);
  }
  if (tFar <= tNear) discard;

  float dt = (tFar - tNear) / float(uSteps);
  float t = tNear + dt * hash(gl_FragCoord.xy);
  vec4 acc = vec4(0.0);
  float invRange = 1.0 / max(1.0 - uThreshold, 1e-3);

  for (int i = 0; i < 512; i++) {
    if (i >= uSteps || t > tFar) break;
    vec3 p = ro + rd * t;
    // object (x, y, z)_three → texture (x, y, z)_physics = (p.x, −p.z, p.y)
    // (inverse of physicsToThree's physics (x,y,z) → object (x, z, −y))
    vec3 uvw = vec3(p.x, -p.z, p.y) + 0.5;
    vec2 tex = texture(uVolume, uvw).rg;
    float d = tex.r * tex.r;                        // undo the √ encoding
    float vis = clamp((d - uThreshold) * invRange, 0.0, 1.0);
    if (vis > 0.0) {
      // Absorption per unit length scales with density; 14 is the gain that
      // makes opacity = 1 read as "a cloud you can see into but not through".
      float alpha = 1.0 - exp(-vis * uOpacity * dt * 14.0);
      vec3 col;
      if (uColorMode == 1) {
        // G stores (phase + π)/2π, so phase 0 sits at 0.5; shift it to the
        // wheel's first stop. (Checked headlessly: the ψ < 0 lobe of 2p_z
        // rendered in the phase-0 colour before this offset was added.)
        col = wheel(tex.g + 0.5) * (0.55 + 0.45 * vis);
      } else {
        col = mix(uLow, uHigh, vis);
      }
      acc.rgb += (1.0 - acc.a) * alpha * col;
      acc.a += (1.0 - acc.a) * alpha;
      if (acc.a > 0.98) break;
    }
    t += dt;
  }
  // Premultiplied output; the material blends with One / OneMinusSrcAlpha.
  outColor = acc;
}
`
