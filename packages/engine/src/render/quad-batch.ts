import { Shader } from './shader.js';
import { packColor } from './gl.js';
import type { Texture } from './texture.js';

/**
 * Batched renderer for textured quads.
 *
 * Used for glyphs, particle sprites, and the handful of procedural icon
 * textures. Batches break only when the bound texture changes, so the glyph
 * atlas being a single page means all the text in a frame is one draw call.
 *
 * Vertex format matches ShapeBatch conventions: an emissive weight rides
 * alongside the colour so text and sparks can feed the bloom pass.
 */

const FLOATS_PER_VERTEX = 6; // x, y, u, v, packedColor, emissive
const MAX_QUADS = 8192;
const MAX_VERTICES = MAX_QUADS * 4;

const VERT_SRC = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aPos;
layout(location = 1) in vec2 aUV;
layout(location = 2) in vec4 aColor;
layout(location = 3) in float aEmissive;

uniform mat3 uProjection;

out vec2 vUV;
out vec4 vColor;
out float vEmissive;

void main() {
  vec3 clip = uProjection * vec3(aPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  vUV = aUV;
  vColor = aColor;
  vEmissive = aEmissive;
}`;

const FRAG_SRC = `#version 300 es
precision highp float;

in vec2 vUV;
in vec4 vColor;
in float vEmissive;

uniform sampler2D uTexture;

layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outEmissive;

void main() {
  // The atlas is uploaded premultiplied, so tinting only scales it.
  vec4 texel = texture(uTexture, vUV);
  vec4 c = texel * vec4(vColor.rgb, 1.0) * vColor.a;
  if (c.a < 0.002) discard;
  outColor = c;
  outEmissive = vec4(c.rgb * vEmissive, c.a);
}`;

export class QuadBatch {
  private readonly shader: Shader;
  private readonly vao: WebGLVertexArrayObject;
  private readonly vbo: WebGLBuffer;
  private readonly ibo: WebGLBuffer;

  private readonly vertexData = new ArrayBuffer(MAX_VERTICES * FLOATS_PER_VERTEX * 4);
  private readonly f32 = new Float32Array(this.vertexData);
  private readonly u32 = new Uint32Array(this.vertexData);

  private quadCount = 0;
  private currentTexture: Texture | null = null;
  private started = false;
  /** See the note in ShapeBatch: flush must bind its own program. */
  private projection = new Float32Array(9);

  drawCalls = 0;
  quadsDrawn = 0;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.shader = new Shader(gl, VERT_SRC, FRAG_SRC, 'quad-batch');

    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    const ibo = gl.createBuffer();
    if (!vao || !vbo || !ibo) throw new Error('QuadBatch: failed to allocate GL objects');
    this.vao = vao;
    this.vbo = vbo;
    this.ibo = ibo;

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.vertexData.byteLength, gl.DYNAMIC_DRAW);

    const stride = FLOATS_PER_VERTEX * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, stride, 16);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 20);

    // Quad indices never change, so build them once as a static buffer.
    const indices = new Uint16Array(MAX_QUADS * 6);
    for (let i = 0; i < MAX_QUADS; i++) {
      const v = i * 4;
      const o = i * 6;
      indices[o] = v;
      indices[o + 1] = v + 1;
      indices[o + 2] = v + 2;
      indices[o + 3] = v;
      indices[o + 4] = v + 2;
      indices[o + 5] = v + 3;
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    gl.bindVertexArray(null);
  }

  begin(projection: Float32Array): void {
    this.projection.set(projection);
    this.started = true;
    this.quadCount = 0;
    this.currentTexture = null;
  }

  end(): void {
    this.flush();
    this.started = false;
  }

  resetStats(): void {
    this.drawCalls = 0;
    this.quadsDrawn = 0;
  }

  private vertex(
    i: number, x: number, y: number, u: number, v: number, color: number, emissive: number,
  ): void {
    this.f32[i] = x;
    this.f32[i + 1] = y;
    this.f32[i + 2] = u;
    this.f32[i + 3] = v;
    this.u32[i + 4] = color;
    this.f32[i + 5] = emissive;
  }

  /** Axis-aligned textured quad. `u0..v1` are normalised atlas coordinates. */
  draw(
    texture: Texture,
    x: number, y: number, w: number, h: number,
    u0 = 0, v0 = 0, u1 = 1, v1 = 1,
    rgb = 0xffffff, alpha = 1, emissive = 0,
  ): void {
    if (!this.started) throw new Error('QuadBatch: draw called outside begin/end');
    if (texture !== this.currentTexture || this.quadCount >= MAX_QUADS) {
      this.flush();
      this.currentTexture = texture;
    }

    const c = packColor(rgb, alpha);
    const base = this.quadCount * 4 * FLOATS_PER_VERTEX;
    this.vertex(base, x, y, u0, v0, c, emissive);
    this.vertex(base + FLOATS_PER_VERTEX, x + w, y, u1, v0, c, emissive);
    this.vertex(base + FLOATS_PER_VERTEX * 2, x + w, y + h, u1, v1, c, emissive);
    this.vertex(base + FLOATS_PER_VERTEX * 3, x, y + h, u0, v1, c, emissive);
    this.quadCount++;
  }

  /** Rotated and scaled quad about its own centre. */
  drawTransformed(
    texture: Texture,
    cx: number, cy: number, w: number, h: number, rotation: number,
    u0 = 0, v0 = 0, u1 = 1, v1 = 1,
    rgb = 0xffffff, alpha = 1, emissive = 0,
  ): void {
    if (!this.started) throw new Error('QuadBatch: draw called outside begin/end');
    if (texture !== this.currentTexture || this.quadCount >= MAX_QUADS) {
      this.flush();
      this.currentTexture = texture;
    }

    const hw = w * 0.5;
    const hh = h * 0.5;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const c = packColor(rgb, alpha);
    const base = this.quadCount * 4 * FLOATS_PER_VERTEX;

    const corners: Array<[number, number, number, number]> = [
      [-hw, -hh, u0, v0],
      [hw, -hh, u1, v0],
      [hw, hh, u1, v1],
      [-hw, hh, u0, v1],
    ];
    for (let i = 0; i < 4; i++) {
      const [lx, ly, u, v] = corners[i]!;
      this.vertex(
        base + i * FLOATS_PER_VERTEX,
        cx + lx * cos - ly * sin,
        cy + lx * sin + ly * cos,
        u, v, c, emissive,
      );
    }
    this.quadCount++;
  }

  flush(): void {
    if (this.quadCount === 0 || !this.currentTexture) return;
    const gl = this.gl;

    this.shader.use();
    this.shader.setMat3('uProjection', this.projection);
    this.shader.setTexture('uTexture', this.currentTexture.handle, 0);

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(
      gl.ARRAY_BUFFER,
      0,
      this.f32.subarray(0, this.quadCount * 4 * FLOATS_PER_VERTEX),
    );
    gl.drawElements(gl.TRIANGLES, this.quadCount * 6, gl.UNSIGNED_SHORT, 0);

    this.drawCalls++;
    this.quadsDrawn += this.quadCount;
    this.quadCount = 0;
  }

  dispose(): void {
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteBuffer(this.vbo);
    this.gl.deleteBuffer(this.ibo);
    this.shader.dispose();
  }
}
