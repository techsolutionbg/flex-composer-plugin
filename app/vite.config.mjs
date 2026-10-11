import react from "@vitejs/plugin-react"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"

const stub = fileURLToPath(new URL("./src/stub.ts", import.meta.url))

// One ES module and one stylesheet in ../assets, with React and BlockNote inside: plugin assets must be listed
// in plugin.json, so the build may not emit chunks or fonts.
export default defineConfig({
  plugins: [react()],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  resolve: {
    // The emoji picker is turned off; its data would only add size.
    alias: { "emoji-mart": stub, "@emoji-mart/data": stub },
  },
  build: {
    outDir: "../assets",
    emptyOutDir: false,
    copyPublicDir: false,
    sourcemap: false,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000,
    lib: {
      entry: "src/main.tsx",
      formats: ["es"],
      fileName: () => "composer.js",
      cssFileName: "composer",
    },
    minify: true,
    rolldownOptions: {
      output: { codeSplitting: false, minify: true },
    },
  },
})
