# Consumer versions

Check resolved dependencies before copying version-sensitive APIs. Version lineage and prerelease
differences live in [v4-beta-deltas.md](v4-beta-deltas.md).

## Resolved dependencies

1. Read the nearest `package.json`, workspace catalog, and lockfile.
2. Prefer the exact lockfile resolution over a range or `catalog:` declaration.
3. Check `node_modules/effect/package.json` when dependencies are installed.
4. Confirm every runtime `@effect/*` package resolves to the same version as `effect`; since 4.0.0
   the runtime and integration packages (`effect`, `@effect/platform-*`, `@effect/sql-*`,
   `@effect/ai-*`, `@effect/atom-*`, `@effect/opentelemetry`, `@effect/vitest`) release on one line,
   while tooling such as `@effect/language-service` and `@effect/tsgo` versions independently.
   Report mismatches before changing code.
5. Route on the resolved version:

   - `4.0.0-beta.*` or `4.0.0-rc.*` below `4.0.0-rc.118` → read
     [v4-beta-deltas.md](v4-beta-deltas.md) and substitute. These still export `effect/unstable/*`;
     this skill's `effect/<area>` imports do not resolve there.
   - `4.0.0-rc.118` → the module paths, `effect/encoding`, and Schema check names in this skill
     resolve, but `Schema.brand`, partition order, and other `4.0.0`-only changes do not apply.
   - `4.0.0` → this skill's examples, as written.
   - A later published version or unreleased `origin/main` → read the intervening sections of
     [v4-beta-deltas.md](v4-beta-deltas.md) and the package changelog; only use it if the consumer
     intentionally runs that build.

Representative checks:

```bash
rg -n '"(effect|@effect/[^"]+)"\s*:' . --glob package.json
rg -n '^    "(effect|@effect/[^"]+)": \["(effect|@effect/[^"]+)@' bun.lock
node -p "require('./node_modules/effect/package.json').version"
```

Adapt the lockfile command to the repository's package manager. Never install or upgrade packages
merely to answer which version is present.

## Canonical setup

- Use the repository's package manager and pin the exact published version. For a new Bun project on
  this skill's baseline:

  ```bash
  bun add --exact effect@4.0.0
  ```

  The `latest` dist-tag is `4.0.0` (checked 2026-10-01). `effect@rc` is the older `4.0.0-rc.118` and
  `effect@beta` is `4.0.0-beta.107`; neither is this skill's baseline.

- Pin runtime and integration packages to the same version: `@effect/platform-*`, `@effect/vitest`,
  `@effect/opentelemetry`, `@effect/sql-*`, `@effect/ai-*`, and `@effect/atom-*`.
- Platform HTTP comes from `effect/http`, not a separate `@effect/platform` package or the old
  `effect/unstable/http` path.
- `@effect/vitest` needs `vitest >=5.0.0 <6.0.0`; the changelog requires TypeScript 5.9 or newer.
- Do not use unreleased `origin/main` APIs unless the consumer intentionally runs a source build.

## Alignment policy

Do not normalize versions while implementing an unrelated feature. When an upgrade is in scope,
align `effect` and every runtime `@effect/*` package in one deliberate dependency change, read every
intervening delta, regenerate the lockfile, then compile and run focused tests.
