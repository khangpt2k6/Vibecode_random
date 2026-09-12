/**
 * @stackmon/engine
 *
 * A small 2D isometric engine built for this game and nothing else, but kept
 * free of any knowledge of it: nothing in here knows what a creature, a tech
 * stack, or a battle is. The game layer supplies all of that.
 */

export * from './math/index.js';
export { ValueNoise2D } from './math/noise.js';

export { World, defineComponent, entityIndex, entityGeneration, Query } from './core/ecs.js';
export type { Entity, ComponentType } from './core/ecs.js';
export { GameLoop, runHeadless } from './core/loop.js';
export type { LoopCallbacks, LoopOptions, LoopStats } from './core/loop.js';
export { EventBus } from './core/events.js';
export type { EventMap } from './core/events.js';

export { Renderer } from './render/renderer.js';
export type { RenderLayer, RendererStats } from './render/renderer.js';
export { Camera2D } from './render/camera.js';
export type { CameraBounds } from './render/camera.js';
export { ShapeBatch } from './render/shape-batch.js';
export { QuadBatch } from './render/quad-batch.js';
export { Shader, ShaderError } from './render/shader.js';
export { Texture, RenderTarget, bindScreen } from './render/texture.js';
export type { TextureOptions } from './render/texture.js';
export {
  createGLContext,
  resize,
  clear,
  setBlendNormal,
  setBlendAdditive,
  packColor,
  rgba,
  mixRgb,
  shadeRgb,
  WebGLUnavailableError,
} from './render/gl.js';
export type { GLContext } from './render/gl.js';

export { BackgroundPass, DEFAULT_BACKGROUND } from './render/background.js';
export type { BackgroundColors } from './render/background.js';
export { BloomPass } from './render/post/bloom.js';
export type { BloomOptions } from './render/post/bloom.js';
export { CompositePass, DEFAULT_COMPOSITE } from './render/post/composite.js';
export type { CompositeSettings } from './render/post/composite.js';
export { FullscreenPass, FULLSCREEN_VERT } from './render/post/fullscreen.js';

export { Input } from './input/input.js';
export type { PointerState, InputPhase } from './input/input.js';

export { SceneManager } from './scene/scene.js';
export type { Scene, SceneContext } from './scene/scene.js';
export { Transition } from './scene/transition.js';
export type { TransitionOptions, TransitionStyle } from './scene/transition.js';

export { Font, drawText } from './assets/font.js';
export type { Glyph, FontOptions, TextStyle, TextAlign } from './assets/font.js';

export { ParticleSystem } from './render/particles.js';
export type { ParticleEmitConfig } from './render/particles.js';

export { App } from './app.js';
export type { AppOptions } from './app.js';
