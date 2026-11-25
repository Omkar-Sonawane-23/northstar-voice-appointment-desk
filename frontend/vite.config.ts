import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:7860",
      "/start": "http://localhost:7860",
      "/sessions": "http://localhost:7860",
    },
  },
});
