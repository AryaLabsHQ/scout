# Async/Await to Effect.gen Migration Guide

**Source:** `effect/Effect.ts` (`Effect.gen`, `Effect.fn`, `Effect.fnUntraced`, `Effect.tryPromise`) - see `~/Developer/effect/packages/effect/src/Effect.ts`

Based on Kit Langton's effectification of opencode (March 2026).

**Commit references:**

- `4f784276b` - effectify resolvePromptParts: use AppFileSystem and Agent service directly
- `724e599cb` - effectify createUserMessage: move into layer as createMessage, delete old 400-line async version
- `eaf345410` - effectify prompt tool resolution

---

## 1. Function Definition Migration

### Before: Async Functions

```ts
async function resolvePromptParts(
  template: string,
): Promise<PromptInput["parts"]> {
  // ... implementation
}

async function createUserMessage(input: PromptInput): Promise<MessageV2.User> {
  // ... implementation
}
```

### After: Effect.fn with Generator

```ts
import { Effect, Context } from "effect";

const resolvePromptParts = Effect.fn("SessionPrompt.resolvePromptParts")(
  function* (template: string) {
    // ... implementation with yield*
  },
);

const createUserMessage = Effect.fn("SessionPrompt.createUserMessage")(
  function* (input: PromptInput) {
    // ... implementation with yield*
  },
);
```

### Effect.fn Naming Convention

The name parameter in `Effect.fn("Name")` is used for:

- **Tracing**: Appears in fiber dumps and stack traces
- **Debugging**: Better error messages when effects fail
- **Observability**: Shows up in OpenTelemetry spans and logs

**Pattern**: Use `Domain.method` format (e.g., `"SessionPrompt.resolvePromptParts"`)

**Untraced variants**: Use `Effect.fnUntraced` for internal helpers where trace overhead isn't needed:

```ts
const internalHelper = Effect.fnUntraced(function* (x: string) {
  // No trace overhead
});
```

---

## 2. Service Access Pattern

### Before: Direct async service calls

```ts
// Outside layer - services accessed ad-hoc
async function resolvePromptParts(template: string) {
  const parts: PromptInput["parts"] = [{ type: "text", text: template }];
  const files = ConfigMarkdown.files(template);

  for (const match of files) {
    const filepath = name.startsWith("~/")
      ? path.join(os.homedir(), name.slice(2))
      : path.resolve(Instance.worktree, name);

    // Calling raw filesystem utility
    const info = await Filesystem.stat(filepath); // ❌ No typed error handling
    if (!info) {
      const found = await Agent.get(name); // ❌ Direct call, no context
      if (found) parts.push({ type: "agent", name: found.name });
    }
  }
}
```

### After: Yield services at layer level

```ts
// Inside Layer.effect - services yielded once
const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    // Yield services at the layer level
    const fsys = yield* AppFileSystem.Service; // ✅ Service yielded here
    const agents = yield* Agent.Service; // ✅ Service yielded here

    // Use yielded service instances in functions
    const resolvePromptParts = Effect.fn("SessionPrompt.resolvePromptParts")(
      function* (template: string) {
        const parts: PromptInput["parts"] = [{ type: "text", text: template }];
        const files = ConfigMarkdown.files(template);
        const seen = new Set<string>();

        yield* Effect.forEach(
          files,
          Effect.fnUntraced(function* (match) {
            const name = match[1];
            if (seen.has(name)) return;
            seen.add(name);

            const filepath = name.startsWith("~/")
              ? path.join(os.homedir(), name.slice(2))
              : path.resolve(Instance.worktree, name);

            // Use the yielded service directly
            const info = yield* fsys.stat(filepath).pipe(Effect.option);
            if (Option.isNone(info)) {
              const found = yield* agents.get(name); // ✅ Using yielded service
              if (found) parts.push({ type: "agent", name: found.name });
              return;
            }
            // ...
          }),
          { concurrency: "unbounded", discard: true },
        );
        return parts;
      },
    );
  }),
);
```

### Decision: When to use services directly in layer

