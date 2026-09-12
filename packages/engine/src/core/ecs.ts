/**
 * Entity Component System.
 *
 * Entities are integers. Components are plain data held in per-type sparse
 * sets. Systems are functions that run over a query each tick.
 *
 * Why sparse sets and not archetypes: this game peaks in the low thousands of
 * entities, where archetype bookkeeping costs more than it saves. A sparse
 * set gives O(1) add/remove/has and a dense array to iterate, which is the
 * part that actually matters for the render loop.
 *
 * Entity ids carry a generation counter in the high bits so a stale handle to
 * a despawned entity fails loudly instead of silently addressing whatever
 * reused its slot.
 */

export type Entity = number & { readonly __entity: unique symbol };

const INDEX_BITS = 20;
const INDEX_MASK = (1 << INDEX_BITS) - 1;
const MAX_ENTITIES = INDEX_MASK;

export const entityIndex = (e: Entity): number => e & INDEX_MASK;
export const entityGeneration = (e: Entity): number => e >>> INDEX_BITS;

const makeEntity = (index: number, generation: number): Entity =>
  (((generation << INDEX_BITS) >>> 0) | index) as Entity;

/**
 * A component type. Create one per data shape with `defineComponent`.
 * The `name` is only for debugging and save-file keys.
 */
export interface ComponentType<T> {
  readonly id: number;
  readonly name: string;
  /** Produces the default value for a freshly added component. */
  readonly make: () => T;
}

let nextComponentId = 0;

export function defineComponent<T>(name: string, make: () => T): ComponentType<T> {
  return { id: nextComponentId++, name, make };
}

/**
 * Sparse set store for one component type.
 *
 * `dense` holds the values packed with no holes, `entities` holds the entity
 * that owns each dense slot, and `sparse` maps entity index -> dense slot.
 */
class Store<T> {
  readonly dense: T[] = [];
  readonly entities: Entity[] = [];
  private readonly sparse: Int32Array;

  constructor(capacity: number) {
    this.sparse = new Int32Array(capacity).fill(-1);
  }

  has(e: Entity): boolean {
    const slot = this.sparse[entityIndex(e)]!;
    return slot >= 0 && this.entities[slot] === e;
  }

  get(e: Entity): T | undefined {
    const slot = this.sparse[entityIndex(e)]!;
    if (slot < 0 || this.entities[slot] !== e) return undefined;
    return this.dense[slot];
  }

  set(e: Entity, value: T): T {
    const idx = entityIndex(e);
    const slot = this.sparse[idx]!;
    if (slot >= 0 && this.entities[slot] === e) {
      this.dense[slot] = value;
      return value;
    }
    this.sparse[idx] = this.dense.length;
    this.dense.push(value);
    this.entities.push(e);
    return value;
  }

  /** Swap-remove keeps `dense` packed, so iteration stays branch-free. */
  remove(e: Entity): boolean {
    const idx = entityIndex(e);
    const slot = this.sparse[idx]!;
    if (slot < 0 || this.entities[slot] !== e) return false;

    const last = this.dense.length - 1;
    if (slot !== last) {
      const movedEntity = this.entities[last]!;
      this.dense[slot] = this.dense[last]!;
      this.entities[slot] = movedEntity;
      this.sparse[entityIndex(movedEntity)] = slot;
    }
    this.dense.pop();
    this.entities.pop();
    this.sparse[idx] = -1;
    return true;
  }

  get size(): number {
    return this.dense.length;
  }

  clear(): void {
    this.dense.length = 0;
    this.entities.length = 0;
    this.sparse.fill(-1);
  }
}

/** A cached query over a set of required (and optionally excluded) components. */
export class Query {
  /** Entities matching the query. Rebuilt lazily when the world changes. */
  private cache: Entity[] = [];
  private dirtyAt = -1;

  constructor(
    private readonly world: World,
    readonly all: readonly ComponentType<unknown>[],
    readonly none: readonly ComponentType<unknown>[] = [],
  ) {}

  /**
   * Current matches.
   *
   * The returned array is owned by the query and reused between calls - do
   * not hold onto it across a structural change. Iterating it while spawning
   * or despawning is safe only because `each` snapshots; direct callers who
   * mutate structure should copy first.
   */
  entities(): readonly Entity[] {
    if (this.dirtyAt !== this.world.version) this.rebuild();
    return this.cache;
  }

  /** Iterate matches. Safe against spawn/despawn inside the callback. */
  each(fn: (e: Entity) => void): void {
    const list = this.entities();
    // Copy: the callback may despawn, which invalidates the cache mid-walk.
    const snapshot = list.slice();
    for (let i = 0; i < snapshot.length; i++) {
      const e = snapshot[i]!;
      if (this.world.isAlive(e)) fn(e);
    }
  }

