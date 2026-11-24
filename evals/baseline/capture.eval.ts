// Captures the P2 regression baseline. Runs only with CAPTURE_BASELINE=1 (npm run eval:baseline);
// otherwise skipped, so a normal eval run can never overwrite the frozen baseline.
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { it } from "vitest";
import { BASELINE_FILE, recommendationThresholds, scoringConfigHash, seedSnapshot, type Baseline } from "./snapshot";

it.skipIf(process.env.CAPTURE_BASELINE !== "1")("captures the seed baseline", async () => {
  const b: Baseline = {
    capturedAt: new Date().toISOString(),
    gitCommit: execSync("git rev-parse --short HEAD").toString().trim(),
    note: "Captured before P2 security remediation (C1–C8, P-C). Frozen: regenerate only with explicit approval.",
    thresholds: recommendationThresholds(),
    scoringConfigHash: scoringConfigHash(),
    apps: await seedSnapshot(),
  };
  writeFileSync(BASELINE_FILE, JSON.stringify(b, null, 2) + "\n");
});
