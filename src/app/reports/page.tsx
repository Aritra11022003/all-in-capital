"use client";
import Link from "next/link";
import { useData } from "@/lib/store";
import { effectiveOverall, latestEvaluation } from "@/lib/domain/workspace";
import { DecisionBadge, RecBadge, ScorePill } from "@/components/domain";
import { Empty, PageHeader, Panel } from "@/components/ui";

export default function ReportsPage() {
  const d = useData();
  const rows = d.applications.map((a) => ({ a, ev: latestEvaluation(d, a.id) })).filter((x) => x.ev);
  return (
    <div>
      <PageHeader title="Investment reports" subtitle="A 17-section assessment for every evaluated application. Reports from the demo provider are labelled simulated. Print to PDF or export Markdown from the report page." />
      <Panel dense>
        {rows.length ? (
          <table className="dt">
            <thead><tr><th>Company</th><th>Score</th><th>Suggested next action</th><th>Decision</th><th>Generated from</th><th /></tr></thead>
            <tbody>
              {rows.map(({ a, ev }) => (
                <tr key={a.id}>
                  <td className="font-medium">{a.name}</td>
                  <td><ScorePill score={effectiveOverall(d, ev!)} /></td>
                  <td><RecBadge r={ev!.recommendation} /></td>
                  <td><DecisionBadge s={a.decisionStatus} /></td>
                  <td className="font-mono text-[11px] text-muted">{ev!.providerLabel} · {ev!.criteriaVersionId}</td>
                  <td className="text-right"><Link className="text-[12px] font-medium text-teal-700 hover:underline" href={`/reports/${a.id}`}>Open report →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-4"><Empty title="No evaluated applications yet" /></div>
        )}
      </Panel>
    </div>
  );
}
