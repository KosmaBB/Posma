import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

/**
 * Fontsource ships every subset of every weight, each as woff2 with a woff
 * fallback. The interface is Polish — latin and latin-ext — and every
 * webview Tauri runs on reads woff2, so the rest only made the binary
 * bigger. Should fontsource change its format, nothing matches and the
 * fonts are simply bundled whole again.
 */
const latinFontsOnly = {
  name: "latin-fonts-only",
  // Before Vite rewrites the url()s into asset references.
  enforce: "pre" as const,
  transform(code: string, id: string) {
    if (!id.includes("@fontsource/") || !id.endsWith(".css")) return null;
    return code
      .replace(/\/\*[^*]*-(?:cyrillic|greek|vietnamese)[^*]*\*\/\s*@font-face\s*\{[^}]*\}/g, "")
      .replace(/,\s*url\([^)]*\.woff\)\s*format\('woff'\)/g, "");
  },
};

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), latinFontsOnly],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
    fs: {
      // access/catalog.json lives above this root and is the one place the
      // permission system is described; Rust embeds the same file.
      allow: [".."],
    },
  },
}));
