import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Evaluation harness config (npm run eval). Kept separate so `npm test` is unchanged.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["evals/**/*.eval.ts"], environment: "node", testTimeout: 120000 },
});
