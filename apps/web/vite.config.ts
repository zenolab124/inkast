import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        // Image generation can take several minutes via third-party proxies.
        // Default http-proxy timeouts are short enough to misreport mid-flight
        // generations as 502; bump both to match the driver's ceiling.
        timeout: 600_000,
        proxyTimeout: 600_000,
      },
    },
  },
});
