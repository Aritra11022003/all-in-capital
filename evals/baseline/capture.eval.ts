// Captures a NEW baseline version: the last entry of BASELINE_RELEASES (evals/baseline/snapshot.ts). Runs only with
// CAPTURE_BASELINE=1 (npm run eval:baseline); otherwise skipped, so a normal eval run can never write a baseline.
// The file is created atomically and the write fails if it already exists (REG-07). Capture only with explicit approval.
import { it } from "vitest";
import { CURRENT_RELEASE, recommendationThresholds, releaseMetadata, scoringConfigHash, seedSnapshot, workingTreeProvenance, writeNewBaseline, type Baseline } from "./snapshot";

it.skipIf(process.env.CAPTURE_BASELINE !== "1")("captures a new seed baseline version", async () => {
  const meta = releaseMetadata(CURRENT_RELEASE); // refuses reused file names and a missing predecessor
  const b: Baseline = {
    ...meta,
    capturedAt: new Date().toISOString(),
    // Never presents an uncommitted tree as a commit: HEAD, cleanliness and (if dirty) a checksum of the changes.
    source: workingTreeProvenance([CURRENT_RELEASE.file]),
    thresholds: recommendationThresholds(),
    scoringConfigHash: scoringConfigHash(),
    apps: await seedSnapshot(),
  };
  writeNewBaseline(CURRENT_RELEASE.file, b);
});
