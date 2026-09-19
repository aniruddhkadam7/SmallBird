import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

// getUserMedia only works on https:// (or localhost), so `npm run dev` serves
// a self-signed cert — that's what lets a phone on the same Wi-Fi open the
// dev server and use its microphone.
export default defineConfig(({ command }) => ({
  plugins: [react(), ...(command === "serve" ? [basicSsl()] : [])],
  server: {
    host: true,
    port: 5173,
    // The question-completeness heuristic is shared with the desktop app
    // (../src/questionCompleteness.ts) rather than copied, so the two never
    // drift apart — that file sits outside this project root.
    fs: { allow: [".."] },
  },
}));
