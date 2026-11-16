import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Served from GitHub Pages at https://agusher21.github.io/ship-weeks-helper/
// so assets must resolve under that sub-path. The build output goes to docs/
// (the Pages source) on the main branch.
export default defineConfig({
  base: "/ship-weeks-helper/",
  build: { outDir: "docs" },
  plugins: [react()],
  server: { port: 5174 },
});
