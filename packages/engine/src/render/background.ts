import { Shader } from './shader.js';
import { FullscreenPass } from './post/fullscreen.js';

/**
 * Sky backdrop.
 *
 * One fullscreen pass: a vertical gradient, drifting clouds, and a soft sun
 * glow. No geometry and no textures, so it costs the same whether the player
 * is zoomed into one tile or looking at the whole island.
 *
 * The clouds scroll with the camera at a fraction of its speed. Parallax is
 * the cheapest possible depth cue and the difference between a sky and a
 * coloured rectangle, but it has to be gentle - clouds that track the camera
 * one-to-one look pinned to the screen, and clouds that ignore it entirely
 * make the world feel like it is sliding around underneath a poster.
 */

const BACKGROUND_FRAG = `#version 300 es
precision highp float;

in vec2 vUV;

uniform vec2  uResolution;
uniform vec2  uCamera;
uniform float uZoom;
uniform float uTime;
uniform vec3  uSkyTop;
uniform vec3  uSkyMid;
uniform vec3  uSkyLow;
uniform vec3  uCloud;
uniform float uIntensity;

layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outEmissive;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    sum += valueNoise(p) * amp;
    p *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

void main() {
  vec2 uv = vUV;

  // Two-stop gradient: deeper blue overhead, pale at the horizon. Three
  // stops rather than two because a linear blue-to-white ramp reads as a
  // gradient tool, and the extra midpoint reads as air.
  vec3 sky = mix(uSkyLow, uSkyMid, smoothstep(0.0, 0.62, uv.y));
  sky = mix(sky, uSkyTop, smoothstep(0.45, 1.0, uv.y));

  // Sun glow in the upper left, which is where every surface in the world is
  // shaded as if the light were coming from.
  vec2 sunPos = vec2(0.22, 0.86);
  float sunDist = distance(vec2(uv.x, uv.y * (uResolution.y / uResolution.x)),
                           vec2(sunPos.x, sunPos.y * (uResolution.y / uResolution.x)));
  sky += vec3(1.0, 0.93, 0.72) * (1.0 - smoothstep(0.0, 0.55, sunDist)) * 0.30;

  // Clouds. Camera parallax at a fraction of world speed, plus a slow drift
  // of their own so the sky is alive when the camera is parked.
  vec2 cloudUV = uv * vec2(uResolution.x / uResolution.y, 1.0) * 1.6;
  cloudUV += uCamera * 0.00018;
  cloudUV.x += uTime * 0.006;

  float far = fbm(cloudUV * 1.1 + vec2(0.0, 0.3));
  float near = fbm(cloudUV * 2.3 - vec2(uTime * 0.004, 0.0));

  // Clouds live in the upper part of the sky and thin out toward the horizon.
  float band = smoothstep(0.18, 0.72, uv.y);
  float farMask = smoothstep(0.56, 0.78, far) * band * 0.55;
  float nearMask = smoothstep(0.62, 0.84, near) * band * 0.85;

  sky = mix(sky, uCloud * 0.94, farMask);
  sky = mix(sky, uCloud, nearMask);

  outColor = vec4(sky * uIntensity, 1.0);
  // Only the sun disc region blooms. Clouds that glow look like they are on
  // fire, which is not the weather this game is set in.
  float sunCore = 1.0 - smoothstep(0.0, 0.16, sunDist);
  outEmissive = vec4(vec3(1.0, 0.95, 0.78) * sunCore * 0.85, 1.0);
}`;

export interface BackgroundColors {
  skyTop: number;
  skyMid: number;
  skyLow: number;
  cloud: number;
}

export const DEFAULT_BACKGROUND: BackgroundColors = {
  skyTop: 0x4fbcf0,
  skyMid: 0x93dcfa,
  skyLow: 0xd9f4ff,
  cloud: 0xffffff,
};

export class BackgroundPass {
  private readonly shader: Shader;
  colors: BackgroundColors = { ...DEFAULT_BACKGROUND };
  intensity = 1;

  constructor(
    _gl: WebGL2RenderingContext,
    private readonly fullscreen: FullscreenPass,
  ) {
    this.shader = fullscreen.makeShader(BACKGROUND_FRAG, 'sky');
  }

  render(
    width: number,
    height: number,
    cameraX: number,
    cameraY: number,
    zoom: number,
    time: number,
  ): void {
    this.fullscreen.run(this.shader, (s) => {
      s.setVec2('uResolution', width, height);
      s.setVec2('uCamera', cameraX, cameraY);
      s.setFloat('uZoom', zoom);
      s.setFloat('uTime', time);
      s.setFloat('uIntensity', this.intensity);
      setRgb(s, 'uSkyTop', this.colors.skyTop);
      setRgb(s, 'uSkyMid', this.colors.skyMid);
      setRgb(s, 'uSkyLow', this.colors.skyLow);
      setRgb(s, 'uCloud', this.colors.cloud);
    });
  }

  dispose(): void {
    this.shader.dispose();
  }
}

function setRgb(s: Shader, name: string, rgb: number): void {
  s.setVec3(name, ((rgb >> 16) & 0xff) / 255, ((rgb >> 8) & 0xff) / 255, (rgb & 0xff) / 255);
}
