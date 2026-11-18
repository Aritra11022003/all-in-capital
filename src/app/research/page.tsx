"use client";
import { useState } from "react";
import { useData, useRole } from "@/lib/store";
import { can } from "@/lib/domain/permissions";
import type { EvidenceClass, ResearchTask, Workstream } from "@/lib/shared/types";
import { EVIDENCE_CLASS_LABEL } from "@/lib/shared/labels";
import { SOURCE_TIERS, WORKSTREAM_LABEL } from "@/lib/engine/research/plan";
import { AppLink, ClassBadge } from "@/components/domain";
import { ResearchDialog } from "@/components/dialogs";
import { Badge, Callout, PageHeader, Panel, Stat, Tabs, inputCls } from "@/components/ui";

type T = "queue" | "ledger";

export default function ResearchPage() {
  const d = useData();
  const role = useRole();
  const [tab, setTab] = useState<T>("queue");
  const [ws, setWs] = useState<Workstream | "">("");
  const [st, setSt] = useState("");
  const [pr, setPr] = useState("");
  const [cls, setCls] = useState<EvidenceClass | "">("");
  const [q, setQ] = useState("");
  const [task, setTask] = useState<ResearchTask | null>(null);
  const appName = (id: string) => d.applications.find((a) => a.id === id)?.name ?? "—";
  const tasks = d.research.filter((t) => (!ws || t.workstream === ws) && (!st || t.status === st) && (!pr || t.priority === pr));
  const claims = d.claims.filter((c) => !c.text.startsWith("Deck slide") && (!cls || c.classification === cls) && (!q || `${c.text} ${c.excerpt} ${appName(c.applicationId)}`.toLowerCase().includes(q.toLowerCase())));
  const external = d.evidence.filter((e) => e.addedBy !== "system");
  return (
    <div>
      <PageHeader
        title="Research"
        subtitle="Ten research workstreams per application, each with a source-quality hierarchy. Generating a question is not research: a task is answered only when a reviewer records findings and the sources examined."
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Tasks" value={d.research.length} />
        <Stat label="High priority open" value={d.research.filter((t) => t.priority === "high" && t.status !== "answered").length} tone="risk" />
        <Stat label="Answered" value={d.research.filter((t) => t.status === "answered").length} tone="ok" />
        <Stat label="Failed / inaccessible" value={d.research.filter((t) => t.status === "inaccessible" || t.status === "blocked").length} tone="warn" />
        <Stat label="External sources logged" value={external.length} />
      </div>
      <div className="mb-3">
        <Callout tone="gold" title="No research provider configured">
          MockAIProvider cannot search the web and never claims to have verified anything. Riya researches manually and logs each source with its tier. A future provider must use an authorised search API, respect robots.txt and rate limits, and never bypass logins, paywalls or CAPTCHAs.
        </Callout>
      </div>
      <Tabs<T> value={tab} onChange={setTab} tabs={[{ id: "queue", label: "Research queue" }, { id: "ledger", label: "Evidence ledger" }]} />
      {tab === "queue" ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
          <Panel dense title={`${tasks.length} tasks`} actions={
            <div className="flex gap-1.5">
              <select aria-label="Workstream" className={`${inputCls} h-7 w-auto py-0`} value={ws} onChange={(e) => setWs(e.target.value as Workstream)}><option value="">All workstreams</option>{Object.entries(WORKSTREAM_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <select aria-label="Status" className={`${inputCls} h-7 w-auto py-0`} value={st} onChange={(e) => setSt(e.target.value)}><option value="">All statuses</option>{["not_started", "in_progress", "answered", "blocked", "inaccessible"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select>
              <select aria-label="Priority" className={`${inputCls} h-7 w-auto py-0`} value={pr} onChange={(e) => setPr(e.target.value)}><option value="">All priorities</option>{["high", "medium", "low"].map((s) => <option key={s}>{s}</option>)}</select>
            </div>
          }>
            <div className="max-h-[70vh] overflow-y-auto">
              <table className="dt">
                <thead><tr><th>Application</th><th>Workstream</th><th>Question</th><th>Priority</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {tasks.map((t) => (
                    <tr key={t.id}>
                      <td className="whitespace-nowrap"><AppLink id={t.applicationId} name={appName(t.applicationId)} /></td>
                      <td className="whitespace-nowrap">{WORKSTREAM_LABEL[t.workstream]}</td>
                      <td className="max-w-[460px] text-[12.5px]">{t.question}{t.findings && <div className="mt-0.5 text-teal-700">Finding: {t.findings}</div>}{t.failureReason && <div className="mt-0.5 text-warn-700">Failed: {t.failureReason}</div>}</td>
                      <td><Badge tone={t.priority === "high" ? "risk" : t.priority === "medium" ? "gold" : "neutral"}>{t.priority}</Badge></td>
                      <td><Badge tone={t.status === "answered" ? "ok" : t.status === "inaccessible" || t.status === "blocked" ? "warn" : "neutral"}>{t.status.replace("_", " ")}</Badge></td>
                      <td>{can(role, "research.update") && <button className="text-[12px] font-medium text-teal-700 hover:underline" onClick={() => setTask(t)}>Update</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel title="Source hierarchy">
            <ol className="space-y-1 text-[12.5px]">
              {SOURCE_TIERS.map((s) => <li key={s.tier}><span className="num mr-1.5 font-semibold text-gold-700">T{s.tier}</span>{s.name}</li>)}
            </ol>
            <p className="mt-2 text-[11.5px] text-muted">Directories and aggregators are leads only, never independent evidence.</p>
          </Panel>
        </div>
      ) : (
        <Panel dense title={`Evidence ledger — ${claims.length} claims`} actions={
          <div className="flex gap-1.5">
            <input aria-label="Search claims" className={`${inputCls} h-7 w-56`} placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
            <select aria-label="Classification" className={`${inputCls} h-7 w-auto py-0`} value={cls} onChange={(e) => setCls(e.target.value as EvidenceClass)}><option value="">All classifications</option>{Object.entries(EVIDENCE_CLASS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </div>
        }>
          <div className="max-h-[70vh] overflow-y-auto">
            <table className="dt">
              <thead><tr><th>Application</th><th>Claim</th><th>Source</th><th>Classification</th><th>Original text (stored)</th></tr></thead>
              <tbody>
                {claims.slice(0, 400).map((c) => (
                  <tr key={c.id}>
                    <td className="whitespace-nowrap"><AppLink id={c.applicationId} name={appName(c.applicationId)} /></td>
                    <td className="max-w-[300px]">{c.text}</td>
                    <td><span className="rounded bg-navy-50 px-1 font-mono text-[11px] text-navy-600">{c.sourceLabel}</span></td>
                    <td><ClassBadge c={c.classification} /></td>
                    <td className="max-w-[380px] font-mono text-[11px] text-muted">{c.excerpt.slice(0, 220)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {claims.length > 400 && <div className="p-2 text-[12px] text-muted">Showing first 400 — refine the search.</div>}
          </div>
        </Panel>
      )}
      <ResearchDialog key={task?.id} t={task} onClose={() => setTask(null)} />
    </div>
  );
}
