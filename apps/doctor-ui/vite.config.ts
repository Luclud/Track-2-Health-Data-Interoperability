import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served by the core at /widget/ (production build) or by Vite on :5173 (dev, proxies /api to the core).
export default defineConfig({
  base: "/widget/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3000" },
  },
});
