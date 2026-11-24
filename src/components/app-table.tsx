"use client";
import { ShieldAlert, ArrowLeftRight, Cpu } from "lucide-react";
import { useData } from "@/lib/store";
import { effectiveOverall, latestEvaluation, latestOverlap, type AppRec } from "@/lib/domain/workspace";
import { SECTOR_LABEL } from "@/lib/shared/labels";
import { hasDocumentGrant } from "@/lib/domain/permissions";
import { formatInr } from "@/lib/engine/evidence/metrics";
import { AppLink, DecisionBadge, ProcessingBadge, RecBadge, ScorePill } from "./domain";
import { Badge } from "./ui";

export function ApplicationsTable({ apps, compact }: { apps: AppRec[]; compact?: boolean }) {
  const d = useData();
  const rows = apps.map((a) => {
    const ev = latestEvaluation(d, a.id);
    const ov = latestOverlap(d, a.id);
    return { a, ev, ov, overall: ev ? effectiveOverall(d, ev) : null, conflicts: d.conflicts.filter((c) => c.applicationId === a.id && c.status === "open").length };
  });
  return (
    <div className="overflow-x-auto">
      <table className="dt">
        <thead>
          <tr>
            <th>Company</th>
            <th>Sector</th>
            {!compact && <th>Stage</th>}
            <th className="text-right">Raise</th>
            <th>Score</th>
            <th>Coverage</th>
            <th>Recommendation</th>
            <th>Flags</th>
            <th>Processing</th>
            <th>Decision</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ a, ev, ov, overall, conflicts }) => (
            <tr key={a.id}>
              <td className="min-w-[180px]">
                <AppLink id={a.id} name={a.name} />
                {!compact && a.oneLiner && <div className="line-clamp-1 max-w-[320px] text-[11.5px] text-muted">{a.oneLiner}</div>}
              </td>
              <td className="whitespace-nowrap">
                {SECTOR_LABEL[a.sectorKey]}
                {a.sectorSelected && !a.sectorSelected.toLowerCase().startsWith(SECTOR_LABEL[a.sectorKey].toLowerCase()) && <div className="text-[11px] text-faint">selected: {a.sectorSelected}</div>}
              </td>
              {!compact && <td className="whitespace-nowrap">{a.stage ?? <span className="text-faint">—</span>}</td>}
              <td className="num whitespace-nowrap text-right">{a.raiseInr ? formatInr(a.raiseInr).replace("INR ", "₹") : <span className="text-faint">—</span>}</td>
              <td>
                <ScorePill score={overall} />
              </td>
              <td className="num">{ev ? `${Math.round(ev.coverage * 100)}%` : "—"}</td>
              <td>{ev ? <RecBadge r={ev.recommendation} simulated={ev.simulated} /> : <span className="text-faint">—</span>}</td>
              <td>
                <div className="flex flex-wrap gap-1">
                  {conflicts > 0 && (
                    <Badge tone="risk" title="Open conflicts between documents">
                      <ArrowLeftRight size={11} /> {conflicts}
                    </Badge>
                  )}
                  {ov && ov.results.length > 0 && (
                    <Badge tone="risk" title={ov.results.map((r) => r.portfolioName).join(", ")}>
                      <ShieldAlert size={11} /> overlap
                    </Badge>
                  )}
                  {(a.tags.includes("deeptech") || a.sectorKey === "deeptech") && (
                    // P-C: Aditya is involved only once Kushal has shared this application with him.
                    <Badge tone="navy" title={hasDocumentGrant(a, "aditya") ? "Deeptech — shared with Aditya by Kushal" : "Deeptech — Kushal may share it with Aditya for technical review"}>
                      <Cpu size={11} /> {hasDocumentGrant(a, "aditya") ? "Aditya" : "Deeptech"}
                    </Badge>
                  )}
                  {a.errors.length > 0 && <Badge tone="warn">{a.errors.length} error</Badge>}
                </div>
              </td>
              <td>
                <ProcessingBadge s={a.processingStatus} />
              </td>
              <td>
                <DecisionBadge s={a.decisionStatus} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function sortByScore(d: ReturnType<typeof useData>, apps: AppRec[]) {
  return [...apps].sort((x, y) => {
    const ex = latestEvaluation(d, x.id);
    const ey = latestEvaluation(d, y.id);
    return (ey ? effectiveOverall(d, ey) ?? -1 : -2) - (ex ? effectiveOverall(d, ex) ?? -1 : -2);
  });
}
