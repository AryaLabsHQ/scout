// Types/schemas whose source of truth is now effect/Schema — exported
// via the schemas/ barrel below. The old types/ interfaces for these are
// being phased out as M9 (effect-rpc migration) progresses.
export * from "./types/metrics.js"
export * from "./types/k8s.js"
export * from "./types/docker.js"
export * from "./types/systemd.js"
export * from "./types/protocol.js"
export * from "./types/collectors.js"

// Schema-derived types take precedence for the domain types that have
// been migrated. The old types/{system,alerts,terminal}.ts interfaces
// are no longer exported; consumers get the Schema-derived version.
export * from "./schemas/index.js"

// M9 RPC groups (client-hub, hub-agent, agent-hub).
export * from "./rpc/index.js"
