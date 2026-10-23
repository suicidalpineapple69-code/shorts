// Final display-space pass: grade, vignette, grain, flashes and transition effects.
export const FxShader = {
  uniforms: {
    tDiffuse: { value: null },
    res: { value: [1080, 1920] },
    time: { value: 0 },
    flash: { value: 0 },
    fade: { value: 0 },
    rgb: { value: 0 },
    scan: { value: 0 },
    blur: { value: 0 },
    blurDir: { value: [0, 1] },
    glitch: { value: 0 },
    vignette: { value: 0.42 },
    grain: { value: 0.035 },
    warm: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 res, blurDir;
    uniform float time, flash, fade, rgb, scan, blur, glitch, vignette, grain, warm;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    vec3 tap(vec2 uv) {
      vec3 c = texture2D(tDiffuse, uv).rgb;
      if (rgb > 0.0) {
        c.r = texture2D(tDiffuse, uv + vec2(rgb / res.x, 0.0)).r;
        c.b = texture2D(tDiffuse, uv - vec2(rgb / res.x, 0.0)).b;
      }
      return c;
    }
    void main() {
      vec2 uv = vUv;
      if (glitch > 0.0) {
        float band = floor(uv.y * 28.0);
        float n = hash(vec2(band, floor(time * 30.0)));
        if (n > 1.0 - glitch * 0.6) uv.x += (hash(vec2(band, time)) - 0.5) * 0.09 * glitch;
      }
      vec3 col = vec3(0.0);
      if (blur > 0.0) {
        for (int i = 0; i < 11; i++) col += tap(uv + blurDir * (float(i) / 10.0 - 0.5) * blur);
        col /= 11.0;
      } else {
        col = tap(uv);
      }
      col *= 1.0 - scan * 0.4 * (0.5 + 0.5 * sin(uv.y * res.y * 0.9 + time * 40.0));
      // gentle S-curve and a touch of saturation
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.2);
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, 1.12);
      col += vec3(0.02, 0.0, -0.015) * warm;
      vec2 d = uv - 0.5;
      d.x *= res.x / res.y;
      col *= mix(1.0 - vignette, 1.0, smoothstep(0.78, 0.22, length(d)));
      col += (hash(uv * res + fract(time * 7.13)) - 0.5) * grain;
      col = mix(col, vec3(1.0), flash);
      col *= 1.0 - fade;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};
