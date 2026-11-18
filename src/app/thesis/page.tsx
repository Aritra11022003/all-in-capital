"use client";
import { useState } from "react";
import { useData, useRole, useStore } from "@/lib/store";
import { can, ROLE_INFO } from "@/lib/domain/permissions";
import { activeCriteria, activeThesis, approveCriteriaVersion, proposeCriteriaVersion } from "@/lib/domain/workspace";
import type { CriterionId } from "@/lib/shared/types";
import { SECTOR_LABEL } from "@/lib/shared/labels";
import { Badge, Button, Callout, Field, PageHeader, Panel, inputCls } from "@/components/ui";

export default function ThesisPage() {
  const d = useData();
  const role = useRole();
  const act = useStore((s) => s.act);
  const thesis = activeThesis(d);
  const crit = activeCriteria(d);
  const [weights, setWeights] = useState<Record<string, number>>(Object.fromEntries(crit.criteria.map((c) => [c.id, c.weight])));
  const [note, setNote] = useState("");
  return (
    <div>
      <PageHeader
        title="Thesis & Scoring"
        subtitle="Two thesis layers are kept apart on purpose: what the fund says publicly, and what its past decisions reveal. The rubric is proposed, not approved fund policy. Changing it needs Kushal's approval and creates a new version; past evaluations keep the version they used."
      />
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Stated / public thesis" actions={<Badge tone="gold">{thesis.id} · {thesis.status}</Badge>}>
          <p className="text-[14px] font-medium text-navy-900">{thesis.stated.text}</p>
          <div className="mt-2 flex flex-wrap gap-1">{thesis.stated.sectors.map((s) => <Badge key={s} tone="teal">{SECTOR_LABEL[s]}</Badge>)}<Badge tone="navy">{thesis.stated.stage}</Badge></div>
          <p className="mt-2 text-[12px] text-muted">{thesis.stated.source}</p>
          <div className="mt-3">
            <Callout tone="warn">Not given in the case: precise criteria definitions, ownership target, anti-thesis exclusions, full portfolio. Missing public research on these is a named gap, not something the system fills in.</Callout>
          </div>
        </Panel>
        <Panel title="Where the two layers disagree">
          <ul className="list-disc space-y-1.5 pl-4 text-[12.5px]">
            <li><b>Rural credit (Jai Kisan).</b> &quot;Fintech&quot; by label, but a partner asked whether the thesis stretched to it. Founder behaviour decided it, not the sector (Meeting 2).</li>
            <li><b>Credit risk.</b> Kushal declined to write the risk-ownership rule down (&quot;written rules turn into checklists&quot;). The system shows it as a revealed pattern (RP-1), never as a hard filter.</li>
            <li><b>Drift (RP-9).</b> Riya sees recent yeses skew to commerce infrastructure and consumer plays with repeat. Aditya thinks the pipeline changed. It is unresolved, so it is not scored. Kushal: &quot;tell me which one you used and why&quot; — every evaluation names its thesis version.</li>
            <li><b>Stage labels.</b> All past investments are &quot;early round&quot; yet the stated thesis is pre-seed. See Backtesting.</li>
          </ul>
        </Panel>
      </div>
      <Panel title="Revealed thesis — patterns in past decisions" dense>
        <table className="dt">
          <thead><tr><th>ID</th><th>Pattern</th><th>Description</th><th>Citations</th><th>Status</th></tr></thead>
          <tbody>
            {thesis.revealed.map((r) => (
              <tr key={r.id}>
                <td className="font-mono text-[11.5px]">{r.id}</td>
                <td className="font-medium">{r.title}</td>
                <td className="max-w-[460px] text-[12.5px]">{r.description}</td>
                <td className="text-[11.5px] text-muted">{r.citations.join("; ")}</td>
                <td><Badge tone={r.status === "contested" ? "warn" : "navy"}>{r.status}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel title={`Rubric — ${crit.id} (${crit.status})`} dense>
          <table className="dt">
            <thead><tr><th>Criterion</th><th>Definition</th><th>Missing-metric policy</th><th className="text-right">Weight</th></tr></thead>
            <tbody>
              {crit.criteria.map((c) => (
                <tr key={c.id}>
                  <td className="whitespace-nowrap font-medium">{c.name}</td>
                  <td className="max-w-[420px] text-[12.5px]">{c.definition}</td>
                  <td className="text-[12px] text-muted">{c.missingMetricPolicy.length ? c.missingMetricPolicy.map((p) => `${SECTOR_LABEL[p.sector]} / ${p.metric}: −${p.penalty}. ${p.citation}`).join(" ") : "None — unknown is not penalised"}</td>
                  <td className="text-right">
                    <input aria-label={`Weight ${c.name}`} type="number" min={0} max={3} step={0.25} disabled={!can(role, "criteria.propose")} className={`${inputCls} num w-20 text-right`} value={weights[c.id]} onChange={(e) => setWeights({ ...weights, [c.id]: Number(e.target.value) })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-end gap-2 border-t border-line p-3">
            <div className="flex-1">
              <Field label="Proposed change (required)"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Weight founder quality higher after calibration on 12 memos" /></Field>
            </div>
            <Button variant="primary" className="mb-2.5" disabled={!can(role, "criteria.propose")} onClick={() => !act((w, r) => { proposeCriteriaVersion(w, r, weights as Record<CriterionId, number>, note); }, "New rubric version proposed. Kushal must approve it before it is used.") && setNote("")}>Propose new version</Button>
          </div>
        </Panel>
        <Panel title="Rubric versions">
          <ul className="space-y-2">
            {[...d.criteriaVersions].reverse().map((v) => (
              <li key={v.id} className="rounded-md border border-line px-2.5 py-2 text-[12.5px]">
                <div className="flex items-center justify-between">
                  <b>{v.id}</b>
                  <Badge tone={v.status === "approved" ? "ok" : v.status === "proposed" ? "gold" : "neutral"}>{v.status}</Badge>
                </div>
                <div className="text-muted">{v.changeNote}</div>
                <div className="text-[11px] text-faint">by {v.createdBy === "system" ? "system" : ROLE_INFO[v.createdBy].name} · {v.createdAt.slice(0, 10)}{v.approvedBy ? ` · approved by ${ROLE_INFO[v.approvedBy].name}` : ""}</div>
                {v.status === "proposed" && can(role, "criteria.approve") && (
                  <Button size="sm" className="mt-1.5" variant="gold" onClick={() => act((w, r) => approveCriteriaVersion(w, r, v.id), `${v.id} approved. Use Re-evaluate on an application to apply it.`)}>Approve as fund policy</Button>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11.5px] text-muted">While no version is approved, evaluations use v1 and say it is proposed. Individual corrections never change the rubric automatically.</p>
        </Panel>
      </div>
    </div>
  );
}
