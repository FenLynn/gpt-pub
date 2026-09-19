import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/gpt-pub/p108/",
  build: {
    target: "es2020",
    sourcemap: true
  }
});
