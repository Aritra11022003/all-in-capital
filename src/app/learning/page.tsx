"use client";
import { useData, useRole, useStore } from "@/lib/store";
import { can, ROLE_INFO } from "@/lib/domain/permissions";
import { decideLearningRule } from "@/lib/domain/workspace";
import { CORRECTION_CATEGORY_LABEL, CRITERION_SHORT, SECTOR_LABEL } from "@/lib/shared/labels";
import { AppLink } from "@/components/domain";
import { Badge, Button, Callout, Empty, PageHeader, Panel, Stat } from "@/components/ui";

export default function LearningPage() {
  const d = useData();
  const role = useRole();
  const act = useStore((s) => s.act);
  const appName = (id: string) => d.applications.find((a) => a.id === id)?.name ?? "—";
  return (
    <div>
      <PageHeader
        title="Learning & Feedback"
        subtitle="Every human correction keeps the original AI assessment next to the revised one. A correction marked reusable becomes a proposed rule. It affects nothing until Kushal or Aditya approves it, and then only future evaluations, transparently labelled."
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Corrections" value={d.corrections.length} />
        <Stat label="Reusable" value={d.corrections.filter((c) => c.scope === "reusable").length} />
        <Stat label="Rules pending" value={d.learningRules.filter((r) => r.status === "proposed").length} tone="gold" />
        <Stat label="Rules approved" value={d.learningRules.filter((r) => r.status === "approved").length} tone="ok" />
      </div>
      <Panel dense title="Learning rules">
        {d.learningRules.length ? (
          <table className="dt">
            <thead><tr><th>Rule</th><th>Criterion</th><th>Adjustment</th><th>Applies when</th><th>Reason (from correction)</th><th>Status</th><th /></tr></thead>
            <tbody>
              {d.learningRules.map((r) => (
                <tr key={r.id}>
                  <td className="font-mono text-[12px]">{r.id} v{r.version}</td>
                  <td>{CRITERION_SHORT[r.criterion]}</td>
                  <td className="num font-semibold">{r.adjustment > 0 ? "+" : ""}{r.adjustment}</td>
                  <td className="text-[12px]">{r.condition.sectors.map((s) => SECTOR_LABEL[s]).join(", ") || "any sector"}{r.condition.keywords.length ? ` · mentions ${r.condition.keywords.join(" / ")}` : ""}</td>
                  <td className="max-w-[340px] text-[12.5px]">{r.note}<div className="text-[11px] text-faint">proposed by {ROLE_INFO[r.proposedBy].name} · {r.proposedAt.slice(0, 10)}</div></td>
                  <td><Badge tone={r.status === "approved" ? "ok" : r.status === "rejected" ? "neutral" : "gold"}>{r.status}</Badge>{r.decidedBy && <div className="text-[11px] text-faint">{ROLE_INFO[r.decidedBy].name}</div>}</td>
                  <td className="whitespace-nowrap">
                    {r.status === "proposed" && can(role, "learning.approve") && (
                      <span className="flex gap-1.5">
                        <Button size="sm" variant="gold" onClick={() => act((w, x) => decideLearningRule(w, x, r.id, "approved"), `${r.id} approved — applies to future evaluations.`)}>Approve</Button>
                        <Button size="sm" onClick={() => act((w, x) => decideLearningRule(w, x, r.id, "rejected"), `${r.id} rejected.`)}>Reject</Button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-4"><Empty title="No rules proposed yet">Correct a score on any application&apos;s Evaluation tab and mark it reusable.</Empty></div>
        )}
      </Panel>
      <div className="mt-4">
        <Panel dense title="Correction history">
          {d.corrections.length ? (
            <table className="dt">
              <thead><tr><th>When</th><th>Application</th><th>Criterion</th><th>Original (AI)</th><th>Revised</th><th>Reason</th><th>Category</th><th>Scope</th><th>Rubric / model</th></tr></thead>
              <tbody>
                {[...d.corrections].reverse().map((c) => (
                  <tr key={c.id}>
                    <td className="num whitespace-nowrap text-[12px]">{c.at.slice(0, 16).replace("T", " ")}<div className="text-faint">{ROLE_INFO[c.reviewer].name}</div></td>
                    <td><AppLink id={c.applicationId} name={appName(c.applicationId)} /></td>
                    <td>{CRITERION_SHORT[c.criterion]}</td>
                    <td className="num">{c.original.score ?? "n/a"} · {c.original.evidenceState}</td>
                    <td className="num font-semibold">{c.revised.score ?? "n/a"} · {c.revised.evidenceState}</td>
                    <td className="max-w-[300px] text-[12.5px]">{c.reason}</td>
                    <td className="text-[12px]">{CORRECTION_CATEGORY_LABEL[c.category]}</td>
                    <td><Badge tone={c.scope === "reusable" ? "gold" : "neutral"}>{c.scope.replace("_", " ")}</Badge>{c.learningRuleId && <div className="font-mono text-[11px]">{c.learningRuleId} · {c.approval}</div>}</td>
                    <td className="font-mono text-[11px] text-muted">{c.criteriaVersionId} · {c.provider}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-4"><Empty title="No corrections yet" /></div>
          )}
        </Panel>
      </div>
      <div className="mt-4">
        <Callout tone="navy">Kushal: &quot;When Riya or I correct a score, I don&apos;t want to make that same correction again in three months on a similar company.&quot; The approval step stops one-off judgements from silently becoming policy (and keeps Kushal&apos;s caution about checklists founders learn to pass).</Callout>
      </div>
    </div>
  );
}
