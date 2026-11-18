"use client";
import Link from "next/link";
import { Plus, Gavel, FlaskConical } from "lucide-react";
import { useData, useRole, useStore } from "@/lib/store";
import { latestEvaluation, qualityIndicators } from "@/lib/domain/workspace";
import { PROVIDERS } from "@/lib/engine/evaluation/provider";
import { ROLE_INFO } from "@/lib/domain/permissions";
import { ApplicationsTable, sortByScore } from "@/components/app-table";
import { Badge, Button, Callout, Empty, PageHeader, Panel, Stat } from "@/components/ui";

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);

export default function Overview() {
  const d = useData();
  const role = useRole();
  const draining = useStore((s) => s.draining);
  const apps = d.applications;
  const evs = apps.map((a) => latestEvaluation(d, a.id)).filter(Boolean);
  const q = qualityIndicators(d);
  const awaiting = apps.filter((a) => a.decisionStatus === "awaiting_partner_review").length;
  const calls = evs.filter((e) => e!.recommendation === "take_call").length;
  const problems = apps.filter((a) => a.processingStatus === "failed" || a.processingStatus === "needs_attention").length;
  const openResearch = d.research.filter((r) => r.status !== "answered").length;

  return (
    <div>
      <PageHeader
        kicker={`${ROLE_INFO[role].name} · ${ROLE_INFO[role].title}`}
        title="Weekly intake overview"
        subtitle="Every application in the current batch, scored criterion by criterion against the proposed thesis, with the source behind each claim and the gaps named. Recommendations are simulated and never final."
        actions={
          <>
            <Link href="/decisions">
              <Button>
                <Gavel size={14} /> Decision room {awaiting > 0 && <Badge tone="gold">{awaiting}</Badge>}
              </Button>
            </Link>
            <Link href="/applications/new">
              <Button variant="primary">
                <Plus size={14} /> New intake
              </Button>
            </Link>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Stat label="Applications" value={apps.length} hint={`${new Set(apps.map((a) => a.batchId)).size} batch(es)`} />
        <Stat label="Ready for review" value={apps.filter((a) => a.processingStatus === "ready_for_review").length} />
        <Stat label="Suggested calls" value={calls} tone="gold" hint="simulated recommendation" />
        <Stat label="Awaiting partner" value={awaiting} />
        <Stat label="Open conflicts" value={q.conflictsOpen} tone={q.conflictsOpen ? "risk" : undefined} hint={`${q.conflictsDetected} detected`} />
        <Stat label="Research open" value={openResearch} hint="no provider configured" />
        <Stat label="Failed / attention" value={problems} tone={problems ? "warn" : "ok"} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Panel title="Batch triage — ranked by overall score" dense actions={draining ? <Badge tone="navy">processing…</Badge> : undefined}>
          {apps.length ? (
            <ApplicationsTable apps={sortByScore(d, apps)} compact />
          ) : (
            <div className="p-4">
              <Empty title="No applications yet">
                Upload this week&apos;s decks and forms from <Link className="text-teal-700 underline" href="/applications/new">New intake</Link>. The case batch can be restored from Administration.
              </Empty>
            </div>
          )}
        </Panel>
        <div className="min-w-0 space-y-4">
          <Panel title="Quality indicators">
            <table className="w-full text-[12.5px]">
              <tbody>
                {[
                  ["Extraction coverage (core fields)", pct(q.extractionCoverage)],
                  ["Evidence traceability (signals cited)", pct(q.evidenceTraceability)],
                  ["Source verification rate", pct(q.sourceVerificationRate)],
                  ["Conflicts detected / open", `${q.conflictsDetected} / ${q.conflictsOpen}`],
                  ["Critical unknowns", String(q.criticalUnknowns)],
                  ["Human correction rate", pct(q.humanCorrectionRate)],
                  ["Recommendation agreement", q.decisionsRecorded ? `${pct(q.recommendationAgreement)} (n=${q.decisionsRecorded})` : "no decisions yet"],
                  ["Avg processing time", q.avgProcessingMs === null ? "—" : `${Math.round(q.avgProcessingMs)} ms`],
                  ["Failure rate", pct(q.failureRate)],
                ].map(([k, v]) => (
                  <tr key={k} className="border-b border-line last:border-0">
                    <td className="py-1.5 text-muted">{k}</td>
                    <td className="num py-1.5 text-right font-medium">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-faint">Source verification is 0% until a reviewer logs independent evidence — nothing is auto-verified.</p>
          </Panel>
          <Panel title="AI providers">
            <ul className="space-y-2">
              {PROVIDERS.map((p) => {
                const s = p.status();
                return (
                  <li key={s.id} className="text-[12.5px]">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 font-medium">
                        {s.simulated && <FlaskConical size={12} className="text-gold-600" />}
                        {s.label}
                      </span>
                      <Badge tone={s.state === "active" ? "teal" : "neutral"}>{s.state.replace("_", " ")}</Badge>
                    </div>
                    <div className="text-[11.5px] text-muted">{s.detail}</div>
                  </li>
                );
              })}
            </ul>
          </Panel>
          <Callout tone="gold" title="Associate time">
            First-pass triage takes Riya ~30 minutes per application (case brief). This batch of {apps.length} ≈ {((apps.length * 30) / 60).toFixed(1)} hours manually. The platform does the first read; Riya&apos;s time goes to research and verification.
          </Callout>
        </div>
      </div>
    </div>
  );
}
