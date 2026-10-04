import { defineConfig } from "oxfmt"

// Matches the style the code base already uses: no semicolons, double quotes, trailing
// commas, 2-space indent. Import and Tailwind class sorting stay off because the existing
// order is hand-maintained; turning them on would reorder ~40 more files.
export default defineConfig({
  printWidth: 110,
  tabWidth: 2,
  useTabs: false,
  semi: false,
  singleQuote: false,
  trailingComma: "all",
  sortPackageJson: true,
  ignorePatterns: [
    // Shared, gitignored agent working memory.
    ".scratchpad/**",
    // Vendored agent skills, installed from skills-lock.json.
    ".agents/**",
    ".claude/**",
    "**/node_modules/**",
    // Build outputs and caches.
    "**/dist/**",
    "**/build/**",
    "**/.output/**",
    "**/.nitro/**",
    "**/.turbo/**",
    "**/.tanstack/**",
    "**/.vinxi/**",
    "**/coverage/**",
    // Generated files.
    "**/routeTree.gen.ts",
    "apps/hub/drizzle/migrations/**",
    // Lockfiles.
    "bun.lock",
    "skills-lock.json",
  ],
})
