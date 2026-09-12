import { Shader } from '../shader.js';
import { FullscreenPass } from './fullscreen.js';

/**
 * Final composite.
 *
 * Combines the scene colour with the bloom, tone maps, and applies the grade
 * that gives the game its look: a slight chromatic split at the edges, a soft
 * vignette, faint scanlines, and a touch of animated grain.
 *
 * Every one of these is subtle on purpose. Each effect at full strength
 * screams "post-processing demo"; all of them at a quarter strength read as
 * "this world is being displayed on something". The scanlines in particular
 * are barely visible at 1x and are the single strongest cue that you are
 * looking at a monitor inside a data centre rather than at flat vector art.
 */

const COMPOSITE_FRAG = `#version 300 es
precision highp float;

in vec2 vUV;

uniform sampler2D uScene;
uniform sampler2D uBloom;

uniform float uBloomIntensity;
uniform float uExposure;
uniform float uVignette;
uniform float uScanlineIntensity;
uniform float uScanlineCount;
uniform float uChromatic;
uniform float uGrain;
uniform float uTime;
uniform vec2  uResolution;
uniform float uFlash;
uniform vec3  uFlashColor;
uniform float uDesaturate;

out vec4 outColor;

// ACES filmic tone map, Narkowicz's fit. Keeps saturated neon from clipping
// to flat white the moment bloom pushes it past 1.0.
vec3 tonemapACES(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 uv = vUV;
  vec2 centered = uv - 0.5;
  float r2 = dot(centered, centered);

  // Chromatic aberration, scaled by distance from centre so the middle of
  // the screen - where the player is looking - stays perfectly sharp.
  vec3 scene;
  if (uChromatic > 0.0001) {
    vec2 offset = centered * uChromatic * r2;
    scene.r = texture(uScene, uv + offset).r;
    scene.g = texture(uScene, uv).g;
    scene.b = texture(uScene, uv - offset).b;
  } else {
    scene = texture(uScene, uv).rgb;
  }

  vec3 bloom = texture(uBloom, uv).rgb;
  vec3 color = scene + bloom * uBloomIntensity;

  color *= uExposure;
  color = tonemapACES(color);

  if (uDesaturate > 0.0001) {
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = mix(color, vec3(luma), uDesaturate);
  }

  // Vignette. smoothstep rather than a power curve so the falloff has no
  // visible ring where it begins.
  float vig = smoothstep(0.9, 0.15, r2 * 1.9);
  color *= mix(1.0, vig, uVignette);

  if (uScanlineIntensity > 0.0001) {
    float line = sin(uv.y * uScanlineCount * 3.14159265) * 0.5 + 0.5;
    color *= 1.0 - uScanlineIntensity * (1.0 - line);
  }

  if (uGrain > 0.0001) {
    // Offsetting by time makes the grain move; a static pattern reads as
    // dirt on the screen instead of as sensor noise.
    float n = hash12(gl_FragCoord.xy + vec2(uTime * 71.0, uTime * 113.0));
    color += (n - 0.5) * uGrain;
  }

  color = mix(color, uFlashColor, uFlash);

  outColor = vec4(color, 1.0);
}`;

export interface CompositeSettings {
  bloomIntensity: number;
  exposure: number;
  vignette: number;
  scanlineIntensity: number;
  chromatic: number;
  grain: number;
  /** Full-screen colour flash, 0..1. Driven by hits and level-ups. */
  flash: number;
  flashColor: number;
  /** 0 is full colour, 1 is greyscale. Used when a menu opens over the world. */
  desaturate: number;
}

/**
 * Tuned by looking at the result, not by picking round numbers.
 *
 * `chromatic` especially: the offset is scaled by r^2 across the frame, so a
 * value of 0.12 displaces the red and blue channels by nearly forty pixels at
 * the corners, which does not read as a lens artefact - it reads as three
 * misaligned copies of the image. Single-digit thousandths are the range
 * where it registers as fringing rather than as a bug.
 */
export const DEFAULT_COMPOSITE: CompositeSettings = {
  bloomIntensity: 0.62,
  exposure: 1.08,
  vignette: 0.42,
  scanlineIntensity: 0.035,
  chromatic: 0.0045,
  grain: 0.015,
  flash: 0,
  flashColor: 0xffffff,
  desaturate: 0,
};

export class CompositePass {
  private readonly shader: Shader;
  readonly settings: CompositeSettings = { ...DEFAULT_COMPOSITE };

  private flashDecay = 0;

  constructor(
    _gl: WebGL2RenderingContext,
    private readonly fullscreen: FullscreenPass,
  ) {
    this.shader = fullscreen.makeShader(COMPOSITE_FRAG, 'composite');
  }

  /** Trigger a screen flash that fades over `duration` seconds. */
  flash(color: number, strength = 0.5, duration = 0.25): void {
    this.settings.flash = Math.min(1, this.settings.flash + strength);
    this.settings.flashColor = color;
    this.flashDecay = strength / Math.max(0.016, duration);
  }

  update(dt: number): void {
    if (this.settings.flash > 0) {
      this.settings.flash = Math.max(0, this.settings.flash - this.flashDecay * dt);
    }
  }

  render(
    scene: WebGLTexture,
    bloom: WebGLTexture,
    width: number,
    height: number,
    time: number,
  ): void {
    const s = this.settings;
    this.fullscreen.run(this.shader, (sh) => {
      sh.setTexture('uScene', scene, 0);
      sh.setTexture('uBloom', bloom, 1);
      sh.setFloat('uBloomIntensity', s.bloomIntensity);
      sh.setFloat('uExposure', s.exposure);
      sh.setFloat('uVignette', s.vignette);
      sh.setFloat('uScanlineIntensity', s.scanlineIntensity);
      // Tie the scanline count to real pixel height, so the spacing looks the
      // same on a laptop panel and on a 4K monitor.
      sh.setFloat('uScanlineCount', height * 0.5);
      sh.setFloat('uChromatic', s.chromatic);
      sh.setFloat('uGrain', s.grain);
      sh.setFloat('uTime', time);
      sh.setVec2('uResolution', width, height);
      sh.setFloat('uFlash', s.flash);
      sh.setVec3(
        'uFlashColor',
        ((s.flashColor >> 16) & 0xff) / 255,
        ((s.flashColor >> 8) & 0xff) / 255,
        (s.flashColor & 0xff) / 255,
      );
      sh.setFloat('uDesaturate', s.desaturate);
    });
  }

  dispose(): void {
    this.shader.dispose();
  }
}