| Pattern                      | When to use                                                             |
| ---------------------------- | ----------------------------------------------------------------------- |
| **Service in layer closure** | Function lives inside `Layer.effect` - access yielded services directly |
| **Effect.promise wrapper**   | Function outside layer needs service - minimal wrapper to bridge        |
| **Pass as argument**         | Service needed in deeply nested function - pass explicitly              |

**Commit pattern**: "Use Service directly in layer" - this is the preferred approach for effectified services.

---

## 3. Parallel Execution

### Before: Promise.all

```ts
// Sequential await (slow)
for (const match of files) {
  await processFile(match); // Sequential execution
}

// Promise.all (parallel but no structured concurrency)
const results = await Promise.all([
  processFile(file1),
  processFile(file2),
  processFile(file3),
]);
```

### After: Effect.forEach with concurrency

```ts
// Sequential with Effect.forEach (default)
yield *
  Effect.forEach(files, function* (file) {
    yield* processFile(file);
  });

// Unbounded parallelism
yield *
  Effect.forEach(
    files,
    Effect.fnUntraced(function* (match) {
      const name = match[1];
      if (seen.has(name)) return;
      seen.add(name);
      // ... process
    }),
    { concurrency: "unbounded", discard: true }, // ✅ Parallel, ignore results
  );

// Fixed concurrency limit
yield *
  Effect.forEach(
    items,
    fn,
    { concurrency: 5 }, // ✅ Max 5 concurrent
  );

// Inherit from parent
yield *
  Effect.forEach(
    items,
    fn,
    { concurrency: "inherit" }, // ✅ Use parent's concurrency setting
  );
```

### Concurrency Options

| Option        | Behavior                               |
| ------------- | -------------------------------------- |
| `"unbounded"` | Run all in parallel (use with caution) |
| `"inherit"`   | Use parent's concurrency setting       |
| `number`      | Fixed limit of concurrent executions   |
| `undefined`   | Sequential execution                   |

---

## 4. Error Handling Migration

### Before: try/catch

```ts
async function readResource(clientName: string, uri: string) {
  try {
    const content = await MCP.readResource(clientName, uri);
    return content;
  } catch (error) {
    log.error("failed to read MCP resource", { error, clientName, uri });
    throw error;
  }
}
```

### After: Effect.exit with Cause.squash

```ts
const exit = yield * mcp.readResource(clientName, uri).pipe(Effect.exit);

if (Exit.isSuccess(exit)) {
  const content = exit.value;
  // Process success...
} else {
  const error = Cause.squash(exit.cause); // ✅ Flatten cause to single error
  log.error("failed to read MCP resource", { error, clientName, uri });
  // Handle error...
}
```

### After: Effect.catchTag for Tagged Errors

```ts
yield *
  someEffect.pipe(
    Effect.catchTag("ModelNotFoundError", (e) =>
      Effect.sync(() => {
        log.warn("Model not found, using default", { model: e.modelID });
        return defaultModel;
      }),
    ),
  );
```

### After: Effect.catchIf for Predicates

```ts
yield *
  riskyOperation.pipe(
    Effect.catchIf(
      (error) => error.code === "ENOENT", // ✅ Predicate-based
      (error) => Effect.succeed(defaultValue),
    ),
  );
```

### Converting Exceptions to Tagged Errors

```ts
import { Effect, Schema } from "effect";

// Define tagged error class
class ResourceNotFound extends Schema.TaggedErrorClass<ResourceNotFound>()(
  "ResourceNotFound",
  {
    clientName: Schema.String,
    uri: Schema.String,
  },
) {}

// Convert Promise exception to typed error
const readResource = (clientName: string, uri: string) =>
  Effect.tryPromise({
    try: () => mcp.readResource(clientName, uri),
    catch: (error) => new ResourceNotFound({ clientName, uri }),
  });
```

---

## 5. Optional Values

### Before: Nullable checks

```ts
const info = await fsys.stat(filepath);
if (info === null) {
  // Handle missing
  const found = await agents.get(name);
  if (found) {
    parts.push({ type: "agent", name: found.name });
  }
} else {
  // Use info
  parts.push({
    type: "file",
    url: pathToFileURL(filepath).href,
    filename: name,
    mime: info.type === "Directory" ? "application/x-directory" : "text/plain",
  });
}
```

