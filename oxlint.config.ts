import { defineConfig } from "oxlint";

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
  ignorePatterns: ["node_modules", "dist", "build", ".turbo", "output", ".output"],
});
