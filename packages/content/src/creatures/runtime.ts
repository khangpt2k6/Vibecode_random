import type { CreatureSpec } from '../schema.js';

/**
 * RUNTIME family.
 *
 * Where the application code actually executes. These are the generalists:
 * they can do anything, which is why they are optimal at nothing and why
 * they are usually the first thing in a pipeline to fall over.
 */
export const RUNTIME_CREATURES: CreatureSpec[] = [
  {
    id: 'jvm',
    name: 'JVM',
    realName: 'Java Virtual Machine',
    type: 'runtime',
    roles: ['process'],
    base: {
      throughput: 150,
      latency: 95,
      durability: 140,
      memory: 170,
      consistency: 120,
      scalability: 130,
    },
    growth: {
      throughput: 5.0,
      latency: 0.9,
      durability: 4.2,
      memory: 4.6,
      consistency: 1.8,
      scalability: 3.2,
    },
    skills: ['jit-warmup', 'garbage-collect', 'thread-pool', 'native-extension'],
    rarity: 38,
    habitats: ['runtime-foundry'],
    evolution: { into: 'graalvm', level: 30, condition: 'Use JIT Warmup 10 times' },
    codex:
      'Starts slow, profiles itself, and then compiles the hot paths to native ' +
      'code that a static compiler would struggle to match, because it knows ' +
      'which branch actually gets taken. Real threads, mature concurrency, and ' +
      'a garbage collector you can tune for hours. It wants a lot of memory and ' +
      'it is a poor fit for anything short-lived.',
    keyInsight:
      'Warmup is the whole personality. A long-running service gets very ' +
      'fast; a function that runs for 200ms never leaves the interpreter.',
  },
  {
    id: 'cpython',
    name: 'CPYTHON',
    realName: 'CPython',
    type: 'runtime',
    roles: ['process'],
    base: {
      throughput: 55,
      latency: 60,
      durability: 100,
      memory: 110,
      consistency: 115,
      scalability: 40,
    },
    growth: {
      throughput: 1.9,
      latency: 0.5,
      durability: 3.2,
      memory: 3.4,
      consistency: 1.7,
      scalability: 0.9,
    },
    skills: ['gil-contention', 'native-extension', 'hot-reload'],
    rarity: 50,
    habitats: ['runtime-foundry', 'index-spires'],
    codex:
      'The slowest interpreter in this family by a wide margin, and the one ' +
      'that wins anyway, because the hot loop is never actually running in it. ' +
      'NumPy, PyTorch, and every scientific library are thin bindings over C, ' +
      'C++, Fortran and CUDA. Python is the language you assemble them in.',
    keyInsight:
      'The GIL means threads do not give you CPU parallelism. Multiprocessing ' +
      'does, and so does dropping into C - adding threads does not.',
  },
  {
    id: 'node',
    name: 'NODE',
    realName: 'Node.js',
    type: 'runtime',
    roles: ['process', 'ingest'],
    base: {
      throughput: 105,
      latency: 25,
      durability: 95,
      memory: 90,
      consistency: 90,
      scalability: 70,
    },
    growth: {
      throughput: 3.4,
      latency: 0.22,
      durability: 3.0,
      memory: 2.8,
      consistency: 1.4,
      scalability: 1.8,
    },
    skills: ['async-io', 'hot-reload', 'thread-pool'],
    rarity: 48,
    habitats: ['runtime-foundry', 'container-yards'],
    codex:
      'One thread, an event loop, and non-blocking IO. It holds tens of ' +
      'thousands of open connections on a single core without breaking a ' +
      'sweat, because a socket that is waiting costs nothing. Put a CPU-bound ' +
      'loop on that same thread and every one of those connections stalls ' +
      'behind it.',
    keyInsight:
      'Concurrency is not parallelism. It is superb at waiting on many things ' +
      'at once and has no answer at all for computing one thing quickly.',
  },
  {
    id: 'golang',
    name: 'GO',
    realName: 'Go',
    type: 'runtime',
    roles: ['process', 'ingest'],
    base: {
      throughput: 160,
      latency: 18,
      durability: 130,
      memory: 70,
      consistency: 110,
      scalability: 170,
    },
    growth: {
      throughput: 5.2,
      latency: 0.16,
      durability: 4.0,
      memory: 2.0,
      consistency: 1.6,
      scalability: 4.4,
    },
    skills: ['thread-pool', 'async-io', 'native-extension'],
    rarity: 32,
    habitats: ['runtime-foundry', 'container-yards'],
    codex:
      'Compiles to a single static binary in seconds, starts instantly, and ' +
      'multiplexes hundreds of thousands of goroutines onto a handful of OS ' +
      'threads. The garbage collector is tuned for short pauses rather than ' +
      'peak throughput, which is the right trade for a network service. The ' +
      'language is deliberately small, and people argue about that forever.',
    keyInsight:
      'Goroutines give you cheap concurrency AND real parallelism, which is ' +
      'the thing neither CPython nor Node can offer.',
  },
];
