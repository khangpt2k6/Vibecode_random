import { Shader } from '../shader.js';

/**
 * Fullscreen pass helper.
 *
 * Every post-process step is "run this fragment shader over every pixel", so
 * they all share one oversized triangle. A triangle rather than a quad: it
 * covers the screen with three vertices instead of six and, more usefully,
 * has no diagonal seam where the two halves of a quad meet, which otherwise
 * shows up as a faint crease in wide blur kernels.
 */

export const FULLSCREEN_VERT = `#version 300 es
precision highp float;

out vec2 vUV;

void main() {
  // Vertex 0 -> (-1,-1), 1 -> (3,-1), 2 -> (-1,3). Clipped to the viewport
  // this is exactly the screen, with UVs interpolating 0..1 across it.
  vec2 pos = vec2(
    float((gl_VertexID & 1) << 2) - 1.0,
    float((gl_VertexID & 2) << 1) - 1.0
  );
  vUV = pos * 0.5 + 0.5;
  gl_Position = vec4(pos, 0.0, 1.0);
}`;

export class FullscreenPass {
  private readonly vao: WebGLVertexArrayObject;

  constructor(private readonly gl: WebGL2RenderingContext) {
    // An empty VAO is still required: WebGL2 refuses to draw without one
    // bound, even when the vertex shader reads nothing but gl_VertexID.
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('FullscreenPass: createVertexArray returned null');
    this.vao = vao;
  }

  run(shader: Shader, setup?: (s: Shader) => void): void {
    const gl = this.gl;
    shader.use();
    setup?.(shader);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  makeShader(fragmentSource: string, name: string): Shader {
    return new Shader(this.gl, FULLSCREEN_VERT, fragmentSource, name);
  }

  dispose(): void {
    this.gl.deleteVertexArray(this.vao);
  }
}
