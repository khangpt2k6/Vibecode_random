import { Shader } from './shader.js';
import { packColor, shadeRgb } from './gl.js';
import type { GridPos, IsoConfig } from '../math/iso.js';
import { DEFAULT_ISO, gridToScreen } from '../math/iso.js';

/**
 * Batched renderer for flat-shaded polygons.
 *
 * This is where the look of the game comes from. Every tile, building, and
 * creature body is a set of coloured triangles rather than a bitmap, so the
 * world stays perfectly crisp at any zoom and any display density, and the
 * palette can be recoloured at runtime without touching an asset pipeline.
 *
 * Each vertex carries an `emissive` weight alongside its colour. The shader
 * writes colour to attachment 0 and colour * emissive to attachment 1, so the
 * bloom pass can glow the neon trim without washing out the solid surfaces
 * next to it. That separation is what keeps the neon from turning the whole
 * frame into fog.
 */

const FLOATS_PER_VERTEX = 4; // x, y, packedColor, emissive
const MAX_VERTICES = 65536; // Uint16 index ceiling
const MAX_INDICES = MAX_VERTICES * 3;

const VERT_SRC = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aPos;
layout(location = 1) in vec4 aColor;
layout(location = 2) in float aEmissive;

uniform mat3 uProjection;

out vec4 vColor;
out float vEmissive;

