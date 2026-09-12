import { Texture } from '../render/texture.js';
import type { QuadBatch } from '../render/quad-batch.js';

/**
 * Runtime glyph atlas.
 *
 * Text is rasterised into a canvas at load time and uploaded as one texture,
 * so all the text in a frame is a single draw call. Generating the atlas at
 * runtime rather than shipping a pre-baked font file means no asset pipeline,
 * no font binary in the repo, and the ability to change size or weight by
 * changing one number.
 *
 * The cost is that glyphs are bitmaps, so they blur if scaled up much past
 * their rasterised size. The renderer handles that by rasterising at device
 * resolution and drawing text in screen space at 1:1 - in-world labels are
 * drawn at a fixed screen size rather than scaling with camera zoom, which
 * is what you want for readability anyway.
 */

const ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');

// Vietnamese needs its precomposed forms in the atlas, otherwise every
// accented character falls back to the tofu box.
const VIETNAMESE =
  'ÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĐĨŨƠàáâãèéêìíòóôõùúăđĩũơ' +
  'ƯĂẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼỀỀỂưăạảấầẩẫậắằẳẵặẹẻẽềềể' +
  'ỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪễệỉịọỏốồổỗộớờởỡợụủứừ' +
  'ỬỮỰỲỴÝỶỸửữựỳỵýỷỹ';

const SYMBOLS = '←→↑↓✓✗●○■□▲▼◆◇★☆·•⚡⏱⚙⌁∞±×÷≈≤≥⟶⟵';

export interface Glyph {
  /** Atlas rect in pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Offset from the pen position to the top-left of the rect. */
  offsetX: number;
  offsetY: number;
  advance: number;
}

export interface FontOptions {
  family?: string;
  /** Rasterisation size in CSS pixels, before DPR scaling. */
  size?: number;
  weight?: number | string;
  /** Extra characters to include beyond ASCII, Vietnamese, and symbols. */
  extraChars?: string;
  /** Device pixel ratio to rasterise at. Text is crisp only if this matches. */
  dpr?: number;
  /** Padding around each glyph, so bilinear filtering cannot bleed neighbours. */
  padding?: number;
}

export class Font {
  readonly texture: Texture;
  readonly lineHeight: number;
  readonly ascent: number;
  readonly size: number;
  private readonly glyphs = new Map<string, Glyph>();
  private readonly scale: number;

  constructor(gl: WebGL2RenderingContext, opts: FontOptions = {}) {
    const family = opts.family ?? 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    const size = opts.size ?? 16;
    const weight = opts.weight ?? 500;
    const dpr = opts.dpr ?? Math.min(window.devicePixelRatio || 1, 2);
    const padding = opts.padding ?? 2;

    this.size = size;
    this.scale = 1 / dpr;

    const chars = dedupe(ASCII + VIETNAMESE + SYMBOLS + (opts.extraChars ?? ''));
    const pxSize = size * dpr;

    const measureCanvas = document.createElement('canvas');
    const mctx = measureCanvas.getContext('2d');
    if (!mctx) throw new Error('Font: 2D canvas context unavailable');
    mctx.font = `${weight} ${pxSize}px ${family}`;
    mctx.textBaseline = 'alphabetic';

    const metrics = mctx.measureText('Mg');
    const ascent = Math.ceil(metrics.actualBoundingBoxAscent || pxSize * 0.8);
    const descent = Math.ceil(metrics.actualBoundingBoxDescent || pxSize * 0.25);
    const rowHeight = ascent + descent + padding * 2;

    // Shelf packing. Glyphs are all roughly one line tall, so shelves waste
    // almost nothing here and the packer stays about ten lines long.
    const atlasWidth = 1024;
    let penX = padding;
    let penY = padding;
    const placements: Array<{ ch: string; g: Glyph }> = [];

    for (const ch of chars) {
      const m = mctx.measureText(ch);
      const advance = m.width;
      const left = Math.ceil(m.actualBoundingBoxLeft || 0);
      const right = Math.ceil(m.actualBoundingBoxRight || advance);
      const up = Math.ceil(m.actualBoundingBoxAscent || ascent);
      const downMetric = Math.ceil(m.actualBoundingBoxDescent || 0);
      const w = Math.max(1, left + right) + padding * 2;
      const h = Math.max(1, up + downMetric) + padding * 2;

      if (penX + w > atlasWidth) {
        penX = padding;
        penY += rowHeight;
      }

      placements.push({
        ch,
        g: {
          x: penX,
          y: penY,
          w,
          h,
          offsetX: -left - padding,
          offsetY: -up - padding,
          advance,
        },
      });
      penX += w + padding;
    }

    const atlasHeight = nextPowerOfTwo(penY + rowHeight + padding);

    const canvas = document.createElement('canvas');
    canvas.width = atlasWidth;
    canvas.height = atlasHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Font: 2D canvas context unavailable');

    ctx.font = `${weight} ${pxSize}px ${family}`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#ffffff';

    for (const { ch, g } of placements) {
      // The offsets are defined as "rect top-left minus pen position", so the
      // pen position that lands this glyph in its rect is just the inverse.
      ctx.fillText(ch, g.x - g.offsetX, g.y - g.offsetY);
      this.glyphs.set(ch, g);
    }

    this.texture = Texture.fromSource(gl, canvas, { filter: 'linear' });
    this.lineHeight = (ascent + descent) * this.scale * 1.35;
    this.ascent = ascent * this.scale;
  }

