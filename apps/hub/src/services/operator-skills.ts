import { Config, Effect, Layer } from "effect"
import * as Context from "effect/Context"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { ScoutOperatorSkillDefinition } from "@scout/plugin-sdk/operator"
import { ManagementError, type OperatorSkill } from "@scout/shared"
import { PluginRegistry } from "./plugin-registry.js"

type ParsedFrontmatter = {
  readonly metadata: Record<string, string>
  readonly body: string
}

const parseFrontmatter = (raw: string): ParsedFrontmatter => {
  if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) {
    return {
      metadata: {},
      body: raw,
    }
  }

  const lines = raw.split(/\r?\n/)
  let index = 1
  const metadata: Record<string, string> = {}
  while (index < lines.length && lines[index] !== "---") {
    const line = lines[index]?.trim() ?? ""
    if (line.length > 0) {
      const separatorIndex = line.indexOf(":")
      if (separatorIndex > 0) {
        const key = line.slice(0, separatorIndex).trim()
        const value = line.slice(separatorIndex + 1).trim()
        metadata[key] = value
      }
    }
    index += 1
  }

  return {
    metadata,
    body: lines.slice(index + 1).join("\n").trim(),
  }
}

const BUILTIN_SKILLS_DIR = fileURLToPath(new URL("../../skills/", import.meta.url))

const toManagementError = (code: string, message: string): ManagementError =>
  new ManagementError({ code, message })

const basename = (path: string): string => path.split(/[/\\]/).at(-1) ?? path

const loadSkillFile = (
  filePath: string,
  source: OperatorSkill["source"],
): OperatorSkill | null => {
  const raw = readFileSync(filePath, "utf8")
  const { metadata, body } = parseFrontmatter(raw)
  const name = metadata["name"]?.trim() || basename(dirname(filePath))
  const description = metadata["description"]?.trim()

  if (!description || body.length === 0) {
    return null
  }

  return {
    id: name,
    name,
    description,
    source,
    content: body,
  }
}

const discoverSkillFiles = (dir: string): Array<string> => {
  if (!existsSync(dir)) {
    return []
  }

  const results: Array<string> = []

  const visit = (currentDir: string) => {
    const entries = readdirSync(currentDir, { withFileTypes: true })
    const skillFile = entries.find((entry) => entry.name === "SKILL.md")
    if (skillFile) {
      const fullPath = join(currentDir, skillFile.name)
      if (statSync(fullPath).isFile()) {
        results.push(fullPath)
      }
      return
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") {
        continue
      }

      const fullPath = join(currentDir, entry.name)
      if (entry.isDirectory()) {
        visit(fullPath)
      }
    }
  }

  visit(dir)
  return results
}

const toPluginSkillId = (pluginId: string, skillId: string): string => `${pluginId}/${skillId}`

const toPluginSkill = (
  pluginId: string,
  skill: ScoutOperatorSkillDefinition,
): OperatorSkill => ({
  id: toPluginSkillId(pluginId, skill.id),
  name: skill.name,
  description: skill.description,
  source: "plugin",
  content: skill.content,
})

export class OperatorSkills extends Context.Service<
  OperatorSkills,
  {
    readonly list: () => Effect.Effect<ReadonlyArray<OperatorSkill>>
    readonly resolve: (
      skillIds: ReadonlyArray<string>,
    ) => Effect.Effect<ReadonlyArray<OperatorSkill>, ManagementError>
  }
>()(
  "@scout/OperatorSkills",
  {
    make: Effect.gen(function* () {
      const configuredDirs = yield* Config.withDefault(
        Config.String("SCOUT_OPERATOR_SKILLS_DIRS"),
        "",
      )
      const pluginRegistry = yield* PluginRegistry

      const scanRoots = [
        BUILTIN_SKILLS_DIR,
        ...configuredDirs
          .split(":")
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
          .map((value) => resolve(value)),
      ]

      const skillMap = new Map<string, OperatorSkill>()
      for (const root of scanRoots) {
        const source: OperatorSkill["source"] = root === BUILTIN_SKILLS_DIR ? "builtin" : "directory"
        for (const filePath of discoverSkillFiles(root)) {
          const skill = loadSkillFile(filePath, source)
          if (!skill || skillMap.has(skill.id)) {
            continue
          }
          skillMap.set(skill.id, skill)
        }
      }

      const operatorPlugins = yield* pluginRegistry.listOperatorPlugins()
      for (const plugin of operatorPlugins) {
        for (const skill of plugin.operator.skills ?? []) {
          const normalized = toPluginSkill(plugin.manifest.id, skill)
          if (!skillMap.has(normalized.id)) {
            skillMap.set(normalized.id, normalized)
          }
        }
      }

      const sortedSkills = [...skillMap.values()].sort((left, right) =>
        left.name.localeCompare(right.name),
      )

      const list = () => Effect.succeed(sortedSkills)
      const resolveSkills = (skillIds: ReadonlyArray<string>) =>
        Effect.forEach(skillIds, (skillId) => {
          const skill = skillMap.get(skillId)
          return skill === undefined
            ? Effect.fail(
                toManagementError(
                  "operator-skill-missing",
                  `Operator skill ${skillId} is not available`,
                ),
              )
            : Effect.succeed(skill)
        })

      return {
        list,
        resolve: resolveSkills,
      }
    }),
  },
) {
  static readonly layer = Layer.effect(this, this.make)
}
