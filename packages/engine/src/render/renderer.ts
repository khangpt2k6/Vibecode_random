import type { GLContext } from './gl.js';
import { createGLContext, resize, setBlendNormal, setBlendAdditive } from './gl.js';
import { Camera2D } from './camera.js';
import { ShapeBatch } from './shape-batch.js';
import { QuadBatch } from './quad-batch.js';
import { RenderTarget, bindScreen } from './texture.js';
import { FullscreenPass } from './post/fullscreen.js';
import { BloomPass } from './post/bloom.js';
import { CompositePass } from './post/composite.js';
import { BackgroundPass } from './background.js';

/**
 * The renderer.
 *
 * Owns the GL context and the whole frame graph, and hands out the two
 * batches that everything else draws through. A frame looks like this:
 *
 *   1. Bind the HDR scene target (2 attachments: colour, emissive)
 *   2. Background pass fills it
 *   3. World layer   - shapes and quads, camera projection, painter order
 *   4. Effects layer - additive blending for sparks and energy
 *   5. Bloom over the emissive attachment
 *   6. Composite scene + bloom to the canvas, with the grade
 *   7. UI layer      - drawn straight to the canvas, after the grade
 *
 * Step 7 is deliberate. Running the UI through the same chromatic aberration
 * and bloom as the world turns every label into a smeared, fringed mess: the
 * grade is meant to make you feel the world is on a screen, not to make the
 * screen unreadable. So the world gets the full treatment and the interface
 * stays pixel-crisp on top of it.
 *
 * The layer split is also what makes the isometric painter sort tractable -
 * each layer sorts independently, and UI never participates in world depth.
 */

export type RenderLayer = 'world' | 'effects' | 'ui';

export interface RendererStats {
  drawCalls: number;
  triangles: number;
  quads: number;
}

export class Renderer {
  readonly ctx: GLContext;
  readonly gl: WebGL2RenderingContext;
  readonly camera = new Camera2D();
  readonly shapes: ShapeBatch;
  readonly quads: QuadBatch;
  readonly composite: CompositePass;
  readonly background: BackgroundPass;
  readonly bloom: BloomPass;

  /** Set false to skip post-processing entirely, e.g. on a weak GPU. */
  postProcessing = true;

  private readonly sceneTarget: RenderTarget;
  private readonly fullscreen: FullscreenPass;
  private readonly worldProjection = new Float32Array(9);
  private readonly uiProjection = new Float32Array(9);
  private time = 0;
  private currentLayer: RenderLayer | null = null;
  private presented = false;

  constructor(canvas: HTMLCanvasElement) {
    this.ctx = createGLContext(canvas);
    this.gl = this.ctx.gl;

    this.camera.setViewport(this.ctx.width, this.ctx.height);

    this.fullscreen = new FullscreenPass(this.gl);
    this.sceneTarget = new RenderTarget(
      this.gl,
      this.ctx.drawWidth,
      this.ctx.drawHeight,
      2,
      { filter: 'linear', format: 'rgba16f' },
    );
    this.bloom = new BloomPass(this.gl, this.fullscreen, this.ctx.drawWidth, this.ctx.drawHeight);
    this.composite = new CompositePass(this.gl, this.fullscreen);
    this.background = new BackgroundPass(this.gl, this.fullscreen);

    this.shapes = new ShapeBatch(this.gl);
    this.quads = new QuadBatch(this.gl);

    // Keep draw order equal to submission order across both batches. Either
    // one can flush mid-layer - the shape batch when it fills, the quad batch
    // on every texture change - and whichever does must let anything older
    // out first, or work submitted earlier ends up painted on top.
    this.shapes.flushSiblings = () => this.quads.flush();
    this.quads.flushSiblings = () => this.shapes.flush();
  }

  /** Call each frame before drawing. Returns true if the size changed. */
  handleResize(): boolean {
    const changed = resize(this.ctx);
    if (changed) {
      this.camera.setViewport(this.ctx.width, this.ctx.height);
      this.sceneTarget.resize(this.ctx.drawWidth, this.ctx.drawHeight);
      this.bloom.resize(this.ctx.drawWidth, this.ctx.drawHeight);
    }
    return changed;
  }

