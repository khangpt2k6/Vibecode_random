/**
 * Texture and render-target wrappers.
 *
 * The game ships almost no image assets - the world is drawn from polygons -
 * so textures here serve three jobs: the runtime-generated glyph atlas, the
 * small set of procedural particle sprites, and the offscreen targets the
 * post-processing chain ping-pongs between.
 */

import { getCaps } from './caps.js';

export interface TextureOptions {
  /** Nearest keeps generated pixel sprites crisp; linear suits blur targets. */
  filter?: 'nearest' | 'linear';
  wrap?: 'clamp' | 'repeat';
  /** Half-float targets so bloom can hold values above 1 without clipping. */
  format?: 'rgba8' | 'rgba16f';
  generateMipmaps?: boolean;
}

export class Texture {
  readonly handle: WebGLTexture;
  width: number;
  height: number;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    width: number,
    height: number,
    private readonly opts: TextureOptions = {},
  ) {
    const handle = gl.createTexture();
    if (!handle) throw new Error('Texture: createTexture returned null');
    this.handle = handle;
    this.width = width;
    this.height = height;

    gl.bindTexture(gl.TEXTURE_2D, handle);
    this.allocate(width, height);
    this.applyParams();
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /** The format actually in use, after any capability downgrade. */
  get format(): 'rgba8' | 'rgba16f' {
    return this.opts.format === 'rgba16f' && getCaps(this.gl).floatRenderTargets
      ? 'rgba16f'
      : 'rgba8';
  }

  private allocate(width: number, height: number): void {
    const gl = this.gl;
    if (this.format === 'rgba16f') {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
  }

  private applyParams(): void {
    const gl = this.gl;
    const filter = this.opts.filter === 'nearest' ? gl.NEAREST : gl.LINEAR;
    const wrap = this.opts.wrap === 'repeat' ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  }

  /** Upload from any canvas-like source. Used by the glyph atlas. */
  static fromSource(
    gl: WebGL2RenderingContext,
    source: TexImageSource,
    opts: TextureOptions = {},
  ): Texture {
    // Allocate 1x1 then immediately replace, so all the parameter setup lives
    // in one place rather than being duplicated for the two creation paths.
    const tex = new Texture(gl, 1, 1, opts);
    tex.update(source);
    return tex;
  }

  /** Replace the whole image, e.g. after the glyph atlas grows a page. */
  update(source: TexImageSource): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.handle);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if ('width' in source) this.width = source.width as number;
    if ('height' in source) this.height = source.height as number;
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  resize(width: number, height: number): void {
    if (this.width === width && this.height === height) return;
    this.width = width;
    this.height = height;
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.handle);
    this.allocate(width, height);
    this.gl.bindTexture(this.gl.TEXTURE_2D, null);
  }

  bind(unit = 0): void {
    this.gl.activeTexture(this.gl.TEXTURE0 + unit);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.handle);
  }

  dispose(): void {
    this.gl.deleteTexture(this.handle);
  }
}

/**
 * Offscreen render target.
 *
 * Supports multiple colour attachments, which the scene pass uses to write
 * shaded colour and emissive brightness in one go. Doing that in a single
 * pass rather than re-rendering the world for the glow mask is the difference
 * between bloom being nearly free and bloom doubling the frame cost.
 */
export class RenderTarget {
  readonly framebuffer: WebGLFramebuffer;
  readonly textures: Texture[] = [];
  width: number;
  height: number;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    width: number,
    height: number,
    attachments = 1,
    opts: TextureOptions = { filter: 'linear', format: 'rgba16f' },
  ) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);

    const fb = gl.createFramebuffer();
    if (!fb) throw new Error('RenderTarget: createFramebuffer returned null');
    this.framebuffer = fb;

    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    const buffers: number[] = [];
    for (let i = 0; i < attachments; i++) {
      const tex = new Texture(gl, this.width, this.height, opts);
      this.textures.push(tex);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0 + i,
        gl.TEXTURE_2D,
        tex.handle,
        0,
      );
      buffers.push(gl.COLOR_ATTACHMENT0 + i);
    }
    gl.drawBuffers(buffers);

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const caps = getCaps(gl);
      throw new Error(
        `RenderTarget is incomplete: 0x${status.toString(16)} ` +
          `(${this.width}x${this.height}, ${attachments} attachment(s), ` +
          `float targets ${caps.floatRenderTargets ? 'on' : 'off'}, ` +
          `renderer "${caps.renderer}")`,
      );
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  bind(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.viewport(0, 0, this.width, this.height);
  }

  resize(width: number, height: number): void {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    if (this.width === w && this.height === h) return;
    this.width = w;
    this.height = h;
    for (const tex of this.textures) tex.resize(w, h);
  }

  get texture(): Texture {
    return this.textures[0]!;
  }

  dispose(): void {
    for (const tex of this.textures) tex.dispose();
    this.gl.deleteFramebuffer(this.framebuffer);
  }
}

/** Restore rendering to the canvas itself. */
export function bindScreen(
  gl: WebGL2RenderingContext,
  drawWidth: number,
  drawHeight: number,
): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, drawWidth, drawHeight);
}
