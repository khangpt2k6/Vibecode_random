import { clamp, damp } from '../math/scalar.js';
import type { Vec2 } from '../math/vec2.js';

/**
 * 2D orthographic camera for the isometric world.
 *
 * Holds a world-space centre and a zoom. Produces the projection uniforms the
 * batches need, plus world <-> screen conversion for picking.
 *
 * Movement is smoothed rather than snapped: `target` is where the camera
 * wants to be, `position` is where it is, and `update` eases one toward the
 * other with a frame-rate independent damp. Everything that moves the camera
 * - following the player, focusing a battle, a screen shake - writes to
 * `target` and lets the smoothing do the work.
 */
export interface CameraBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export class Camera2D {
  /** Where the camera actually is, in world pixels. */
  readonly position: Vec2 = { x: 0, y: 0 };
  /** Where the camera is heading. */
  readonly target: Vec2 = { x: 0, y: 0 };

  zoom = 1;
  targetZoom = 1;

  minZoom = 0.25;
  maxZoom = 4;

  /** Seconds for half the remaining distance to be covered. Lower is snappier. */
  followHalfLife = 0.08;
  zoomHalfLife = 0.06;

  /** Optional world-space clamp, so the player cannot pan off the map. */
  bounds: CameraBounds | null = null;

  private shakeAmount = 0;
  private shakeDecay = 1;
  private shakeTime = 0;
  private readonly shakeOffset: Vec2 = { x: 0, y: 0 };

  private viewportW = 1;
  private viewportH = 1;

  setViewport(width: number, height: number): void {
    this.viewportW = Math.max(1, width);
    this.viewportH = Math.max(1, height);
  }

  get viewportWidth(): number {
    return this.viewportW;
  }

  get viewportHeight(): number {
    return this.viewportH;
  }

  /** Jump instantly, skipping the smoothing. Use on scene entry, not in-game. */
  snapTo(x: number, y: number): void {
    this.target.x = x;
    this.target.y = y;
    this.position.x = x;
    this.position.y = y;
    this.applyBounds();
  }

  moveTo(x: number, y: number): void {
    this.target.x = x;
    this.target.y = y;
  }

  panBy(dx: number, dy: number): void {
    this.target.x += dx;
    this.target.y += dy;
  }

  setZoom(z: number, immediate = false): void {
    this.targetZoom = clamp(z, this.minZoom, this.maxZoom);
    if (immediate) this.zoom = this.targetZoom;
  }

  /**
   * Zoom keeping the given screen point anchored - the standard
   * scroll-wheel-under-cursor behaviour. Without this, zooming drifts the
   * thing you were looking at off screen and feels broken.
   */
  zoomAt(screenPoint: Vec2, factor: number): void {
    const before = this.screenToWorld(screenPoint);
    this.targetZoom = clamp(this.targetZoom * factor, this.minZoom, this.maxZoom);
    this.zoom = this.targetZoom; // anchor math needs the final zoom applied now
    const after = this.screenToWorld(screenPoint);
    this.target.x += before.x - after.x;
    this.position.x += before.x - after.x;
    this.target.y += before.y - after.y;
    this.position.y += before.y - after.y;
    this.applyBounds();
  }

  /** `trauma` in [0, 1]. Stacks, so repeated hits feel heavier. */
  shake(trauma: number, decayPerSecond = 2.5): void {
    this.shakeAmount = Math.min(1, this.shakeAmount + trauma);
    this.shakeDecay = decayPerSecond;
  }

  update(dt: number): void {
    this.position.x = damp(this.position.x, this.target.x, this.followHalfLife, dt);
    this.position.y = damp(this.position.y, this.target.y, this.followHalfLife, dt);
    this.zoom = damp(this.zoom, this.targetZoom, this.zoomHalfLife, dt);
    this.applyBounds();

    if (this.shakeAmount > 0) {
      this.shakeTime += dt;
      // Squaring trauma makes small hits subtle and big hits violent, which
      // reads far better than a linear response.
      const mag = this.shakeAmount * this.shakeAmount * 18;
      this.shakeOffset.x = Math.sin(this.shakeTime * 47.3) * mag;
      this.shakeOffset.y = Math.cos(this.shakeTime * 39.7) * mag;
      this.shakeAmount = Math.max(0, this.shakeAmount - this.shakeDecay * dt);
      if (this.shakeAmount === 0) {
        this.shakeOffset.x = 0;
        this.shakeOffset.y = 0;
      }
    }
  }

  private applyBounds(): void {
    const b = this.bounds;
    if (!b) return;
    const halfW = this.viewportW / (2 * this.zoom);
    const halfH = this.viewportH / (2 * this.zoom);

    // When the map is narrower than the view, centre it rather than clamping
    // to an edge, which would otherwise wedge the map against one side.
    if (b.maxX - b.minX < halfW * 2) {
      this.target.x = this.position.x = (b.minX + b.maxX) / 2;
    } else {
      this.target.x = clamp(this.target.x, b.minX + halfW, b.maxX - halfW);
      this.position.x = clamp(this.position.x, b.minX + halfW, b.maxX - halfW);
    }
    if (b.maxY - b.minY < halfH * 2) {
      this.target.y = this.position.y = (b.minY + b.maxY) / 2;
    } else {
      this.target.y = clamp(this.target.y, b.minY + halfH, b.maxY - halfH);
      this.position.y = clamp(this.position.y, b.minY + halfH, b.maxY - halfH);
    }
  }

  /** Effective camera centre including shake. */
  get renderX(): number {
    return this.position.x + this.shakeOffset.x;
  }

  get renderY(): number {
    return this.position.y + this.shakeOffset.y;
  }

  worldToScreen(w: Vec2): Vec2 {
    return {
      x: (w.x - this.renderX) * this.zoom + this.viewportW / 2,
      y: (w.y - this.renderY) * this.zoom + this.viewportH / 2,
    };
  }

  screenToWorld(s: Vec2): Vec2 {
    return {
      x: (s.x - this.viewportW / 2) / this.zoom + this.renderX,
      y: (s.y - this.viewportH / 2) / this.zoom + this.renderY,
    };
  }

  /**
   * World-space rectangle currently visible, grown by `pad` pixels.
   *
   * Everything that culls - tiles, entities, particles - asks this first. The
   * padding covers sprites whose origin is off screen but whose body is not.
   */
  visibleBounds(pad = 0): CameraBounds {
    const halfW = this.viewportW / (2 * this.zoom) + pad;
    const halfH = this.viewportH / (2 * this.zoom) + pad;
    return {
      minX: this.renderX - halfW,
      minY: this.renderY - halfH,
      maxX: this.renderX + halfW,
      maxY: this.renderY + halfH,
    };
  }

  /**
   * Projection matrix mapping world pixels to clip space, column-major mat3.
   *
   * The y axis is flipped so +y is down, matching screen and isometric
   * conventions and keeping the depth sort readable.
   */
  projection(out = new Float32Array(9)): Float32Array {
    const sx = (2 * this.zoom) / this.viewportW;
    const sy = (-2 * this.zoom) / this.viewportH;
    out[0] = sx;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = sy;
    out[5] = 0;
    out[6] = -this.renderX * sx;
    out[7] = -this.renderY * sy;
    out[8] = 1;
    return out;
  }
}
