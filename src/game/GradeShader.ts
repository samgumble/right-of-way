/** A restrained split-tone color grade — cool `steelBlueDim`-toned shadows, warm
 * `keyLight`-toned highlights — layered on top of the existing bloom/vignette pipeline
 * to push the render further toward "SCADA monitor" and away from flat PBR shading.
 * Hand-rolled, `ShaderPass`-compatible (same object shape three.js's own `VignetteShader`
 * exports), matching this project's "hand-write the math, no new dependency" precedent. */
export const GradeShader = {
  name: 'GradeShader',

  uniforms: {
    tDiffuse: { value: null },
    shadowTint: { value: null as unknown },
    highlightTint: { value: null as unknown },
    strength: { value: 0.18 },
  },

  vertexShader: /* glsl */ `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,

  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 shadowTint;
    uniform vec3 highlightTint;
    uniform float strength;

    varying vec2 vUv;

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      float luma = dot(texel.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec3 graded = mix(texel.rgb * shadowTint, texel.rgb + highlightTint * (luma * luma), luma);
      gl_FragColor = vec4(mix(texel.rgb, graded, strength), texel.a);
    }`,
};
