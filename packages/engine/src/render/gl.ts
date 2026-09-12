/**
 * WebGL2 context setup and small helpers.
 *
 * WebGL2 rather than WebGL1 because the renderer leans on vertex array
 * objects, instanced drawing, and `texelFetch` for the glyph atlas. WebGL2 is
 * available in every browser that matters now, so there is no fallback path -
 * a missing context is a hard, explained failure rather than a silent
 * degradation that makes the game look broken.
 */

import { getCaps } from './caps.js';

export interface GLContext {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  /** CSS pixels. */
  width: number;
  height: number;
  /** Backing-store pixels, i.e. width * dpr. */
  drawWidth: number;
  drawHeight: number;
  dpr: number;
}

export class WebGLUnavailableError extends Error {
  constructor() {
    super(
      'WebGL2 is not available in this browser. STACKMON needs WebGL2 for its ' +
        'renderer. Try a current Chrome, Firefox, Edge, or Safari, and check ' +
        'that hardware acceleration is enabled.',
    );
    this.name = 'WebGLUnavailableError';
  }
}

export function createGLContext(canvas: HTMLCanvasElement): GLContext {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    // We composite our own background, so the depth and stencil buffers are
    // dead weight - the renderer sorts on the CPU (painter order).
    depth: false,
    stencil: false,
    antialias: false, // we supersample via DPR and post-process instead
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
    // Not desynchronized. The low-latency path lets the canvas bypass the
    // page compositor, which buys a frame of input latency at the cost of
    // the canvas tearing under any external capture - screenshots came back
    // showing the world but missing the UI drawn later in the same frame.
    // A frame of latency is worth far less than being able to trust what a
    // screenshot shows.
    desynchronized: false,
  });

  if (!gl) throw new WebGLUnavailableError();

  // Probe (and thereby enable) the optional extensions up front, so the first
  // render target created already has float attachments available to it.
  getCaps(gl);

  const ctx: GLContext = {
    gl,
    canvas,
    width: 0,
    height: 0,
    drawWidth: 0,
    drawHeight: 0,
    dpr: 1,
  };

  resize(ctx);
  return ctx;
}

/**
 * Match the drawing buffer to the element's real pixel size.
 *
 * DPR is capped at 2: beyond that the fill-rate cost of the bloom passes
 * outweighs any visible sharpening, and 4x phones would otherwise render
 * 16x the pixels for nothing.
 */
export function resize(ctx: GLContext, maxDpr = 2): boolean {
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  const rect = ctx.canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const drawWidth = Math.max(1, Math.round(width * dpr));
  const drawHeight = Math.max(1, Math.round(height * dpr));

  if (ctx.drawWidth === drawWidth && ctx.drawHeight === drawHeight) return false;

  ctx.canvas.width = drawWidth;
  ctx.canvas.height = drawHeight;
  ctx.width = width;
  ctx.height = height;
  ctx.drawWidth = drawWidth;
  ctx.drawHeight = drawHeight;
  ctx.dpr = dpr;
  ctx.gl.viewport(0, 0, drawWidth, drawHeight);
  return true;
}

/** Standard premultiplied-alpha blending. */
export function setBlendNormal(gl: WebGL2RenderingContext): void {
  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
}

/** Additive blending, for glow, sparks, and energy trails. */
export function setBlendAdditive(gl: WebGL2RenderingContext): void {
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
}

export function clear(gl: WebGL2RenderingContext, r: number, g: number, b: number, a = 1): void {
  gl.clearColor(r, g, b, a);
  gl.clear(gl.COLOR_BUFFER_BIT);
}

/**
 * Pack an 0xRRGGBB colour plus alpha into the single float the vertex format
 * carries. Keeps a vertex at 6 floats instead of 9, which roughly halves the
 * bandwidth of a full-screen tile pass.
 */
export function packColor(rgb: number, alpha = 1): number {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;
  // ABGR order so the shader can unpack straight into vec4 rgba.
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

const scratch = new DataView(new ArrayBuffer(4));

/** Reinterpret a packed uint32 colour as the float32 that goes in the VBO. */
export function colorToFloat(packed: number): number {
  scratch.setUint32(0, packed, true);
  return scratch.getFloat32(0, true);
}

export const rgba = (rgb: number, alpha = 1): number => colorToFloat(packColor(rgb, alpha));

/** Blend two 0xRRGGBB colours in sRGB space. Good enough for UI tinting. */
export function mixRgb(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/**
 * Multiply a colour by a lighting factor, clamped. Used for isometric faces.
 *
 * Multiplication, not a mix toward white. Mixing brightens by a fraction of
 * the distance to white, which on a dark colour is enormous - a 1.18 "slight
 * highlight" on a near-black blue lands halfway to grey and takes the hue
 * with it. Scaling keeps the hue and keeps dark things dark.
 */
export function shadeRgb(c: number, f: number): number {
  const r = Math.min(255, Math.round(((c >> 16) & 0xff) * f));
  const g = Math.min(255, Math.round(((c >> 8) & 0xff) * f));
  const b = Math.min(255, Math.round((c & 0xff) * f));
  return (r << 16) | (g << 8) | b;
}