### After: Effect.option + Option helpers

```ts
const info = yield * fsys.stat(filepath).pipe(Effect.option); // ✅ Returns Option<Stat>

if (Option.isNone(info)) {
  // ✅ Check for None
  const found = yield * agents.get(name);
  if (found) parts.push({ type: "agent", name: found.name });
  return;
}

const stat = info.value; // ✅ Safe access after isNone check
parts.push({
  type: "file",
  url: pathToFileURL(filepath).href,
  filename: name,
  mime: stat.type === "Directory" ? "application/x-directory" : "text/plain",
});
```

### Option.getOrElse for Defaults

```ts
const value =
  yield *
  maybeValue.pipe(
    Effect.map(Option.getOrElse(() => defaultValue)), // ✅ Provide default
  );
```

---

## 6. Composition Patterns

### Before: Wrapping with Effect.promise

```ts
// ❌ Unnecessary wrapper - function is already async
const result = yield * Effect.promise(() => resolvePromptParts(template));
```

### After: Direct yield\* composition

```ts
// ✅ Direct composition - no wrapper needed
const result = yield * resolvePromptParts(template);
```

### When to use Effect.promise

```ts
// ✅ Use Effect.promise for external Promise-based APIs
const model =
  yield * Effect.promise(() => Provider.getModel(providerID, modelID));

// ✅ With error transformation
const model =
  yield *
  Effect.promise(() =>
    Provider.getModel(providerID, modelID).catch((e) => {
      if (Provider.ModelNotFoundError.isInstance(e)) {
        // Transform error
      }
      throw e;
    }),
  );
```

### Moving Functions into Layer Closure

```ts
// Before: Standalone async function outside layer
async function resolvePromptPartsImpl(template: string): Promise<...> {
  // Had to use Effect.promise wrappers for every service call
}

// After: Function inside layer, uses yielded services directly
const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fsys = yield* AppFileSystem.Service
    const agents = yield* Agent.Service

    // ✅ Now inside layer - direct service access
    const resolvePromptParts = Effect.fn("SessionPrompt.resolvePromptParts")(
      function* (template: string) {
        const info = yield* fsys.stat(filepath).pipe(Effect.option)
        const found = yield* agents.get(name)
        // ...
      }
    )
  })
)
```

**Key insight**: Moving functions into the layer closure eliminates most `Effect.promise` wrappers because services are already available as yielded instances.

---

## 7. Looping and Recursion

### Before: for loops with await

```ts
async function processParts(parts: Part[]) {
  const results = [];
  for (const part of parts) {
    const processed = await processPart(part); // Sequential
    results.push(processed);
  }
  return results;
}
```

### After: Effect.forEach

```ts
const processParts = (parts: Part[]) =>
  Effect.forEach(
    parts,
    Effect.fn("processPart")(function* (part) {
      yield* processPart(part);
    }),
    { concurrency: "unbounded" }, // Parallel when safe
  );
```

### Recursive async → Effect.gen

```ts
// Before: Recursive async
async function traverseDirectory(dir: string, depth = 0): Promise<File[]> {
  if (depth > 10) return [];
  const entries = await fs.readdir(dir);
  const files: File[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = await fs.stat(fullPath);
    if (stat.isDirectory()) {
      files.push(...(await traverseDirectory(fullPath, depth + 1)));
    } else {
      files.push({ path: fullPath, size: stat.size });
    }
  }
  return files;
}

// After: Recursive Effect.gen
const traverseDirectory = Effect.fn("traverseDirectory")(function* (
  dir: string,
  depth = 0,
): Effect.Effect<File[], never, FileSystem.FileSystem> {
  if (depth > 10) return [];

  const fs = yield* FileSystem.FileSystem;
  const entries = yield* fs.readDirectory(dir);

  const files: File[] = [];

  yield* Effect.forEach(
    entries,
    Effect.fnUntraced(function* (entry) {
      const fullPath = path.join(dir, entry);
      const stat = yield* fs.stat(fullPath);

      if (stat._tag === "Some" && stat.value.type === "Directory") {
        const subFiles = yield* traverseDirectory(fullPath, depth + 1); // Recursive
        files.push(...subFiles);
      } else if (stat._tag === "Some") {
        files.push({ path: fullPath, size: stat.value.size });
      }
    }),
    { concurrency: 5 },
  );

  return files;
});
```

