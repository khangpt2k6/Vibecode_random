import { Shader } from '../shader.js';
import { RenderTarget } from '../texture.js';
import { FullscreenPass } from './fullscreen.js';

/**
 * Progressive dual-filter bloom.
 *
 * Downsample the emissive buffer through a mip chain with a 13-tap filter,
 * then upsample back through it with a 9-tap tent filter, adding each level
 * into the one above. This is the approach from the Call of Duty: Advanced
 * Warfare presentation, and it is the right one here for two reasons: the
 * wide, soft falloff is what makes neon read as light rather than as a
 * blurred copy of the geometry, and the cost is dominated by the smallest
 * mips, so a very wide glow stays cheap.
 *
 * The input is the emissive attachment the batches write, not a brightness
 * threshold of the final image. That matters: thresholding would make bright
 * surfaces glow just for being bright, which turns a white UI panel into a
 * lamp. Here, only geometry that asked to emit actually emits.
 */

const DOWNSAMPLE_FRAG = `#version 300 es
precision highp float;

in vec2 vUV;
uniform sampler2D uSource;
uniform vec2 uTexelSize;

out vec4 outColor;

void main() {
  vec2 t = uTexelSize;

  // 13-tap partial Karis average. The grouped weighting is what kills the
  // flickering fireflies a naive box downsample leaves behind.
  vec3 a = texture(uSource, vUV + vec2(-2.0 * t.x,  2.0 * t.y)).rgb;
  vec3 b = texture(uSource, vUV + vec2( 0.0,        2.0 * t.y)).rgb;
  vec3 c = texture(uSource, vUV + vec2( 2.0 * t.x,  2.0 * t.y)).rgb;

  vec3 d = texture(uSource, vUV + vec2(-2.0 * t.x,  0.0)).rgb;
  vec3 e = texture(uSource, vUV).rgb;
  vec3 f = texture(uSource, vUV + vec2( 2.0 * t.x,  0.0)).rgb;

  vec3 g = texture(uSource, vUV + vec2(-2.0 * t.x, -2.0 * t.y)).rgb;
  vec3 h = texture(uSource, vUV + vec2( 0.0,       -2.0 * t.y)).rgb;
  vec3 i = texture(uSource, vUV + vec2( 2.0 * t.x, -2.0 * t.y)).rgb;

  vec3 j = texture(uSource, vUV + vec2(-t.x,  t.y)).rgb;
  vec3 k = texture(uSource, vUV + vec2( t.x,  t.y)).rgb;
  vec3 l = texture(uSource, vUV + vec2(-t.x, -t.y)).rgb;
  vec3 m = texture(uSource, vUV + vec2( t.x, -t.y)).rgb;

  vec3 result = e * 0.125;
  result += (a + c + g + i) * 0.03125;
  result += (b + d + f + h) * 0.0625;
  result += (j + k + l + m) * 0.125;

  outColor = vec4(result, 1.0);
}`;

const UPSAMPLE_FRAG = `#version 300 es
precision highp float;

in vec2 vUV;
uniform sampler2D uSource;
uniform vec2 uTexelSize;
uniform float uRadius;

out vec4 outColor;

void main() {
  vec2 t = uTexelSize * uRadius;

  // 9-tap tent. Cheap, and the soft edge is exactly what a glow wants.
  vec3 sum = texture(uSource, vUV + vec2(-t.x,  t.y)).rgb * 1.0;
  sum += texture(uSource, vUV + vec2( 0.0,  t.y)).rgb * 2.0;
  sum += texture(uSource, vUV + vec2( t.x,  t.y)).rgb * 1.0;
  sum += texture(uSource, vUV + vec2(-t.x,  0.0)).rgb * 2.0;
  sum += texture(uSource, vUV).rgb * 4.0;
  sum += texture(uSource, vUV + vec2( t.x,  0.0)).rgb * 2.0;
  sum += texture(uSource, vUV + vec2(-t.x, -t.y)).rgb * 1.0;
  sum += texture(uSource, vUV + vec2( 0.0, -t.y)).rgb * 2.0;
  sum += texture(uSource, vUV + vec2( t.x, -t.y)).rgb * 1.0;

  outColor = vec4(sum / 16.0, 1.0);
}`;

export interface BloomOptions {
  /** Mip levels in the chain. More levels, wider and softer the glow. */
  levels?: number;
  /** Tent filter spread on the way back up. 1 is tight, 3 is dreamy. */
  radius?: number;
}

export class BloomPass {
  private readonly downsampleShader: Shader;
  private readonly upsampleShader: Shader;
  private mips: RenderTarget[] = [];
  private readonly levels: number;

  radius: number;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly fullscreen: FullscreenPass,
    width: number,
    height: number,
    opts: BloomOptions = {},
  ) {
    this.levels = opts.levels ?? 6;
    this.radius = opts.radius ?? 1.4;

    this.downsampleShader = fullscreen.makeShader(DOWNSAMPLE_FRAG, 'bloom-downsample');
    this.upsampleShader = fullscreen.makeShader(UPSAMPLE_FRAG, 'bloom-upsample');

    this.allocate(width, height);
  }

  private allocate(width: number, height: number): void {
    for (const m of this.mips) m.dispose();
    this.mips = [];

    let w = width;
    let h = height;
    for (let i = 0; i < this.levels; i++) {
      w = Math.max(1, Math.floor(w / 2));
      h = Math.max(1, Math.floor(h / 2));
      this.mips.push(
        new RenderTarget(this.gl, w, h, 1, { filter: 'linear', format: 'rgba16f' }),
      );
      // Below about 4 pixels the blur has nothing left to say, and sampling
      // a 1x1 target just wastes a pass.
      if (w <= 4 || h <= 4) break;
    }
  }

  resize(width: number, height: number): void {
    const first = this.mips[0];
    if (first && first.width === Math.floor(width / 2)) return;
    this.allocate(width, height);
  }

  /**
   * Run the chain over `emissive` and return the texture holding the glow.
   * The result lives in mip 0, at half the input resolution - the composite
   * pass upsamples it for free with a linear fetch.
   */
  render(emissive: WebGLTexture): WebGLTexture {
    const gl = this.gl;
    gl.disable(gl.BLEND);

    // Down the chain.
    let source = emissive;
    let sourceW = this.mips[0]!.width * 2;
    let sourceH = this.mips[0]!.height * 2;
    for (const mip of this.mips) {
      mip.bind();
      this.fullscreen.run(this.downsampleShader, (s) => {
        s.setTexture('uSource', source, 0);
        s.setVec2('uTexelSize', 1 / sourceW, 1 / sourceH);
      });
      source = mip.texture.handle;
      sourceW = mip.width;
      sourceH = mip.height;
    }

    // Back up, adding each level into the one above it.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = this.mips.length - 1; i > 0; i--) {
      const from = this.mips[i]!;
      const to = this.mips[i - 1]!;
      to.bind();
      this.fullscreen.run(this.upsampleShader, (s) => {
        s.setTexture('uSource', from.texture.handle, 0);
        s.setVec2('uTexelSize', 1 / from.width, 1 / from.height);
        s.setFloat('uRadius', this.radius);
      });
    }
    gl.disable(gl.BLEND);

    return this.mips[0]!.texture.handle;
  }

  dispose(): void {
    for (const m of this.mips) m.dispose();
    this.downsampleShader.dispose();
    this.upsampleShader.dispose();
  }
}
