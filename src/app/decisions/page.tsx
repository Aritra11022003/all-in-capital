"use client";
import Link from "next/link";
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useData, useRole } from "@/lib/store";
import { can, ROLE_INFO } from "@/lib/domain/permissions";
import { effectiveOverall, latestEvaluation, latestOverlap } from "@/lib/domain/workspace";
import { DECISION_TYPE_LABEL, PASS_REASON_LABEL, SECTOR_LABEL } from "@/lib/shared/labels";
import { AppLink, DecisionBadge, FlagRow, RecBadge, ScorePill } from "@/components/domain";
import { DecisionForm } from "@/components/dialogs";
import { Badge, Callout, Empty, PageHeader, Panel, Tabs } from "@/components/ui";

type F = "awaiting" | "undecided" | "all" | "decided";

export default function DecisionRoom() {
  const d = useData();
  const role = useRole();
  const [f, setF] = useState<F>("awaiting");
  const [sel, setSel] = useState<string | null>(null);
  const decided = ["call_approved", "passed_by_partner", "on_hold", "information_requested"];
  const apps = d.applications.filter((a) => (f === "awaiting" ? a.decisionStatus === "awaiting_partner_review" : f === "undecided" ? !decided.includes(a.decisionStatus) : f === "decided" ? decided.includes(a.decisionStatus) : true));
  const cur = d.applications.find((a) => a.id === sel) ?? apps[0];
  const ev = cur ? latestEvaluation(d, cur.id) : undefined;
  const ov = cur ? latestOverlap(d, cur.id) : undefined;
  const unseen = d.applications.filter((a) => !a.viewedBy.includes("kushal")).length;
  return (
    <div>
      <PageHeader
        title="Partner decision room"
        subtitle="Kushal sees every applicant before anything is decided. Nobody is auto-rejected or auto-advanced. The system can recommend; only a human decision changes an outcome."
      />
      {unseen > 0 && <div className="mb-3"><Callout tone="gold">{unseen} application(s) not yet opened by Kushal. A decision can only be recorded after Kushal has opened the application.</Callout></div>}
      <Tabs<F>
        value={f}
        onChange={(x) => { setF(x); setSel(null); }}
        tabs={[
          { id: "awaiting", label: `Awaiting partner review (${d.applications.filter((a) => a.decisionStatus === "awaiting_partner_review").length})` },
          { id: "undecided", label: "All undecided" },
          { id: "decided", label: "Decided" },
          { id: "all", label: "All" },
        ]}
      />
      {!apps.length ? (
        <Empty title="Nothing in this queue">Riya sends applications here with &quot;Send to partner review&quot;. Kushal can also decide from the &quot;All undecided&quot; tab.</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[380px_1fr]">
          <Panel dense title="Queue">
            <ul>
              {apps.map((a) => {
                const e = latestEvaluation(d, a.id);
                return (
                  <li key={a.id}>
                    <button onClick={() => setSel(a.id)} className={`flex w-full items-center justify-between gap-2 border-b border-line px-3 py-2 text-left ${cur?.id === a.id ? "bg-navy-50" : "hover:bg-paper"}`}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 font-medium">{a.viewedBy.includes("kushal") ? <Eye size={12} className="text-teal-600" /> : <EyeOff size={12} className="text-gold-600" />}{a.name}</div>
                        <div className="truncate text-[11.5px] text-muted">{SECTOR_LABEL[a.sectorKey]} · {a.stage ?? "stage n/a"}</div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <ScorePill score={e ? effectiveOverall(d, e) : null} size="sm" />
                        <DecisionBadge s={a.decisionStatus} />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Panel>
          {cur && (
            <div className="space-y-4">
              <Panel title={<span>{cur.name}</span>} actions={<Link href={`/applications/${cur.id}`} className="text-[12px] font-medium text-teal-700 hover:underline">Open full application →</Link>}>
                <p className="mb-2 text-muted">{cur.oneLiner}</p>
                {ev ? (
                  <>
                    <div className="mb-2 flex flex-wrap items-center gap-2"><RecBadge r={ev.recommendation} /><ScorePill score={effectiveOverall(d, ev)} /><span className="text-[12px] text-faint">{Math.round(ev.coverage * 100)}% criteria scored</span></div>
                    <ul className="mb-2 list-disc pl-4 text-[12.5px]">{ev.recommendationReasons.map((r) => <li key={r}>{r}</li>)}</ul>
                    <div className="space-y-1">{ev.flags.filter((x) => x.level !== "info").map((x) => <FlagRow key={x.text} level={x.level} text={x.text} />)}</div>
                    {ov && ov.results.length > 0 && <div className="mt-2"><Callout tone="risk">Possible portfolio overlap: {ov.results.map((r) => r.portfolioName).join(", ")}. Default is no unless both founders are told (Meeting 4). Consider Hold.</Callout></div>}
                  </>
                ) : (
                  <Callout tone="warn">No evaluation — processing status: {cur.processingStatus.replace(/_/g, " ")}. A technical failure is not a pass.</Callout>
                )}
                {cur.comments.length > 0 && (
                  <div className="mt-3 border-t border-line pt-2">
                    <div className="mb-1 text-[11px] font-semibold uppercase text-muted">Team comments</div>
                    {cur.comments.slice(-4).map((c) => <div key={c.id} className="text-[12.5px]"><b>{ROLE_INFO[c.by].name}:</b> {c.text}</div>)}
                  </div>
                )}
              </Panel>
              <Panel title="Record outcome">
                {can(role, "decision.record") ? (
                  cur.viewedBy.includes("kushal") ? (
                    <DecisionForm key={cur.id} appId={cur.id} />
                  ) : (
                    <Callout tone="gold">Open the full application first. Kushal sees every applicant before an outcome is recorded.</Callout>
                  )
                ) : (
                  <Callout tone="navy">Viewing as {ROLE_INFO[role].name}. Only Kushal can record outcomes; switch role in the top bar to demonstrate.</Callout>
                )}
                {d.decisions.filter((x) => x.applicationId === cur.id).map((x) => (
                  <div key={x.id} className="mt-2 rounded border border-line px-2 py-1 text-[12px]">
                    <Badge tone="navy">{DECISION_TYPE_LABEL[x.decision]}</Badge> {x.passReason && PASS_REASON_LABEL[x.passReason]} — {x.rationale} <span className="text-faint">({ROLE_INFO[x.decidedBy].name}, {x.decidedAt.slice(0, 16).replace("T", " ")})</span>
                  </div>
                ))}
              </Panel>
            </div>
          )}
        </div>
      )}
      <div className="mt-4">
        <Panel dense title="All applicants — outcome visibility">
          <table className="dt">
            <thead><tr><th>Company</th><th>Recommendation</th><th>Decision</th><th>Seen by Kushal</th></tr></thead>
            <tbody>
              {d.applications.map((a) => {
                const e = latestEvaluation(d, a.id);
                return (
                  <tr key={a.id}>
                    <td><AppLink id={a.id} name={a.name} /></td>
                    <td>{e ? <RecBadge r={e.recommendation} /> : "—"}</td>
                    <td><DecisionBadge s={a.decisionStatus} /></td>
                    <td>{a.viewedBy.includes("kushal") ? <Badge tone="ok">yes</Badge> : <Badge tone="gold">not yet</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}
