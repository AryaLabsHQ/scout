import { defineConfig } from "oxlint"

export default defineConfig({
  categories: {
    correctness: "error",
    suspicious: "warn",
    perf: "warn",
  },
  plugins: ["react", "typescript", "import"],
  rules: {
    "react/react-in-jsx-scope": "off",
  },
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
  ],
})
