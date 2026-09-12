/**
 * GPU capability detection.
 *
 * WebGL2 guarantees RGBA16F as a *texture* format but not as a *renderable*
 * one - writing to a half-float framebuffer needs EXT_color_buffer_float (or
 * the narrower EXT_color_buffer_half_float on some mobile drivers). Asking
 * for one without enabling the extension gives you a framebuffer that reports
 * INCOMPLETE_ATTACHMENT at creation, which is exactly the kind of failure
 * that looks like a driver bug and is not.
 *
 * So: probe once per context, enable what exists, and let the render targets
 * quietly fall back to RGBA8 when the machine cannot do better. Bloom on an
 * 8-bit target clips highlights instead of rolling them off, which is a
 * visible downgrade but a long way from a black screen.
 */

export interface GLCaps {
  /** Half-float colour attachments are renderable. */
  floatRenderTargets: boolean;
  /** Half-float targets can be sampled with linear filtering. */
  floatLinearFilter: boolean;
  maxTextureSize: number;
  maxDrawBuffers: number;
  /** Human-readable renderer string, for bug reports. */
  renderer: string;
}

const cache = new WeakMap<WebGL2RenderingContext, GLCaps>();

export function getCaps(gl: WebGL2RenderingContext): GLCaps {
  const cached = cache.get(gl);
  if (cached) return cached;

  // Enabling is the act of calling getExtension - the return value only tells
  // us whether it worked.
  const colorBufferFloat =
    gl.getExtension('EXT_color_buffer_float') !== null ||
    gl.getExtension('EXT_color_buffer_half_float') !== null;

  let renderer = 'unknown';
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  if (debugInfo) {
    renderer = String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) ?? 'unknown');
  }

  const caps: GLCaps = {
    floatRenderTargets: colorBufferFloat,
    // Linear filtering of half-float textures is core in WebGL2;
    // OES_texture_float_linear only covers full 32-bit floats, which nothing
    // here uses. Bloom samples half-float, so this is always available.
    floatLinearFilter: true,
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    maxDrawBuffers: gl.getParameter(gl.MAX_DRAW_BUFFERS) as number,
    renderer,
  };

  cache.set(gl, caps);
  return caps;
}
