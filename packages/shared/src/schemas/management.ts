import { Schema } from "effect"

// ─── Systemd ──────────────────────────────────────────────────────────────

export const SystemdUnitActionParamsSchema = Schema.Struct({
  agentId: Schema.String,
  unit: Schema.String,
})

export const SystemdReloadParamsSchema = Schema.Struct({
  agentId: Schema.String,
})

export const SystemdUnitFileParamsSchema = Schema.Struct({
  agentId: Schema.String,
  unit: Schema.String,
})

export const SystemdUnitFileSchema = Schema.Struct({
  path: Schema.String,
  content: Schema.String,
})

export const SystemdUnitFileEditParamsSchema = Schema.Struct({
  agentId: Schema.String,
  unit: Schema.String,
  content: Schema.String,
})

// ─── Docker ───────────────────────────────────────────────────────────────

export const DockerContainerActionParamsSchema = Schema.Struct({
  agentId: Schema.String,
  containerId: Schema.String,
})

/**
 * Docker inspect result — opaque JSON from the Docker Engine API. We
 * pass it through untyped since Scout only displays it, never navigates
 * its structure.
 */
export const DockerInspectResultSchema = Schema.Unknown

// ─── Kubernetes ───────────────────────────────────────────────────────────

export const K8sScaleParamsSchema = Schema.Struct({
  agentId: Schema.String,
  namespace: Schema.String,
  deployment: Schema.String,
  replicas: Schema.Number,
})

export const K8sRestartPodParamsSchema = Schema.Struct({
  agentId: Schema.String,
  namespace: Schema.String,
  pod: Schema.String,
})

export const K8sDescribeParamsSchema = Schema.Struct({
  agentId: Schema.String,
  /** Resource kind — e.g. "pod", "deployment", "service". */
  resource: Schema.String,
  name: Schema.String,
  namespace: Schema.String,
})

export const K8sDescribeResultSchema = Schema.Unknown

// ─── Errors ───────────────────────────────────────────────────────────────

/**
 * Generic management error the hub/agent can return for any of the
 * management RPCs. Carries a machine-readable code and human message.
 */
export class ManagementError extends Schema.ErrorClass<ManagementError>(
  "ManagementError",
)({
  code: Schema.String,
  message: Schema.String,
}) {}

export type SystemdUnitFile = typeof SystemdUnitFileSchema.Type
