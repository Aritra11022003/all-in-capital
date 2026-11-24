// Offline Loop 1 / Loop 2 suites built from the private B6 exports, plus harness self-checks.
// No model is called and nothing is trained. Synthetic data is NOT generated; the two self-check fixtures
// below are constructed test inputs (fictional), labelled as such, and are not training examples.
import { processApplication } from "@/lib/engine/process";
import { pagesFromPastedText } from "@/lib/engine/extraction/files";
import { THESIS_V1, CRITERIA_V1 } from "@/config/thesis";
import { PORTFOLIO_V1 } from "@/config/portfolio";
import type { Recommendation } from "@/lib/shared/types";
import type { AssertionResult, EvalCase, Suite } from "../framework/types";
import { loadLoop1, loadLoop2, type Loop1Record, type Loop2Record } from "../datasets/loops";
import { checkAvailability, checkFacts, checkIdentity, checkNoPersonalData, loop2Assertions, parseEmail, SEND_READY_IDS, type Loop2Subject } from "../loop2/rubric";
import { FIXED_NOW } from "./app";

const UNAVAILABLE = "Private dataset not found under data/private/ (git-ignored). Place the B6 exports there to run this suite.";

type CallMap = "Go" | "No-go" | "Hold";
const toCall = (r: Recommendation): CallMap => (r === "take_call" ? "Go" : r === "pass_for_consideration" ? "No-go" : "Hold");

export interface LoopSuites {
  suites: Suite[];
  /** Privacy-safe aggregate tables computed from this run (call after running the suites). */
  extras: (results: AssertionResult[]) => { title: string; markdown: string }[];
}