void main() {
  vec3 clip = uProjection * vec3(aPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  vColor = aColor;
  vEmissive = aEmissive;
}`;

const FRAG_SRC = `#version 300 es
precision highp float;

in vec4 vColor;
in float vEmissive;

layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outEmissive;

void main() {
  // Premultiplied: the blend func expects colour already scaled by alpha.
  vec3 rgb = vColor.rgb * vColor.a;
  outColor = vec4(rgb, vColor.a);
  outEmissive = vec4(rgb * vEmissive, vColor.a);
}`;

export class ShapeBatch {
  private readonly shader: Shader;
  private readonly vao: WebGLVertexArrayObject;
  private readonly vbo: WebGLBuffer;
  private readonly ibo: WebGLBuffer;

  /**
   * One backing buffer, two views. Positions go through the float view and
   * the packed colour through the uint view, which sidesteps the classic
   * trap of laundering a packed RGBA through a float: bit patterns whose
   * exponent is all ones are NaN, and an engine is allowed to canonicalise
   * those on store, silently corrupting the colour.
   */
  private readonly vertexData = new ArrayBuffer(MAX_VERTICES * FLOATS_PER_VERTEX * 4);
  private readonly f32 = new Float32Array(this.vertexData);
  private readonly u32 = new Uint32Array(this.vertexData);
  private readonly indices = new Uint16Array(MAX_INDICES);

  private vertexCount = 0;
  private indexCount = 0;
  private started = false;
  /**
   * Kept so `flush` can rebind its own program and projection.
   *
   * A batch may not assume its program is still current when it flushes:
   * sibling batches bind theirs between `begin` and `end`, and a flush that
   * inherits whichever program happens to be active draws this batch's
   * vertices through a completely unrelated shader - which fails silently,
   * because the attribute layout still "works", it just means something else.
   */
  private projection = new Float32Array(9);

  /** Draw calls issued since the last `resetStats`. */
  drawCalls = 0;
  trianglesDrawn = 0;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.shader = new Shader(gl, VERT_SRC, FRAG_SRC, 'shape-batch');

    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    const ibo = gl.createBuffer();
    if (!vao || !vbo || !ibo) throw new Error('ShapeBatch: failed to allocate GL objects');
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
    // Colour occupies 4 bytes at offset 8; read them as normalised u8 -> vec4.
    gl.vertexAttribPointer(1, 4, gl.UNSIGNED_BYTE, true, stride, 8);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 12);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.indices.byteLength, gl.DYNAMIC_DRAW);

    gl.bindVertexArray(null);
  }

  begin(projection: Float32Array): void {
    this.projection.set(projection);
    this.started = true;
    this.vertexCount = 0;
    this.indexCount = 0;
  }

  end(): void {
    this.flush();
    this.started = false;
  }

  resetStats(): void {
    this.drawCalls = 0;
    this.trianglesDrawn = 0;
  }

  /** Push one vertex, returning its index. `color` is a packed ABGR uint32. */
  private vertex(x: number, y: number, color: number, emissive: number): number {
    const i = this.vertexCount * FLOATS_PER_VERTEX;
    this.f32[i] = x;
    this.f32[i + 1] = y;
    this.u32[i + 2] = color;
    this.f32[i + 3] = emissive;
    return this.vertexCount++;
  }

  /** Make room for `verts` vertices and `idx` indices, flushing if needed. */
  private reserve(verts: number, idx: number): void {
    if (!this.started) throw new Error('ShapeBatch: draw called outside begin/end');
    if (this.vertexCount + verts > MAX_VERTICES || this.indexCount + idx > MAX_INDICES) {
      this.flush();
    }
  }

  triangle(
    x0: number, y0: number,
    x1: number, y1: number,
    x2: number, y2: number,
    rgb: number, alpha = 1, emissive = 0,
  ): void {
    this.reserve(3, 3);
    const c = packColor(rgb, alpha);
    const a = this.vertex(x0, y0, c, emissive);
    const b = this.vertex(x1, y1, c, emissive);
    const d = this.vertex(x2, y2, c, emissive);
    this.indices[this.indexCount++] = a;
    this.indices[this.indexCount++] = b;
    this.indices[this.indexCount++] = d;
  }

  /** Axis-aligned rectangle. */
  rect(x: number, y: number, w: number, h: number, rgb: number, alpha = 1, emissive = 0): void {
    this.quad(x, y, x + w, y, x + w, y + h, x, y + h, rgb, alpha, emissive);
  }

  /** Arbitrary quad, vertices in order (winding does not matter - no culling). */
  quad(
    x0: number, y0: number,
    x1: number, y1: number,
    x2: number, y2: number,
    x3: number, y3: number,
    rgb: number, alpha = 1, emissive = 0,
  ): void {
    this.reserve(4, 6);
    const c = packColor(rgb, alpha);
    const a = this.vertex(x0, y0, c, emissive);
    const b = this.vertex(x1, y1, c, emissive);
    const d = this.vertex(x2, y2, c, emissive);
    const e = this.vertex(x3, y3, c, emissive);
    const idx = this.indices;
    idx[this.indexCount++] = a;
    idx[this.indexCount++] = b;
    idx[this.indexCount++] = d;
    idx[this.indexCount++] = a;
    idx[this.indexCount++] = d;
    idx[this.indexCount++] = e;
  }

  /** Quad with a separate colour per corner, for gradients. */
  quadGradient(
    x0: number, y0: number, c0: number,
    x1: number, y1: number, c1: number,
    x2: number, y2: number, c2: number,
    x3: number, y3: number, c3: number,
    alpha = 1, emissive = 0,
  ): void {
    this.reserve(4, 6);
    const a = this.vertex(x0, y0, packColor(c0, alpha), emissive);
    const b = this.vertex(x1, y1, packColor(c1, alpha), emissive);
    const d = this.vertex(x2, y2, packColor(c2, alpha), emissive);
    const e = this.vertex(x3, y3, packColor(c3, alpha), emissive);
    const idx = this.indices;
    idx[this.indexCount++] = a;
    idx[this.indexCount++] = b;
    idx[this.indexCount++] = d;
    idx[this.indexCount++] = a;
    idx[this.indexCount++] = d;
    idx[this.indexCount++] = e;
  }

  /** Convex polygon as a triangle fan from the first vertex. */
  polygon(points: readonly number[], rgb: number, alpha = 1, emissive = 0): void {
    const n = points.length / 2;
    if (n < 3) return;
    this.reserve(n, (n - 2) * 3);
    const c = packColor(rgb, alpha);
    const base = this.vertexCount;
    for (let i = 0; i < n; i++) {
      this.vertex(points[i * 2]!, points[i * 2 + 1]!, c, emissive);
    }
    for (let i = 1; i < n - 1; i++) {
      this.indices[this.indexCount++] = base;
      this.indices[this.indexCount++] = base + i;
      this.indices[this.indexCount++] = base + i + 1;
    }
  }

  /** Thick line segment, drawn as a quad. */
  line(
    x0: number, y0: number,
    x1: number, y1: number,
    width: number, rgb: number, alpha = 1, emissive = 0,
  ): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return;
    const nx = (-dy / len) * width * 0.5;
    const ny = (dx / len) * width * 0.5;
    this.quad(
      x0 + nx, y0 + ny,
      x1 + nx, y1 + ny,
      x1 - nx, y1 - ny,
      x0 - nx, y0 - ny,
      rgb, alpha, emissive,
    );
  }

  /** Open polyline with mitre-free round-ish joints (segments plus dots). */
  polyline(
    points: readonly number[],
    width: number,
    rgb: number,
    alpha = 1,
    emissive = 0,
  ): void {
    const n = points.length / 2;
    for (let i = 0; i < n - 1; i++) {
      this.line(
        points[i * 2]!, points[i * 2 + 1]!,
        points[i * 2 + 2]!, points[i * 2 + 3]!,
        width, rgb, alpha, emissive,
      );
    }
    // Joint caps stop gaps showing at corners on thick lines.
    if (width > 2) {
      for (let i = 1; i < n - 1; i++) {
        this.circle(points[i * 2]!, points[i * 2 + 1]!, width * 0.5, rgb, alpha, emissive, 8);
      }
    }
  }

  circle(
    cx: number, cy: number, radius: number,
    rgb: number, alpha = 1, emissive = 0, segments = 24,
  ): void {
    this.reserve(segments + 1, segments * 3);
    const c = packColor(rgb, alpha);
    const centre = this.vertex(cx, cy, c, emissive);
    const base = this.vertexCount;
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      this.vertex(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, c, emissive);
    }
    for (let i = 0; i < segments; i++) {
      this.indices[this.indexCount++] = centre;
      this.indices[this.indexCount++] = base + i;
      this.indices[this.indexCount++] = base + ((i + 1) % segments);
    }
  }

  /** Ring / annulus, for selection halos and cooldown dials. */
  ring(
    cx: number, cy: number, radius: number, thickness: number,
    rgb: number, alpha = 1, emissive = 0, segments = 32,
    startAngle = 0, sweep = Math.PI * 2,
  ): void {
    const inner = Math.max(0, radius - thickness);
    this.reserve((segments + 1) * 2, segments * 6);
    const c = packColor(rgb, alpha);
    const base = this.vertexCount;
    for (let i = 0; i <= segments; i++) {
      const a = startAngle + (i / segments) * sweep;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      this.vertex(cx + cos * inner, cy + sin * inner, c, emissive);
      this.vertex(cx + cos * radius, cy + sin * radius, c, emissive);
    }
    for (let i = 0; i < segments; i++) {
      const i0 = base + i * 2;
      const idx = this.indices;
      idx[this.indexCount++] = i0;
      idx[this.indexCount++] = i0 + 1;
      idx[this.indexCount++] = i0 + 3;
      idx[this.indexCount++] = i0;
      idx[this.indexCount++] = i0 + 3;
      idx[this.indexCount++] = i0 + 2;
    }
  }

  // ---------------------------------------------------------------------
  // Isometric primitives
  // ---------------------------------------------------------------------

  /** The flat diamond top of a tile. */
  isoTile(
    p: GridPos, rgb: number, alpha = 1, emissive = 0,
    cfg: IsoConfig = DEFAULT_ISO, inset = 0,
  ): void {
    const c = gridToScreen(p, cfg);
    const hw = cfg.tileW * 0.5 - inset;
    const hh = cfg.tileH * 0.5 - inset * 0.5;
    this.quad(
      c.x, c.y - hh,
      c.x + hw, c.y,
      c.x, c.y + hh,
      c.x - hw, c.y,
      rgb, alpha, emissive,
    );
  }

  /** Outline of a tile diamond, for hover and placement cursors. */
  isoTileOutline(
    p: GridPos, width: number, rgb: number, alpha = 1, emissive = 0,
    cfg: IsoConfig = DEFAULT_ISO,
  ): void {
    const c = gridToScreen(p, cfg);
    const hw = cfg.tileW * 0.5;
    const hh = cfg.tileH * 0.5;
    this.polyline(
      [c.x, c.y - hh, c.x + hw, c.y, c.x, c.y + hh, c.x - hw, c.y, c.x, c.y - hh],
      width, rgb, alpha, emissive,
    );
  }

  /**
   * A solid block occupying one tile, `height` units tall.
   *
   * Three faces are drawn - top, left, right - each shaded from the same base
   * colour. Fixed face shading is what sells the volume; without it an iso
   * block reads as a flat hexagon.
   */
  isoBlock(
    p: GridPos, height: number, rgb: number, alpha = 1, emissive = 0,
    cfg: IsoConfig = DEFAULT_ISO, inset = 0,
  ): void {
    const base = gridToScreen({ gx: p.gx, gy: p.gy, h: p.h }, cfg);
    const hw = cfg.tileW * 0.5 - inset;
    const hh = cfg.tileH * 0.5 - inset * 0.5;
    const lift = height * cfg.elevation;

    const topRgb = shadeRgb(rgb, 1.18);
    const leftRgb = shadeRgb(rgb, 0.62);
    const rightRgb = shadeRgb(rgb, 0.86);

    // left face: from west corner down, across to south corner
    this.quad(
      base.x - hw, base.y - lift,
      base.x, base.y + hh - lift,
      base.x, base.y + hh,
      base.x - hw, base.y,
      leftRgb, alpha, emissive * 0.5,
    );
    // right face: south corner across to east corner
    this.quad(
      base.x, base.y + hh - lift,
      base.x + hw, base.y - lift,
      base.x + hw, base.y,
      base.x, base.y + hh,
      rightRgb, alpha, emissive * 0.7,
    );
    // top face last, so it covers the seams where the side faces meet
    this.quad(
      base.x, base.y - hh - lift,
      base.x + hw, base.y - lift,
      base.x, base.y + hh - lift,
      base.x - hw, base.y - lift,
      topRgb, alpha, emissive,
    );
  }

  /** Glowing trim along the top edges of a block. Pure decoration, pure neon. */
  isoBlockTrim(
    p: GridPos, height: number, width: number, rgb: number,
    alpha = 1, emissive = 1.6, cfg: IsoConfig = DEFAULT_ISO,
  ): void {
    const base = gridToScreen(p, cfg);
    const hw = cfg.tileW * 0.5;
    const hh = cfg.tileH * 0.5;
    const y = base.y - height * cfg.elevation;
    this.polyline(
      [
        base.x, y - hh,
        base.x + hw, y,
        base.x, y + hh,
        base.x - hw, y,
        base.x, y - hh,
      ],
      width, rgb, alpha, emissive,
    );
  }

  flush(): void {
    if (this.indexCount === 0) return;
    const gl = this.gl;

    this.shader.use();
    this.shader.setMat3('uProjection', this.projection);

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(
      gl.ARRAY_BUFFER,
      0,
      this.f32.subarray(0, this.vertexCount * FLOATS_PER_VERTEX),
    );
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, this.indices.subarray(0, this.indexCount));

    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);

    this.drawCalls++;
    this.trianglesDrawn += this.indexCount / 3;
    this.vertexCount = 0;
    this.indexCount = 0;
  }

  dispose(): void {
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteBuffer(this.vbo);
    this.gl.deleteBuffer(this.ibo);
    this.shader.dispose();
  }
}
