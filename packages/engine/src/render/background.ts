import { Shader } from './shader.js';
import { FullscreenPass } from './post/fullscreen.js';

/**
 * Animated circuit-grid backdrop.
 *
 * Drawn before the world, in one fullscreen pass, entirely in the fragment
 * shader. There is no geometry and no texture, so it costs one pass no matter
 * how far the player zooms out.
 *
 * It scrolls and scales with the camera, which is the whole point: a static
 * backdrop behind a moving isometric world immediately reads as a cheap
 * parallax cheat. Tying it to camera world-space instead means the grid is
 * part of the same place the player is standing in.
 */

const BACKGROUND_FRAG = `#version 300 es
precision highp float;

in vec2 vUV;

uniform vec2  uResolution;
uniform vec2  uCamera;     // camera centre in world pixels
uniform float uZoom;
uniform float uTime;
uniform vec3  uColorDeep;  // furthest back
uniform vec3  uColorGrid;
uniform vec3  uColorTrace; // the bright pulses
uniform float uIntensity;

// Two outputs, because the scene target this draws into has two attachments.
// A fullscreen pass that declares only one leaves the second undefined, and
// the emissive buffer then feeds the bloom whatever was left in memory.
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outEmissive;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// One layer of grid lines, in world units, anti-aliased via fwidth so the
// lines stay one pixel wide at every zoom instead of aliasing into moire.
float gridLines(vec2 world, float spacing, float thickness) {
  vec2 g = abs(fract(world / spacing - 0.5) - 0.5) / fwidth(world / spacing);
  float line = min(g.x, g.y);
  return 1.0 - smoothstep(0.0, thickness, line);
}

void main() {
  vec2 pixel = (vUV - 0.5) * uResolution;
  vec2 world = pixel / uZoom + uCamera;

  vec3 color = uColorDeep;
  vec3 glow = vec3(0.0);

  // Two grid scales: a fine one that fades out when zoomed far out, and a
  // coarse one that carries the structure at every distance.
  float fine = gridLines(world, 128.0, 1.3);
  float coarse = gridLines(world, 512.0, 1.7);
  float fineFade = smoothstep(0.14, 0.42, uZoom);

  color = mix(color, uColorGrid, fine * 0.34 * fineFade);
  color = mix(color, uColorGrid, coarse * 0.55);

  // Node dots where the coarse lines cross. Junctions give the grid a sense
  // of being a circuit rather than graph paper.
  vec2 toNode = abs(fract(world / 512.0 - 0.5) - 0.5) * 512.0;
  float node = 1.0 - smoothstep(2.0, 5.0, length(toNode));
  color = mix(color, uColorTrace, node * 0.30);
  glow += uColorTrace * node * 0.35;

  // Data pulses: pick a cell, give it a phase, run a bright dash along its
  // row. Sparse on purpose - constant motion everywhere is exhausting to
  // look at for the hours this game expects.
  vec2 cell = floor(world / 512.0);
  float seed = hash21(cell);
  if (seed > 0.72) {
    float phase = fract(uTime * 0.18 + seed * 7.31);
    vec2 local = fract(world / 512.0);
    float along = seed > 0.9 ? local.x : local.y;
    float across = seed > 0.9 ? local.y : local.x;

    float head = 1.0 - smoothstep(0.0, 0.10, abs(along - phase));
    float onLine = 1.0 - smoothstep(0.0, 0.012, abs(across - 0.5));
    vec3 pulse = uColorTrace * head * onLine;
    color += pulse * 0.9;
    glow += pulse * 1.5;
  }

  // Slow vertical drift, so the backdrop is never completely still even when
  // the camera is parked.
  float breathe = 0.94 + 0.06 * sin(uTime * 0.35 + world.y * 0.0006);
  color *= breathe;

  color *= uIntensity;
  outColor = vec4(color, 1.0);
  // Only the pulses and junction nodes glow; the grid itself must not, or the
  // whole backdrop turns into a light source and swallows the world on it.
  outEmissive = vec4(glow * uIntensity, 1.0);
}`;

export interface BackgroundColors {
  deep: number;
  grid: number;
  trace: number;
}

export const DEFAULT_BACKGROUND: BackgroundColors = {
  deep: 0x070c1a,
  grid: 0x31497c,
  trace: 0x4de0ff,
};

export class BackgroundPass {
  private readonly shader: Shader;
  colors: BackgroundColors = { ...DEFAULT_BACKGROUND };
  intensity = 1;

  constructor(
    _gl: WebGL2RenderingContext,
    private readonly fullscreen: FullscreenPass,
  ) {
    this.shader = fullscreen.makeShader(BACKGROUND_FRAG, 'background');
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
      setRgb(s, 'uColorDeep', this.colors.deep);
      setRgb(s, 'uColorGrid', this.colors.grid);
      setRgb(s, 'uColorTrace', this.colors.trace);
    });
  }

  dispose(): void {
    this.shader.dispose();
  }
}

function setRgb(s: Shader, name: string, rgb: number): void {
  s.setVec3(name, ((rgb >> 16) & 0xff) / 255, ((rgb >> 8) & 0xff) / 255, (rgb & 0xff) / 255);
}
