import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => {
  const apiProxyTarget =
    process.env.VITE_API_PROXY_TARGET ?? "http://127.0.0.1:8000";

  return {
    base: command === "serve" ? "/" : "/static/frontend/",
    plugins: [react()],
    build: {
      outDir: "../static/frontend",
      emptyOutDir: true,
    },
    server: {
      port: 5173,
      // Docker Desktop mounts on Windows do not deliver file change events,
      // so the containerized dev server opts into polling via this env var.
      watch: process.env.VITE_WATCH_POLLING
        ? { interval: 300, usePolling: true }
        : undefined,
      proxy: {
        "/api": apiProxyTarget,
        "/accounts": apiProxyTarget,
        "/media": apiProxyTarget,
      },
    },
  };
});
