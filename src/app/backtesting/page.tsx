"use client";
import { useMemo, useState } from "react";
import { HINDSIGHT_BLOCKLIST, IN_SAMPLE_WARNING, MEMOS, runBacktest, stageConfound, summarise, type BacktestMode, type DisagreementCause } from "@/lib/engine/backtest/backtest";
import { Badge, Callout, PageHeader, Panel, Stat, Tabs, cx } from "@/components/ui";

const CAUSE: Record<DisagreementCause, string> = {
  model_reasoning_error: "Model reasoning error",
  extraction_error: "Extraction error",
  missing_evidence: "Missing evidence",
  scoring_calibration: "Scoring calibration",
  thesis_ambiguity: "Thesis ambiguity",
  historical_partner_disagreement: "Historical partner disagreement",
  unresolved: "Unresolved",
};

export default function BacktestingPage() {
  const [mode, setMode] = useState<BacktestMode>("retrospective");
  const [open, setOpen] = useState<number | null>(null);
  const rows = useMemo(() => runBacktest(mode), [mode]);
  const s = summarise(rows);
  const confound = stageConfound();
  return (
    <div>
      <PageHeader
        title="Historical backtesting"
        subtitle="Kushal: 'Run it against those and tell me how often it disagrees with us. When it does, tell me whether we were wrong or it was.' Twelve memos (6 invested, 6 passed). Agreement is reported separately from reasoning quality."
      />
      <Tabs<BacktestMode>
        value={mode}
        onChange={(m) => { setMode(m); setOpen(null); }}
        tabs={[
          { id: "retrospective", label: "Retrospective (memo-based)" },
          { id: "point_in_time", label: "Approximate point-in-time replay" },
        ]}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Agreement" value={`${s.agree}/${s.n}`} hint={`${Math.round(s.rate * 100)}% — not predictive accuracy`} tone="gold" />
        <Stat label="Undetermined" value={s.undetermined} hint="system would not commit" />
        <Stat label="Would have invested, fund passed" value={s.falseInvest} />
        <Stat label="Would have passed, fund invested" value={s.falsePass} />
        <Stat label="Sample size" value={s.n} hint="too small to claim accuracy" tone="risk" />
      </div>
      <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Callout tone="risk" title="In-sample warning">{IN_SAMPLE_WARNING}</Callout>
        <Callout tone="warn" title="Label artefact found">{confound}</Callout>
        <Callout tone="navy" title={mode === "retrospective" ? "What this mode reads" : "Hindsight guard"}>
          {mode === "retrospective"
            ? "What the company does, the partners' founder assessment and the risks. The 'Why we invested/passed' paragraph is never read. Founder assessments already contain the partners' judgement, so agreement here mostly tests whether the rubric is consistent with how the partners reason."
            : "Memos are undated, so strict replay is impossible. This mode reads only application-time facts (what it does, sector, stage, source). Founder assessments, diligence risks, decision rationale and all later commentary are excluded."}
        </Callout>
      </div>
      <Panel dense title="Deal-by-deal">
        <table className="dt">
          <thead><tr><th>#</th><th>Company</th><th>Sector</th><th>Fund decision</th><th>System call</th><th>Score</th><th>Agreement</th><th>Likely cause of disagreement</th></tr></thead>
          <tbody>
            {rows.map((r) => [
              <tr key={r.memo} className="cursor-pointer" onClick={() => setOpen(open === r.memo ? null : r.memo)}>
                <td className="num">{r.memo}</td>
                <td className="font-medium">{r.name}</td>
                <td className="text-[12px]">{r.sector}</td>
                <td><Badge tone={r.actual === "invested" ? "teal" : "neutral"}>{r.actual}</Badge></td>
                <td><Badge tone={r.modelCall === "invest" ? "teal" : r.modelCall === "pass" ? "neutral" : "gold"}>{r.modelCall}</Badge></td>
                <td className="num">{r.score}</td>
                <td>{r.agrees ? <Badge tone="ok">agrees</Badge> : <Badge tone="risk">disagrees</Badge>}</td>
                <td className="text-[12.5px]">{r.suggestedCause ? CAUSE[r.suggestedCause] : "—"}</td>
              </tr>,
              open === r.memo && (
                <tr key={r.memo + "x"}>
                  <td />
                  <td colSpan={7} className="bg-paper">
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                      <div>
                        <div className="mb-1 text-[11px] font-semibold uppercase text-muted">Signals used</div>
                        <ul className="space-y-0.5 text-[12.5px]">{r.signals.map((x, i) => <li key={i} className={cx(x.effect > 0 ? "text-teal-700" : x.effect < 0 ? "text-risk-700" : "")}>{x.effect > 0 ? "+" : ""}{x.effect} {x.text}</li>)}</ul>
                        {r.causeNote && <p className="mt-2 text-[12.5px]"><b>Why it disagrees:</b> {r.causeNote}</p>}
                      </div>
                      <div className="text-[12px]">
                        <div className="mb-1 text-[11px] font-semibold uppercase text-muted">Inputs used</div>
                        <div>{r.inputsUsed.join(" · ")}</div>
                        <div className="mb-1 mt-2 text-[11px] font-semibold uppercase text-muted">Excluded (leakage guard)</div>
                        <div>{r.inputsExcluded.join(" · ")}</div>
                        <div className="mt-2 text-faint">Source: Deal Memos p{MEMOS.find((m) => m.n === r.memo)?.page}</div>
                      </div>
                    </div>
                  </td>
                </tr>
              ),
            ])}
          </tbody>
        </table>
      </Panel>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Blocked hindsight (never used in replay)">
          <ul className="list-disc space-y-1 pl-4 text-[12.5px]">{HINDSIGHT_BLOCKLIST.map((h) => <li key={h.text}>{h.text} <span className="text-faint">({h.source})</span></li>)}</ul>
          <p className="mt-2 text-[12px] text-muted">Ledgerly (Meeting 5) is not in the memo pack and is not backtested.</p>
        </Panel>
        <Panel title="Reading the result">
          <ul className="list-disc space-y-1 pl-4 text-[12.5px]">
            <li><b>Point-in-time</b> mostly comes out <i>undetermined</i>. From application facts alone the system can only rule out category misfits (Coinlane). That is the main finding: these decisions turned on founder behaviour observed in calls (&quot;the founder is most of the investment&quot;), which no deck screen can replace.</li>
            <li><b>Retrospective</b> disagreements are calibration questions for the partners, not errors to train away. The system is not tuned to imitate past decisions.</li>
            <li>Before it touches a real decision, agree in advance with Kushal on the acceptable disagreement rate and on which disagreement types block use (Kushal: &quot;exactly how far he can trust it and exactly where it breaks&quot;).</li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}