  update(dt: number): void {
    this.time += dt;
    this.camera.update(dt);
    this.composite.update(dt);
  }

  get elapsed(): number {
    return this.time;
  }

  /**
   * Start a frame. Binds the scene target and draws the backdrop.
   * Everything up to the first UI layer renders offscreen in HDR.
   */
  beginFrame(): void {
    const gl = this.gl;
    this.shapes.resetStats();
    this.quads.resetStats();
    this.presented = false;

    if (this.postProcessing) {
      this.sceneTarget.bind();
    } else {
      bindScreen(gl, this.ctx.drawWidth, this.ctx.drawHeight);
    }

    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    this.background.render(
      this.ctx.drawWidth,
      this.ctx.drawHeight,
      this.camera.renderX,
      this.camera.renderY,
      this.camera.zoom * this.ctx.dpr,
      this.time,
    );

    this.camera.projection(this.worldProjection);
    this.buildUIProjection();
  }

  /**
   * Switch drawing layer. Flushes the previous layer first, so draw order
   * between layers is always respected regardless of call order.
   *
   * The first switch to `ui` presents the world, so UI draws over the graded
   * image rather than through it.
   */
  beginLayer(layer: RenderLayer): void {
    if (this.currentLayer === layer) return;
    this.endLayer();

    if (layer === 'ui' && !this.presented) this.present();

    const gl = this.gl;
    const projection = layer === 'ui' ? this.uiProjection : this.worldProjection;

    if (layer === 'effects') {
      setBlendAdditive(gl);
    } else {
      setBlendNormal(gl);
    }

    this.shapes.begin(projection);
    this.quads.begin(projection);
    this.currentLayer = layer;
  }

  endLayer(): void {
    if (this.currentLayer === null) return;
    // Order within a layer is submission order, maintained by the mutual
    // beforeFlush hooks, so these two calls just drain whatever is left.
    this.shapes.end();
    this.quads.end();
    this.currentLayer = null;
  }

  /** Finish the frame. Presents the world if no UI layer already did. */
  endFrame(): void {
    this.endLayer();
    if (!this.presented) this.present();
  }

  /** Bloom the emissive buffer and composite the world onto the canvas. */
  private present(): void {
    this.presented = true;
    if (!this.postProcessing) return;

    const gl = this.gl;
    const bloomTexture = this.bloom.render(this.sceneTarget.textures[1]!.handle);

    bindScreen(gl, this.ctx.drawWidth, this.ctx.drawHeight);
    gl.disable(gl.BLEND);
    this.composite.render(
      this.sceneTarget.textures[0]!.handle,
      bloomTexture,
      this.ctx.drawWidth,
      this.ctx.drawHeight,
      this.time,
    );
  }

  /**
   * Screen-space projection in CSS pixels, origin top-left.
   *
   * UI is authored in CSS pixels rather than device pixels so a panel is the
   * same physical size on every display; the DPR scaling happens here, once.
   */
  private buildUIProjection(): void {
    const w = this.ctx.width;
    const h = this.ctx.height;
    const m = this.uiProjection;
    m[0] = 2 / w;
    m[1] = 0;
    m[2] = 0;
    m[3] = 0;
    m[4] = -2 / h;
    m[5] = 0;
    m[6] = -1;
    m[7] = 1;
    m[8] = 1;
  }

  stats(): RendererStats {
    return {
      drawCalls: this.shapes.drawCalls + this.quads.drawCalls,
      triangles: this.shapes.trianglesDrawn,
      quads: this.quads.quadsDrawn,
    };
  }

  dispose(): void {
    this.shapes.dispose();
    this.quads.dispose();
    this.sceneTarget.dispose();
    this.bloom.dispose();
    this.composite.dispose();
    this.background.dispose();
    this.fullscreen.dispose();
  }
}
