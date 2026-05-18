import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [svelte(), tailwindcss()],
  publicDir: "public",
  build: {
    outDir: "out",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        shell: resolve(__dirname, "index.html"),
        sandbox: resolve(__dirname, "sandbox.html"),
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
