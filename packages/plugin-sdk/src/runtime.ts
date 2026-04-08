import type { Effect, Stream } from "effect"
import { Schema } from "effect"
import type {
  ActionDefinition,
  ActionTarget,
  EventChunk,
  LogChunk,
  PluginAlertDefinition,
  PluginCapability,
  PluginManifest,
  PluginPermission,
  PluginUiScreen,
  PluginCollectionResult,
  SessionChunk,
  StreamDefinition,
} from "./schemas.js"
import type { ScoutOperatorSurface } from "./operator.js"

export type AnySchema<A = unknown> = Schema.Schema<A>

export type ScoutPluginLoadedRuntime = "agent" | "hub" | "web" | "operator"

export interface DetectContext {
  readonly nodeId: string
  readonly now: number
}

export interface CollectContext {
  readonly nodeId: string
  readonly now: number
}

export interface ActionContext {
  readonly nodeId: string
  readonly permissions: ReadonlySet<PluginPermission>
}

export interface StreamContext extends ActionContext {}

export interface HubContext {
  readonly pluginId: string
}

export interface WebContext {
  readonly pluginId: string
}

export interface ScoutActionHandler<Input = unknown, Output = unknown, E = never, R = never> {
  readonly definition: ActionDefinition
  readonly inputSchema: AnySchema<Input>
  readonly outputSchema: AnySchema<Output>
  readonly execute: (
    ctx: ActionContext,
    target: ActionTarget,
    input: Input,
  ) => Effect.Effect<Output, E, R>
}

export interface ScoutStreamHandler<Input = unknown, Chunk = unknown, E = never, R = never> {
  readonly definition: StreamDefinition
  readonly inputSchema: AnySchema<Input>
  readonly chunkSchema: AnySchema<Chunk>
  readonly open: (
    ctx: StreamContext,
    target: ActionTarget,
    input: Input,
  ) => Stream.Stream<Chunk, E, R>
}

export interface ScoutAgentPlugin<E = never, R = never> {
  readonly detect: (ctx: DetectContext) => Effect.Effect<PluginCapability, E, R>
  readonly collect?: (
    ctx: CollectContext,
  ) => Effect.Effect<PluginCollectionResult, E, R>
  readonly actions?: ReadonlyArray<ScoutActionHandler<unknown, unknown, E, R>>
  readonly streams?: ReadonlyArray<
    | ScoutStreamHandler<unknown, LogChunk, E, R>
    | ScoutStreamHandler<unknown, SessionChunk, E, R>
    | ScoutStreamHandler<unknown, EventChunk, E, R>
  >
}

export interface ScoutHubPlugin {
  readonly alerts?: ReadonlyArray<PluginAlertDefinition>
}

export interface ScoutWebPlugin {
  readonly screens: ReadonlyArray<PluginUiScreen>
}

export interface ScoutPlugin<E = never, R = never> {
  readonly manifest: PluginManifest
  readonly agent?: ScoutAgentPlugin<E, R>
  readonly hub?: ScoutHubPlugin
  readonly web?: ScoutWebPlugin
  readonly operator?: ScoutOperatorSurface
}

export interface LoadedScoutPlugin<E = never, R = never> extends ScoutPlugin<E, R> {
  readonly rootDir: string
  readonly pluginPath: string
}

export const defineAgent = <const T extends ScoutAgentPlugin<any, any>>(agent: T): T => agent

export const defineHub = <const T extends ScoutHubPlugin>(hub: T): T => hub

export const defineWeb = <const T extends ScoutWebPlugin>(web: T): T => web

export const definePlugin = <const T extends ScoutPlugin<any, any>>(plugin: T): T => plugin

export const getLoadedPluginRuntimes = (
  plugin: Pick<ScoutPlugin, "agent" | "hub" | "web" | "operator">,
): ReadonlyArray<ScoutPluginLoadedRuntime> =>
  [
    ...(plugin.agent !== undefined ? ["agent" as const] : []),
    ...(plugin.hub !== undefined ? ["hub" as const] : []),
    ...(plugin.web !== undefined ? ["web" as const] : []),
    ...(plugin.operator !== undefined ? ["operator" as const] : []),
  ]
