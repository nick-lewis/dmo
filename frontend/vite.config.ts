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
      proxy: {
        "/api": apiProxyTarget,
      },
    },
  };
});