  private rebuild(): void {
    this.cache.length = 0;
    if (this.all.length === 0) {
      this.dirtyAt = this.world.version;
      return;
    }
    // Drive the scan from the smallest store, so we test the fewest candidates.
    let smallest = this.world.storeOf(this.all[0]!);
    for (let i = 1; i < this.all.length; i++) {
      const s = this.world.storeOf(this.all[i]!);
      if (s.size < smallest.size) smallest = s;
    }

    outer: for (const e of smallest.entities) {
      for (const c of this.all) {
        if (!this.world.storeOf(c).has(e)) continue outer;
      }
      for (const c of this.none) {
        if (this.world.storeOf(c).has(e)) continue outer;
      }
      this.cache.push(e);
    }
    this.dirtyAt = this.world.version;
  }
}

export class World {
  /** Bumped on every structural change, which invalidates query caches. */
  version = 0;

  private readonly stores = new Map<number, Store<unknown>>();
  private readonly generations: Uint16Array;
  private readonly alive: Uint8Array;
  private readonly freeList: number[] = [];
  private nextIndex = 0;
  private readonly capacity: number;
  private readonly queries: Query[] = [];

  constructor(capacity = 16384) {
    if (capacity > MAX_ENTITIES) {
      throw new Error(`World capacity ${capacity} exceeds max ${MAX_ENTITIES}`);
    }
    this.capacity = capacity;
    this.generations = new Uint16Array(capacity);
    this.alive = new Uint8Array(capacity);
  }

  spawn(): Entity {
    let index: number;
    if (this.freeList.length > 0) {
      index = this.freeList.pop()!;
    } else {
      if (this.nextIndex >= this.capacity) {
        throw new Error(`World is full (capacity ${this.capacity})`);
      }
      index = this.nextIndex++;
    }
    this.alive[index] = 1;
    this.version++;
    return makeEntity(index, this.generations[index]!);
  }

  despawn(e: Entity): void {
    if (!this.isAlive(e)) return;
    const index = entityIndex(e);
    for (const store of this.stores.values()) store.remove(e);
    this.alive[index] = 0;
    // Wrapping the generation is fine: a handle would have to survive 65536
    // reuses of the same slot to collide, which no game code does.
    this.generations[index] = (this.generations[index]! + 1) & 0xffff;
    this.freeList.push(index);
    this.version++;
  }

  isAlive(e: Entity): boolean {
    const index = entityIndex(e);
    if (index >= this.capacity) return false;
    return this.alive[index] === 1 && this.generations[index] === entityGeneration(e);
  }

  /** @internal - Query needs this; game code should not. */
  storeOf<T>(c: ComponentType<T>): Store<T> {
    let s = this.stores.get(c.id) as Store<T> | undefined;
    if (!s) {
      s = new Store<T>(this.capacity);
      this.stores.set(c.id, s as Store<unknown>);
    }
    return s;
  }

  /** Attach a component, filling from `c.make()` then applying `init`. */
  add<T>(e: Entity, c: ComponentType<T>, init?: Partial<T>): T {
    if (!this.isAlive(e)) throw new Error(`add: entity ${e} is not alive`);
    const value = c.make();
    if (init) Object.assign(value as object, init);
    this.storeOf(c).set(e, value);
    this.version++;
    return value;
  }

  /** Attach a component from a fully-built value, skipping `make()`. */
  set<T>(e: Entity, c: ComponentType<T>, value: T): T {
    if (!this.isAlive(e)) throw new Error(`set: entity ${e} is not alive`);
    this.storeOf(c).set(e, value);
    this.version++;
    return value;
  }

  get<T>(e: Entity, c: ComponentType<T>): T | undefined {
    return this.storeOf(c).get(e);
  }

  /** Like `get`, but throws rather than returning undefined. Use when the
   *  component is guaranteed by the query that produced the entity. */
  getOrThrow<T>(e: Entity, c: ComponentType<T>): T {
    const v = this.storeOf(c).get(e);
    if (v === undefined) {
      throw new Error(`Entity ${entityIndex(e)} is missing component ${c.name}`);
    }
    return v;
  }

  has<T>(e: Entity, c: ComponentType<T>): boolean {
    return this.storeOf(c).has(e);
  }

  remove<T>(e: Entity, c: ComponentType<T>): void {
    if (this.storeOf(c).remove(e)) this.version++;
  }

  /** All live values of one component type, packed. The fastest way to scan. */
  dense<T>(c: ComponentType<T>): readonly T[] {
    return this.storeOf(c).dense;
  }

  /** Entity owning each slot of `dense(c)`, index-aligned with it. */
  denseEntities<T>(c: ComponentType<T>): readonly Entity[] {
    return this.storeOf(c).entities;
  }

  count<T>(c: ComponentType<T>): number {
    return this.storeOf(c).size;
  }

  query(
    all: readonly ComponentType<any>[],
    none: readonly ComponentType<any>[] = [],
  ): Query {
    const q = new Query(this, all, none);
    this.queries.push(q);
    return q;
  }

  get entityCount(): number {
    let n = 0;
    for (let i = 0; i < this.nextIndex; i++) if (this.alive[i] === 1) n++;
    return n;
  }

  clear(): void {
    for (const store of this.stores.values()) store.clear();
    this.alive.fill(0);
    this.freeList.length = 0;
    this.nextIndex = 0;
    this.version++;
  }
}
