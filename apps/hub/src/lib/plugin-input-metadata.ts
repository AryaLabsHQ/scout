import { SchemaAST } from "effect"
import type { LoadedPluginPackage } from "@scout/plugin-sdk"

export interface PluginFormOptionMetadata {
  readonly label: string
  readonly value: string | number | boolean
}

export interface PluginFormFieldMetadata {
  readonly name: string
  readonly label: string
  readonly kind: "string" | "number" | "boolean" | "enum"
  readonly required: boolean
  readonly multiline?: boolean
  readonly options?: ReadonlyArray<PluginFormOptionMetadata>
}

export type PluginInputMetadata =
  | { readonly kind: "none" }
  | { readonly kind: "struct"; readonly fields: ReadonlyArray<PluginFormFieldMetadata> }
  | { readonly kind: "unsupported"; readonly reason: string }

export interface PluginActionMetadata {
  readonly id: string
  readonly displayName: string
  readonly description?: string
  readonly requiresConfirmation: boolean
  readonly targetKinds: ReadonlyArray<string>
  readonly input: PluginInputMetadata
}

export interface PluginStreamMetadata {
  readonly id: string
  readonly displayName: string
  readonly description?: string
  readonly kind: string
  readonly targetKinds: ReadonlyArray<string>
  readonly input: PluginInputMetadata
}

const prettifyFieldName = (name: string): string =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\w/, (match) => match.toUpperCase())

const shouldUseTextarea = (name: string): boolean =>
  /content|script|body|text|yaml|json|config/i.test(name)

const toLiteralOption = (
  ast: SchemaAST.AST,
): PluginFormOptionMetadata | null =>
  SchemaAST.isLiteral(ast)
    && (typeof ast.literal === "string"
      || typeof ast.literal === "number"
      || typeof ast.literal === "boolean")
    ? {
        label: String(ast.literal),
        value: ast.literal,
      }
    : null

const unwrapOptionalUnion = (ast: SchemaAST.AST): SchemaAST.AST => {
  if (!SchemaAST.isUnion(ast)) {
    return ast
  }

  const withoutUndefined = ast.types.filter((member) => !SchemaAST.isUndefined(member))
  return withoutUndefined.length === 1 ? withoutUndefined[0]! : ast
}

const astToFieldMetadata = (
  name: string,
  ast: SchemaAST.AST,
): PluginFormFieldMetadata | null => {
  const normalized = unwrapOptionalUnion(ast)
  const required = !(ast.context?.isOptional ?? false)

  if (SchemaAST.isString(normalized)) {
    return {
      name,
      label: prettifyFieldName(name),
      kind: "string",
      required,
      ...(shouldUseTextarea(name) && { multiline: true }),
    }
  }

  if (SchemaAST.isNumber(normalized)) {
    return {
      name,
      label: prettifyFieldName(name),
      kind: "number",
      required,
    }
  }

  if (SchemaAST.isBoolean(normalized)) {
    return {
      name,
      label: prettifyFieldName(name),
      kind: "boolean",
      required,
    }
  }

  if (SchemaAST.isLiteral(normalized)) {
    const option = toLiteralOption(normalized)
    if (option === null) {
      return null
    }
    return {
      name,
      label: prettifyFieldName(name),
      kind: "enum",
      required,
      options: [option],
    }
  }

  if (SchemaAST.isUnion(normalized)) {
    const options = normalized.types
      .map((member) => toLiteralOption(member))
      .filter((option): option is PluginFormOptionMetadata => option !== null)

    if (options.length === normalized.types.length && options.length > 0) {
      return {
        name,
        label: prettifyFieldName(name),
        kind: "enum",
        required,
        options,
      }
    }
  }

  return null
}

export const serializeInputSchema = (
  schema: { readonly ast: SchemaAST.AST },
): PluginInputMetadata => {
  const ast = unwrapOptionalUnion(schema.ast)
  if (!SchemaAST.isObjects(ast)) {
    return { kind: "unsupported", reason: "Only object-shaped inputs are supported in the web form renderer." }
  }

  if (ast.indexSignatures.length > 0) {
    return { kind: "unsupported", reason: "Index-signature inputs are not supported in the web form renderer." }
  }

  if (ast.propertySignatures.length === 0) {
    return { kind: "none" }
  }

  const fields: PluginFormFieldMetadata[] = []
  for (const property of ast.propertySignatures) {
    if (typeof property.name !== "string") {
      return { kind: "unsupported", reason: "Only string-named form fields are supported." }
    }
    const field = astToFieldMetadata(property.name, property.type)
    if (field === null) {
      return {
        kind: "unsupported",
        reason: `Field "${String(property.name)}" uses an unsupported schema shape.`,
      }
    }
    fields.push(field)
  }

  return { kind: "struct", fields }
}

export const serializePluginActionMetadata = (
  plugin: LoadedPluginPackage,
): ReadonlyArray<PluginActionMetadata> =>
  (plugin.agent?.actions ?? []).map((action) => ({
    id: action.definition.id,
    displayName: action.definition.displayName,
    ...(action.definition.description !== undefined && { description: action.definition.description }),
    requiresConfirmation: action.definition.requiresConfirmation,
    targetKinds: action.definition.targetKinds,
    input: serializeInputSchema(action.inputSchema),
  }))

export const serializePluginStreamMetadata = (
  plugin: LoadedPluginPackage,
): ReadonlyArray<PluginStreamMetadata> =>
  (plugin.agent?.streams ?? []).map((stream) => ({
    id: stream.definition.id,
    displayName: stream.definition.displayName,
    ...(stream.definition.description !== undefined && { description: stream.definition.description }),
    kind: stream.definition.kind,
    targetKinds: stream.definition.targetKinds,
    input: serializeInputSchema(stream.inputSchema),
  }))