export function buildLoopSuites(): LoopSuites {
  const l1 = loadLoop1();
  const l2 = loadLoop2();
  const replayOut = new Map<string, { rec: Recommendation; call: CallMap }>();

  // ---------------------------------------------------------------- Loop 1: legacy system vs Riya
  const loop1Legacy: EvalCase<Loop1Record>[] = (l1 ?? []).map((r) => ({
    id: `L1-LEGACY-${r.id}`,
    version: 1,
    suite: "loop1-legacy",
    category: r.category,
    title: `Legacy screening call matches Riya (${r.id})`,
    input: `${r.id} · ${r.sector} · ${r.stage} · ${r.founderType} · system score ${r.system.score}`,
    expected: `System call equals Riya's final call (${r.riya.call}).`,
    run: () => r,
    assertions: [
      { id: "call-matches", description: "Legacy system call equals Riya's final call", kind: "hard", judge: "code", severity: "high", check: (x) => ({ pass: !x.overturned, actual: x.overturned ? `system ${x.system.call} → Riya ${x.riya.call} (${x.category})` : `both ${x.riya.call}` }) },
    ],
  }));

  // ---------------------------------------------------------------- Loop 1: replay THIS app on the summaries
  const loop1Replay: EvalCase<{ r: Loop1Record; rec: Recommendation; call: CallMap }>[] = (l1 ?? []).map((r) => ({
    id: `L1-REPLAY-${r.id}`,
    version: 1,
    suite: "loop1-replay",
    category: r.category,
    title: `This app's simulated recommendation vs Riya (${r.id})`,
    input: `${r.id} summary pasted as the only document (no form)${r.postApplicationInfo ? "; summary contains post-application information" : ""}`,
    expected: `Not 'take a call' when Riya said No-go; not 'pass' when Riya said Go. 'Request info' is a hold, not a miss.`,
    knownIssue: "Indicative only: the export holds one-paragraph summaries, not the deck and form this app is built to read.",
    run: async () => {
      const res = await processApplication({ applicationId: r.id, cycleId: "replay", actor: "riya", docs: [{ filename: "summary.txt", kind: "deck", method: "pasted", sha256: r.id, size: r.applicationSummary.length, pages: pagesFromPastedText(r.applicationSummary) }], thesis: THESIS_V1, criteria: CRITERIA_V1, portfolio: PORTFOLIO_V1, learningRules: [], now: FIXED_NOW, nameHint: r.startup });
      const out = { r, rec: res.evaluation.recommendation, call: toCall(res.evaluation.recommendation) };
      replayOut.set(r.id, { rec: out.rec, call: out.call });
      return out;
    },
    assertions: [
      { id: "no-false-advance", description: "Does not recommend a call where Riya's final call was No-go", kind: "hard", judge: "code", severity: "high", check: (o) => ({ pass: !(o.r.riya.call === "No-go" && o.call === "Go"), actual: `app ${o.rec} vs Riya ${o.r.riya.call}` }) },
      { id: "no-false-pass", description: "Does not recommend pass where Riya's final call was Go", kind: "hard", judge: "code", severity: "high", check: (o) => ({ pass: !(o.r.riya.call === "Go" && o.call === "No-go"), actual: `app ${o.rec} vs Riya ${o.r.riya.call}` }) },
    ],
  }));

  // ---------------------------------------------------------------- Loop 2
  const allNames = (l2 ?? []).flatMap((r) => [r.founderName, r.startup]);
  const subject = (r: Loop2Record, which: "draft" | "final"): Loop2Subject => ({
    text: which === "draft" ? r.systemDraft : r.riyaFinal,
    recordId: r.id,
    dateSent: r.dateSent,
    founderName: r.founderName,
    sector: r.sector,
    founderType: r.founderType,
    background: r.founderBackground,
    tractionFacts: r.tractionFacts,
    otherNames: [...new Set(allNames.filter((n) => n !== r.founderName && n !== r.startup))],
    startup: r.startup,
  });
  const clean = (l2 ?? []).filter((r) => r.use === "unique-clean");
  const sampled = new Set(clean.filter((_, i) => i % 10 === 0).map((r) => r.id)); // deterministic 10% human-audit sample (L7)

  const loop2Case = (r: Loop2Record, which: "draft" | "final", suite: string, knownIssue?: string): EvalCase<Loop2Subject> => ({
    id: `L2-${which === "draft" ? "DRAFT" : "FINAL"}-${r.id}`,
    version: 3, // v2: R1-facts ignores numbers in questions; v3: R2/R3 read spelled-out numbers (calibration fixes)
    suite,
    category: `${r.sector}${r.riyaEdit.edited ? " · edited" : " · unchanged"}`,
    title: `${which === "draft" ? "System draft" : "Riya's sent email"} ${r.id}`,
    input: `${r.id} · ${r.sector} · ${r.stage} · ${r.founderType} · sent ${r.dateSent}${which === "draft" ? ` · Riya ${r.riyaEdit.edited ? `edited (${r.riyaEdit.changedLines} changed lines)` : "sent unchanged"}` : ""}`,
    expected: "Meets Riya's first-email standard (rubric R1–R10 and critical checks C1–C3).",
    knownIssue,
    run: () => subject(r, which),
    assertions: loop2Assertions({ soft: suite !== "loop2-audit" && sampled.has(r.id) }),
  });

  const loop2Gold = clean.map((r) => loop2Case(r, "final", "loop2-gold"));
  const loop2Baseline = clean.map((r) => loop2Case(r, "draft", "loop2-baseline"));
  const loop2Audit = (l2 ?? []).filter((r) => r.use !== "unique-clean").map((r) => loop2Case(r, "final", "loop2-audit", r.exception ? `Exception (excluded from ordinary evaluation): ${r.exception}` : `Duplicate send of ${r.duplicateOf} (excluded from the unique count).`));

  // ---------------------------------------------------------------- Harness self-checks (constructed fixtures)
  // Fully synthetic: names, facts and wording written for this harness, not taken from any export row.
  const FIXTURE: Omit<Loop2Subject, "text"> = { recordId: "FIXTURE-1", dateSent: "2026-03-02", founderName: "Meera Kulkarni", sector: "Consumer brands", founderType: "software", background: "Ran category growth at a dairy cooperative for six years", tractionFacts: ["12,500 app installs", "58% of households reorder inside five weeks", "Contribution margin of 31%"], otherNames: ["Arjun Shah", "Crumbly"], startup: "Tidepool Foods" };
  const GOOD = "Hi Meera,\n\n58% of households reordering inside five weeks is unusual this early for a packaged-food brand.\n\nWhat share of those reorders comes from households whose first purchase was a free sample?\n\nCan you spare 30 minutes on Thursday 5 March or Tuesday 10 March, in the afternoon?\n\nRiya\nAll In Capital";
  const BAD = "Hello Arjun,\n\nImpressive launch at Crumbly! 900 outlets and 88% reorders is exactly the kind of traction we love.\n\nRing me on +91 9876543210. Can you spare 30 minutes on Saturday 28 February or Wednesday 4 March?\n\nBest regards,\nRiya";
  const harness: EvalCase<{ good: Loop2Subject; bad: Loop2Subject }>[] = [
    {
      id: "HARNESS-L2-01",
      version: 3, // v3: fully synthetic fixture (v2 still shared phrasing with export rows)
      suite: "harness",
      category: "break-it-on-purpose",
      title: "The rubric catches a deliberately broken email",
      input: "Constructed fictional email with invented numbers, the wrong founder and a competitor's name, a phone number, a past Saturday and a Wednesday slot, and empty praise.",
      expected: "Every critical check FAILS on the broken email (if one passes, the harness is not checking anything).",
      run: () => ({ good: { ...FIXTURE, text: GOOD }, bad: { ...FIXTURE, text: BAD } }),
      assertions: [
        { id: "catches-invented-facts", description: "R1-facts fails on invented numbers", kind: "hard", judge: "code", severity: "critical", check: (o) => { const r = checkFacts(o.bad, parseEmail(o.bad.text, o.bad.dateSent)); return { pass: !r.pass, actual: `rubric said: ${r.actual}` }; } },
        { id: "catches-wrong-identity", description: "R1-identity fails on the wrong founder/company", kind: "hard", judge: "code", severity: "critical", check: (o) => { const r = checkIdentity(o.bad, parseEmail(o.bad.text, o.bad.dateSent)); return { pass: !r.pass, actual: `rubric said: ${r.actual}` }; } },
        { id: "catches-bad-availability", description: "R7-availability fails on a past Saturday and a Wednesday", kind: "hard", judge: "code", severity: "critical", check: (o) => { const r = checkAvailability(parseEmail(o.bad.text, o.bad.dateSent)); return { pass: !r.pass, actual: `rubric said: ${r.actual}` }; } },
        { id: "catches-personal-data", description: "C3 fails on a phone number and another person's name", kind: "hard", judge: "code", severity: "critical", check: (o) => { const r = checkNoPersonalData(o.bad); return { pass: !r.pass, actual: `rubric said: ${r.actual}` }; } },
      ],
    },
    {
      id: "HARNESS-L2-02",
      version: 3, // v3: fully synthetic fixture (v2 still shared phrasing with export rows)
      suite: "harness",
      category: "not-over-strict",
      title: "The rubric passes a correct email",
      input: "Constructed synthetic email written to the house standard for the same fixture.",
      expected: "Every hard check passes (guards against an over-strict instrument).",
      run: () => ({ good: { ...FIXTURE, text: GOOD }, bad: { ...FIXTURE, text: BAD } }),
      assertions: [
        {
          id: "all-hard-pass",
          description: "All hard Loop 2 assertions pass on the good email",
          kind: "hard",
          judge: "code",
          severity: "critical",
          check: (o) => {
            const failed = loop2Assertions({ soft: false }).filter((a) => !a.check!(o.good).pass).map((a) => a.id);
            return { pass: failed.length === 0, actual: failed.length ? `failed: ${failed.join(", ")}` : "all hard checks pass" };
          },
        },
      ],
    },
  ];

  const suites: Suite[] = [
    { id: "harness", title: "Harness self-checks", kind: "calibration", description: "Break it on purpose / make sure it is not over-strict. A critical failure means the instrument is broken.", cases: harness as unknown as EvalCase<unknown>[] },
    { id: "loop2-gold", title: "Loop 2 — Riya's sent emails (calibration)", kind: "calibration", description: "Riya's own unique, non-exceptional sends must never trip a critical check; if they do, the rubric is wrong.", unavailable: l2 ? undefined : UNAVAILABLE, cases: loop2Gold as unknown as EvalCase<unknown>[] },
    { id: "loop2-baseline", title: "Loop 2 — legacy system drafts (baseline)", kind: "measurement", description: "The B6 baseline: the legacy system's drafts scored on the same rubric. Measures the old system; never gates this app.", unavailable: l2 ? undefined : UNAVAILABLE, cases: loop2Baseline as unknown as EvalCase<unknown>[] },
    { id: "loop2-audit", title: "Loop 2 — duplicates and exceptions (audit only)", kind: "measurement", description: "Excluded from ordinary evaluation; retained so their defects stay visible.", unavailable: l2 ? undefined : UNAVAILABLE, cases: loop2Audit as unknown as EvalCase<unknown>[] },
    { id: "loop1-legacy", title: "Loop 1 — legacy screening calls vs Riya", kind: "measurement", description: "Agreement of the legacy system's Go/No-go with Riya's final call.", unavailable: l1 ? undefined : UNAVAILABLE, cases: loop1Legacy as unknown as EvalCase<unknown>[] },
    { id: "loop1-replay", title: "Loop 1 — this app replayed on the export summaries", kind: "measurement", description: "Indicative only (summaries, not documents). Never gates.", unavailable: l1 ? undefined : UNAVAILABLE, cases: loop1Replay as unknown as EvalCase<unknown>[] },
  ];

  const extras = (results: AssertionResult[]) => {
    const out: { title: string; markdown: string }[] = [];
    if (l2) {
      // Rubric validity: does "send-ready" on the legacy draft predict what Riya did with it?
      const outcome = (r: Loop2Record) => {
        if (!r.riyaEdit.edited) return "unchanged";
        const a = parseEmail(r.systemDraft, r.dateSent), b = parseEmail(r.riyaFinal, r.dateSent);
        return JSON.stringify(a.body) === JSON.stringify(b.body) ? "style-only" : "rewritten";
      };
      const sendReady = (id: string) => SEND_READY_IDS.every((a) => results.find((x) => x.testId === `L2-DRAFT-${id}/${a}`)?.status === "pass");
      const m: Record<string, Record<string, number>> = { "send-ready": { unchanged: 0, "style-only": 0, rewritten: 0 }, "not send-ready": { unchanged: 0, "style-only": 0, rewritten: 0 } };
      for (const r of clean) m[sendReady(r.id) ? "send-ready" : "not send-ready"][outcome(r)]++;
      const ready = m["send-ready"].unchanged + m["send-ready"]["style-only"] + m["send-ready"].rewritten;
      out.push({
        title: "Loop 2 baseline — rubric vs what Riya actually did (unique, clean drafts)",
        markdown: [
          "| Rubric verdict on legacy draft | Riya sent unchanged | Riya changed greeting/sign-off only | Riya rewrote the body |",
          "|---|---|---|---|",
          ...Object.entries(m).map(([k, v]) => `| ${k} | ${v.unchanged} | ${v["style-only"]} | ${v.rewritten} |`),
          "",
          `Baseline send-ready rate (all critical + high hard checks pass): **${ready}/${clean.length} (${((ready / clean.length) * 100).toFixed(1)}%)**. Riya sent ${clean.filter((r) => !r.riyaEdit.edited).length}/${clean.length} unchanged.`,
        ].join("\n"),
      });
    }
    if (l1 && replayOut.size) {
      const t: Record<string, Record<CallMap, number>> = { Go: { Go: 0, Hold: 0, "No-go": 0 }, "No-go": { Go: 0, Hold: 0, "No-go": 0 } };
      for (const r of l1) { const o = replayOut.get(r.id); if (o) t[r.riya.call][o.call]++; }
      out.push({
        title: "Loop 1 replay — this app's simulated recommendation vs Riya's final call",
        markdown: ["| Riya's final call | app: take a call | app: request info (hold) | app: pass |", "|---|---|---|---|", ...(["Go", "No-go"] as const).map((k) => `| ${k} | ${t[k].Go} | ${t[k].Hold} | ${t[k]["No-go"]} |`), "", `**Read with care:** the app held ${t.Go.Hold + t["No-go"].Hold}/${l1.length} as "request info", so the replay's high pass rate mostly reflects deferral on thin inputs, not agreement. Indicative only: summaries are not the documents this app reads; two summaries include post-application information.`].join("\n"),
      });
    }
    return out;
  };

  return { suites, extras };
}
