/**
 * Typed event bus.
 *
 * The engine and the game talk through this instead of holding references to
 * each other. A battle in @stackmon/core emits "damage dealt"; the renderer
 * listens and spawns a number popup. Neither package imports the other.
 *
 * Events are delivered synchronously. Handlers that need to defer work should
 * queue it themselves rather than relying on the bus to be async.
 */

export type EventMap = Record<string, unknown>;

type Handler<T> = (payload: T) => void;

export class EventBus<M extends EventMap> {
  private readonly handlers = new Map<keyof M, Set<Handler<never>>>();
  /** Handlers added during a dispatch, held back until that dispatch ends. */
  private readonly pendingAdds: Array<[keyof M, Handler<never>]> = [];
  private dispatchDepth = 0;

  on<K extends keyof M>(type: K, handler: Handler<M[K]>): () => void {
    if (this.dispatchDepth > 0) {
      this.pendingAdds.push([type, handler as Handler<never>]);
    } else {
      this.bucket(type).add(handler as Handler<never>);
    }
    return () => this.off(type, handler);
  }

  /** Subscribe for exactly one delivery. */
  once<K extends keyof M>(type: K, handler: Handler<M[K]>): () => void {
    const wrapped: Handler<M[K]> = (payload) => {
      this.off(type, wrapped);
      handler(payload);
    };
    return this.on(type, wrapped);
  }

  off<K extends keyof M>(type: K, handler: Handler<M[K]>): void {
    this.handlers.get(type)?.delete(handler as Handler<never>);
    const i = this.pendingAdds.findIndex(
      ([t, h]) => t === type && h === (handler as Handler<never>),
    );
    if (i >= 0) this.pendingAdds.splice(i, 1);
  }

  emit<K extends keyof M>(type: K, payload: M[K]): void {
    const bucket = this.handlers.get(type);
    if (!bucket || bucket.size === 0) return;

    this.dispatchDepth++;
    try {
      // Snapshot: a handler may unsubscribe itself or a sibling mid-dispatch.
      for (const h of [...bucket]) {
        (h as Handler<M[K]>)(payload);
      }
    } finally {
      this.dispatchDepth--;
      if (this.dispatchDepth === 0 && this.pendingAdds.length > 0) {
        for (const [t, h] of this.pendingAdds) this.bucket(t).add(h);
        this.pendingAdds.length = 0;
      }
    }
  }

  clear(type?: keyof M): void {
    if (type === undefined) {
      this.handlers.clear();
      this.pendingAdds.length = 0;
    } else {
      this.handlers.delete(type);
    }
  }

  listenerCount(type: keyof M): number {
    return this.handlers.get(type)?.size ?? 0;
  }

  private bucket(type: keyof M): Set<Handler<never>> {
    let b = this.handlers.get(type);
    if (!b) {
      b = new Set();
      this.handlers.set(type, b);
    }
    return b;
  }
}
