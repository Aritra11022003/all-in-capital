// npm run eval — 1) runs the existing Vitest suite with a JSON reporter (results feed the eval report),
// 2) runs the evaluation harness. Exit code is non-zero if either fails (a fired kill criterion fails step 2).
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

mkdirSync("evals/reports/.cache", { recursive: true });
const run = (args) => spawnSync("npx", args, { stdio: "inherit", shell: process.platform === "win32" }).status ?? 1;
const unit = run(["vitest", "run", "--reporter=default", "--reporter=json", "--outputFile.json=evals/reports/.cache/unit-results.json"]);
const evals = run(["vitest", "run", "--config", "vitest.evals.config.mts", "--reporter=default"]);
console.log(`\nexisting tests: ${unit === 0 ? "PASS" : "FAIL"} · evaluation harness: ${evals === 0 ? "PASS (no kill criterion fired)" : "FAIL (see report)"}`);
process.exit(unit !== 0 ? unit : evals);
