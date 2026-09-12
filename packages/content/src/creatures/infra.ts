import type { CreatureSpec } from '../schema.js';

/**
 * INFRA family.
 *
 * Everything between the request and the code: routing, packaging,
 * scheduling, failover. They make a system survivable and operable, and
 * every layer they add is another layer someone has to debug through at 3am.
 */
export const INFRA_CREATURES: CreatureSpec[] = [
  {
    id: 'docker',
    name: 'DOCKER',
    realName: 'Docker / OCI containers',
    type: 'infra',
    roles: ['process'],
    base: {
      throughput: 100,
      latency: 45,
      durability: 120,
      memory: 75,
      consistency: 130,
      scalability: 110,
    },
    growth: {
      throughput: 3.2,
      latency: 0.4,
      durability: 3.6,
      memory: 2.2,
      consistency: 2.0,
      scalability: 2.8,
    },
    skills: ['layer-cache', 'liveness-probe', 'rolling-update'],
    rarity: 46,
    habitats: ['container-yards'],
    codex:
      'Namespaces and cgroups, wrapped in an image format that is a stack of ' +
      'content-addressed layers. It is not a virtual machine - there is one ' +
      'kernel, shared - which is why a container starts in milliseconds and a ' +
      'VM does not. What it really solved was not isolation but the fact that ' +
      'the same artefact now runs on the laptop and in production.',
    keyInsight:
      'Layers are content-addressed, so an unchanged layer is never rebuilt. ' +
      'Order a Dockerfile stable-to-volatile and builds get dramatically faster.',
  },
  {
    id: 'kubernetes',
    name: 'K8S',
    realName: 'Kubernetes',
    type: 'infra',
    roles: ['ingest', 'process'],
    base: {
      throughput: 140,
      latency: 110,
      durability: 180,
      memory: 140,
      consistency: 125,
      scalability: 196,
    },
    growth: {
      throughput: 4.4,
      latency: 1.0,
      durability: 5.6,
      memory: 4.2,
      consistency: 2.0,
      scalability: 5.2,
    },
    skills: ['autoscale', 'liveness-probe', 'rolling-update', 'circuit-breaker'],
    rarity: 20,
    habitats: ['container-yards'],
    codex:
      'A control loop that continuously moves the cluster from what it is ' +
      'toward what you declared it should be. Nothing is imperative: you state ' +
      'the desired end state and the reconcilers argue their way there. That is ' +
      'what makes it self-healing, and also why it never does anything ' +
      'instantly and why the failure modes are so hard to reason about.',
    keyInsight:
      'Declarative reconciliation is the whole idea. You do not tell it to ' +
      'restart a pod; you tell it three should exist, and it notices two do.',
  },
  {
    id: 'nginx',
    name: 'NGINX',
    realName: 'nginx',
    type: 'infra',
    roles: ['ingest'],
    base: {
      throughput: 185,
      latency: 10,
      durability: 150,
      memory: 40,
      consistency: 120,
      scalability: 120,
    },
    growth: {
      throughput: 5.6,
      latency: 0.1,
      durability: 4.4,
      memory: 1.2,
      consistency: 1.8,
      scalability: 3.0,
    },
    skills: ['reverse-proxy', 'rate-limit', 'layer-cache'],
    rarity: 44,
    habitats: ['container-yards', 'memory-flats'],
    codex:
      'An event-driven reverse proxy that serves tens of thousands of ' +
      'concurrent connections from a few worker processes and almost no ' +
      'memory. It terminates TLS, buffers slow clients so they never occupy an ' +
      'application worker, caches, and rate limits - all before your code is ' +
      'involved at all.',
    keyInsight:
      'Work shed at the edge costs nothing downstream. Rate limiting in front ' +
      'is always cheaper than handling the load behind.',
  },
  {
    id: 'envoy',
    name: 'ENVOY',
    realName: 'Envoy Proxy',
    type: 'infra',
    roles: ['ingest', 'process'],
    base: {
      throughput: 165,
      latency: 16,
      durability: 145,
      memory: 85,
      consistency: 140,
      scalability: 150,
    },
    growth: {
      throughput: 5.0,
      latency: 0.15,
      durability: 4.2,
      memory: 2.5,
      consistency: 2.2,
      scalability: 3.8,
    },
    skills: ['circuit-breaker', 'rate-limit', 'reverse-proxy'],
    rarity: 24,
    habitats: ['container-yards'],
    codex:
      'A proxy designed to be deployed next to every service rather than only ' +
      'at the edge. It is reconfigured over an API at runtime instead of by ' +
      'reloading a file, which is what lets a control plane change routing, ' +
      'retries, and circuit breaking across a whole fleet without a restart. ' +
      'This is the data plane under most service meshes.',
    keyInsight:
      'Retries, timeouts and circuit breaking belong in the network layer, ' +
      'not reimplemented badly in every service in every language.',
  },
];