### Effect.loop for indexed iteration

```ts
yield *
  Effect.loop(
    0, // initial state
    (i) => i < 10, // while condition
    (i) => i + 1, // increment
    (i) => Effect.sync(() => console.log(i)),
  );
```

### Effect.repeat for retries

```ts
yield *
  operation.pipe(
    Effect.repeat(Schedule.recurs(3)), // Retry 3 times
  );
```

---

## 8. Real Examples from Opencode SessionPrompt

### Example 1: resolvePromptParts (commit 4f784276b)

**Before:**

```ts
// Outside layer, had to use wrapper
const resolvePromptParts = (template: string) =>
  Effect.promise(() => resolvePromptPartsImpl(template));

// Standalone async implementation with ad-hoc service access
async function resolvePromptPartsImpl(
  template: string,
): Promise<PromptInput["parts"]> {
  const parts: PromptInput["parts"] = [{ type: "text", text: template }];
  const files = ConfigMarkdown.files(template);

  for (const match of files) {
    const name = match[1];
    const filepath = name.startsWith("~/")
      ? path.join(os.homedir(), name.slice(2))
      : path.resolve(Instance.worktree, name);

    const info = await Filesystem.stat(filepath); // Raw utility call
    if (!info) {
      const found = await Agent.get(name); // Direct call
      if (found) parts.push({ type: "agent", name: found.name });
      continue;
    }
    // ...
  }
  return parts;
}
```

**After:**

```ts
// Inside Layer.effect closure
const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fsys = yield* AppFileSystem.Service; // ✅ Yielded at layer level
    const agents = yield* Agent.Service; // ✅ Yielded at layer level

    const resolvePromptParts = Effect.fn("SessionPrompt.resolvePromptParts")(
      function* (template: string) {
        const parts: PromptInput["parts"] = [{ type: "text", text: template }];
        const files = ConfigMarkdown.files(template);
        const seen = new Set<string>();

        yield* Effect.forEach(
          files,
          Effect.fnUntraced(function* (match) {
            const name = match[1];
            if (seen.has(name)) return;
            seen.add(name);

            const filepath = name.startsWith("~/")
              ? path.join(os.homedir(), name.slice(2))
              : path.resolve(Instance.worktree, name);

            const info = yield* fsys.stat(filepath).pipe(Effect.option); // ✅ Using yielded service
            if (Option.isNone(info)) {
              const found = yield* agents.get(name); // ✅ Using yielded service
              if (found) parts.push({ type: "agent", name: found.name });
              return;
            }

            const stat = info.value;
            parts.push({
              type: "file",
              url: pathToFileURL(filepath).href,
              filename: name,
              mime:
                stat.type === "Directory"
                  ? "application/x-directory"
                  : "text/plain",
            });
          }),
          { concurrency: "unbounded", discard: true },
        );
        return parts;
      },
    );
  }),
);
```

### Example 2: createUserMessage Error Handling (commit 724e599cb)

**Before:**

```ts
// try/catch with implicit error handling
try {
  const content = await MCP.readResource(clientName, uri);
  // ...
} catch (error: unknown) {
  log.error("failed to read MCP resource", { error, clientName, uri });
  const message = error instanceof Error ? error.message : String(error);
  pieces.push({
    type: "text",
    synthetic: true,
    text: `Failed to read MCP resource ${part.filename}: ${message}`,
  });
}
```

**After:**