  glyph(ch: string): Glyph | undefined {
    return this.glyphs.get(ch);
  }

  /** Width of `text` in CSS pixels at scale 1. */
  measure(text: string): number {
    let w = 0;
    for (const ch of text) {
      const g = this.glyphs.get(ch);
      if (g) w += g.advance * this.scale;
    }
    return w;
  }

  /**
   * Break `text` into lines no wider than `maxWidth`, breaking on spaces
   * where possible and mid-word only when a single word does not fit.
   */
  wrap(text: string, maxWidth: number, scale = 1): string[] {
    const lines: string[] = [];
    for (const paragraph of text.split('\n')) {
      const words = paragraph.split(' ');
      let line = '';
      for (const word of words) {
        const candidate = line === '' ? word : `${line} ${word}`;
        if (this.measure(candidate) * scale <= maxWidth) {
          line = candidate;
          continue;
        }
        if (line !== '') lines.push(line);
        if (this.measure(word) * scale <= maxWidth) {
          line = word;
        } else {
          // Hard-break a word longer than the whole box.
          let chunk = '';
          for (const ch of word) {
            if (this.measure(chunk + ch) * scale > maxWidth && chunk !== '') {
              lines.push(chunk);
              chunk = ch;
            } else {
              chunk += ch;
            }
          }
          line = chunk;
        }
      }
      lines.push(line);
    }
    return lines;
  }

  dispose(): void {
    this.texture.dispose();
  }

  /** @internal */
  get pixelScale(): number {
    return this.scale;
  }
}

export type TextAlign = 'left' | 'center' | 'right';

export interface TextStyle {
  scale?: number;
  color?: number;
  alpha?: number;
  emissive?: number;
  align?: TextAlign;
  /** Extra pixels between characters. Negative tightens. */
  letterSpacing?: number;
}

/**
 * Draw a single line of text with its baseline-left at (x, y + ascent).
 * Returns the advance width actually drawn.
 */
export function drawText(
  quads: QuadBatch,
  font: Font,
  text: string,
  x: number,
  y: number,
  style: TextStyle = {},
): number {
  const scale = style.scale ?? 1;
  const color = style.color ?? 0xffffff;
  const alpha = style.alpha ?? 1;
  const emissive = style.emissive ?? 0;
  const spacing = style.letterSpacing ?? 0;
  const pixelScale = font.pixelScale;

  const width = font.measure(text) * scale + spacing * Math.max(0, text.length - 1);
  let penX = x;
  if (style.align === 'center') penX -= width / 2;
  else if (style.align === 'right') penX -= width;

  const baseline = y + font.ascent * scale;
  const tex = font.texture;
  const invW = 1 / tex.width;
  const invH = 1 / tex.height;

  for (const ch of text) {
    const g = font.glyph(ch);
    if (!g) continue;
    if (g.w > 1 && g.h > 1 && ch !== ' ') {
      quads.draw(
        tex,
        penX + g.offsetX * pixelScale * scale,
        baseline + g.offsetY * pixelScale * scale,
        g.w * pixelScale * scale,
        g.h * pixelScale * scale,
        g.x * invW,
        g.y * invH,
        (g.x + g.w) * invW,
        (g.y + g.h) * invH,
        color,
        alpha,
        emissive,
      );
    }
    penX += g.advance * pixelScale * scale + spacing;
  }
  return width;
}

function dedupe(s: string): string {
  return [...new Set(Array.from(s))].join('');
}

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}
