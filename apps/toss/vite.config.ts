import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig, loadEnv } from "vite";

const tossRoot = path.resolve(__dirname);
const repoRoot = path.resolve(__dirname, "../..");
const webSrc = path.join(repoRoot, "apps/web/src");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, "");
  const proxyTarget = (env.TOSS_DEV_API_TARGET || "http://127.0.0.1:3000").replace(/\/$/, "");

  if (mode === "production") {
    const apiBase = (env.VITE_API_BASE_URL || env.VITE_BACKEND_URL || "").trim();
    if (!apiBase) {
      throw new Error(
        "[apps/toss] Production build needs VITE_API_BASE_URL (or VITE_BACKEND_URL) in the repo-root .env — " +
          "e.g. VITE_API_BASE_URL=https://web-puzzle.onrender.com — then run npm run ait:build again. " +
          "If this is unset, login uses relative /api URLs and the Toss WebView receives HTML instead of JSON."
      );
    }
  }

  return {
    root: tossRoot,
    envDir: repoRoot,
    plugins: [react(), tailwindcss()],
    define: {
      "process.env.GEMINI_API_KEY": JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        "@web": webSrc,
        "@contracts": path.join(repoRoot, "packages/contracts"),
      },
    },
    server: {
      port: 5174,
      strictPort: false,
      allowedHosts: true,
      proxy: {
        "/api": { target: proxyTarget, changeOrigin: true },
        "/socket.io": { target: proxyTarget, ws: true, changeOrigin: true },
      },
    },
    build: {
      outDir: path.join(tossRoot, "dist"),
      emptyOutDir: true,
    },
    optimizeDeps: {
      include: ["@apps-in-toss/web-framework"],
    },
  };
});
