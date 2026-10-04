import tailwindcss from "@tailwindcss/vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { nitro } from "nitro/vite"
import { defineConfig } from "vite"

// Dev only: the browser talks to the hub same-origin (`/ws/rpc`), as it does
// behind the production reverse proxy, so the dev server forwards it.
const hubUrl = process.env["SCOUT_HUB_URL"] || "http://127.0.0.1:3001"

const config = defineConfig({
  resolve: {
    // Resolves the `@/*` alias from tsconfig.json (Vite 8 built-in).
    tsconfigPaths: true,
  },
  server: {
    proxy: {
      "/ws/rpc": { target: hubUrl, ws: true, changeOrigin: true },
    },
  },
  plugins: [nitro(), tailwindcss(), tanstackStart(), viteReact()],
})

export default config