```ts
// Explicit exit handling with Cause.squash
const exit = yield * mcp.readResource(clientName, uri).pipe(Effect.exit);

if (Exit.isSuccess(exit)) {
  const content = exit.value;
  if (!content) throw new Error(`Resource not found: ${clientName}/${uri}`);
  const items = Array.isArray(content.contents)
    ? content.contents
    : [content.contents];
  for (const c of items) {
    if ("text" in c && c.text) {
      pieces.push({
        messageID: info.id,
        sessionID: input.sessionID,
        type: "text",
        synthetic: true,
        text: c.text,
      });
    } else if ("blob" in c && c.blob) {
      const mime = "mimeType" in c ? c.mimeType : part.mime;
      pieces.push({
        messageID: info.id,
        sessionID: input.sessionID,
        type: "text",
        synthetic: true,
        text: `[Binary content: ${mime}]`,
      });
    }
  }
  pieces.push({ ...part, messageID: info.id, sessionID: input.sessionID });
} else {
  const error = Cause.squash(exit.cause); // ✅ Flatten to single error
  log.error("failed to read MCP resource", { error, clientName, uri });
  const message = error instanceof Error ? error.message : String(error);
  pieces.push({
    messageID: info.id,
    sessionID: input.sessionID,
    type: "text",
    synthetic: true,
    text: `Failed to read MCP resource ${part.filename}: ${message}`,
  });
}
```

### Example 3: Service Access with Option (commit 4f784276b)

**Before:**

```ts
const info = await Filesystem.stat(filepath);
if (!info) {
  // Nullable check
  const found = await Agent.get(name);
  if (found) parts.push({ type: "agent", name: found.name });
  continue;
}
```

**After:**

```ts
const info = yield * fsys.stat(filepath).pipe(Effect.option); // Returns Option
if (Option.isNone(info)) {
  // Explicit Option check
  const found = yield * agents.get(name);
  if (found) parts.push({ type: "agent", name: found.name });
  return;
}
const stat = info.value; // Safe access
```

### Example 4: Parallel File Processing (commit 724e599cb)

**Before:**

```ts
const parts = await Promise.all(
  input.parts.map(async (part): Promise<Draft<MessageV2.Part>[]> => {
    if (part.type === "file") {
      // Sequential await inside map
      const symbols = await LSP.documentSymbol(filePathURI).catch(() => []);
      // ...
    }
  }),
);
```

**After:**

```ts
// First yield services at layer level
const lsp = yield * LSP.Service;

// Then use in function with proper error handling
const symbols =
  yield *
  lsp.documentSymbol(filePathURI).pipe(Effect.catch(() => Effect.succeed([]))); // ✅ Effect.catch replaces .catch()
```

---

## Summary: Migration Decision Tree

```
Should I effectify this function?
├─ Is it inside a Layer.effect closure?
│  └─ YES → Use yielded services directly, no Effect.promise wrappers needed
│
├─ Does it call other Effect functions?
│  └─ YES → Use Effect.gen + yield* for composition
│
├─ Does it use Promise-based APIs?
│  ├─ Has error handling needs? → Effect.tryPromise with catch
│  └─ Simple Promise? → Effect.promise
│
├─ Does it need parallel execution?
│  └─ YES → Effect.forEach with concurrency option
│
├─ Does it need error recovery?
│  ├─ Catch specific error tag → Effect.catchTag
│  ├─ Catch by predicate → Effect.catchIf
│  └─ Inspect success/failure → Effect.exit + Exit.isSuccess/Cause.squash
│
└─ Does it deal with nullable values?
   └─ YES → Effect.option + Option.isNone/isSome
```

---

## Key Takeaways from Kit's Effectification

1. **Move functions into layer closure** - Eliminates most `Effect.promise` wrappers
2. **Yield services at layer level** - Access them directly in nested functions
3. **Use `Effect.exit` + `Cause.squash`** - For explicit error handling over try/catch
4. **Prefer `Effect.option`** - Over nullable checks for optional values
5. **Direct `yield* fn()` composition** - Don't wrap with `Effect.promise` when calling other Effect functions
6. **Use `Effect.fn` naming** - Critical for debugging and observability
7. **Parallel with `Effect.forEach`** - Structured concurrency over `Promise.all`

---

**File paths referenced:**

- `packages/opencode/src/session/prompt.ts`
- Commits: `4f784276b`, `724e599cb`, `eaf345410`
