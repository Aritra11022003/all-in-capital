"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, FileText, Lock, Pencil, RefreshCw, Send, ShieldAlert, Users, BookMarked, Plus, Check, RotateCcw } from "lucide-react";
import { useData, useRole, useStore } from "@/lib/store";
import { can, canViewDocuments, ROLE_INFO } from "@/lib/domain/permissions";
import { comment, confirmField, editField, effectiveAssessment, effectiveOverall, grantDocumentAccess, latestEvaluation, latestOverlap, markViewed, reviewOverlap, revokeDocumentAccess, screeningFor, submitForReview } from "@/lib/domain/workspace";
import { spanLocation, type ScreenedSpan } from "@/lib/engine/safety/untrusted";
import type { Conflict, CriterionId, Evaluation, ResearchTask } from "@/lib/shared/types";
import { CRITERION_SHORT, DECISION_TYPE_LABEL, PASS_REASON_LABEL, RECOMMENDATION_LABEL, RELATIONSHIP_LABEL, SECTOR_LABEL } from "@/lib/shared/labels";
import { formatInr } from "@/lib/engine/evidence/metrics";
import { WORKSTREAM_LABEL } from "@/lib/engine/research/plan";
import { FIELD_DISPLAY } from "@/lib/engine/extraction/form";
import { ClassBadge, ConfidenceBadge, ConflictCard, DecisionBadge, EvidenceBadge, FlagRow, ProcessingBadge, RecBadge, ScorePill, SignalList, SimulatedBanner } from "@/components/domain";
import { ConflictDialog, CorrectionDialog, DecisionForm, EvidenceDialog, ReopenDialog, ResearchDialog } from "@/components/dialogs";
import { Badge, Button, Callout, Empty, KV, Panel, Tabs, inputCls, cx } from "@/components/ui";

type Tab = "overview" | "evaluation" | "research" | "documents" | "activity";

export default function ApplicationDetail() {
  const { id } = useParams<{ id: string }>();
  const d = useData();
  const role = useRole();
  const act = useStore((s) => s.act);
  const reevaluate = useStore((s) => s.reevaluate);
  const [tab, setTab] = useState<Tab>("overview");
  const app = d.applications.find((a) => a.id === id);

  useEffect(() => {
    if (app && !app.viewedBy.includes(role)) useStore.getState().act((w, r) => markViewed(w, id, r));
  }, [app, role, id]);

  if (!app)
    return (
      <Empty title="Application not found">
        It may have been removed by a workspace reset. <Link href="/applications" className="text-teal-700 underline">Back to applications</Link>
      </Empty>
    );

  const ev = latestEvaluation(d, app.id);
  const conflicts = d.conflicts.filter((c) => c.applicationId === app.id);
  const overall = ev ? effectiveOverall(d, ev) : null;
  const cycle = d.cycles.find((c) => c.id === app.currentCycleId);

  return (
    <div>
      <div className="mb-3 text-[12px] text-muted">
        <Link href="/applications" className="hover:underline">Applications</Link> / {app.name}
      </div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-navy-900">{app.name}</h1>
            <ProcessingBadge s={app.processingStatus} />
            <DecisionBadge s={app.decisionStatus} />
            {ev && <RecBadge r={ev.recommendation} />}
            <Badge tone="neutral">Cycle {cycle?.number ?? 1}</Badge>
          </div>
          <p className="mt-0.5 text-muted">{app.oneLiner ?? "No description extracted."}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ev && (
            <div className="mr-2 flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1">
              <span className="text-[11px] uppercase tracking-wide text-muted">Overall</span>
              <ScorePill score={overall} />
              <span className="num text-[11px] text-faint">{Math.round(ev.coverage * 100)}% scored</span>
            </div>
          )}
          {ev && (
            <Link href={`/reports/${app.id}`}>
              <Button><FileText size={14} /> Report</Button>
            </Link>
          )}
          {can(role, "application.submit_for_review") && ["not_reviewed", "reopened", "information_requested"].includes(app.decisionStatus) && (
            <Button variant="primary" disabled={app.processingStatus === "failed"} onClick={() => act((w, r) => submitForReview(w, r, app.id, ""), "Sent to partner review.")}>
              <Send size={14} /> Send to partner review
            </Button>
          )}
          {ev && app.processingStatus !== "failed" && (
            <Button onClick={() => reevaluate(app.id)} title="Re-run with the active thesis, criteria, portfolio and approved learning rules. Previous evaluation is kept.">
              <RefreshCw size={14} /> Re-evaluate
            </Button>
          )}
        </div>
      </div>

      {app.processingStatus === "failed" && (
        <div className="mb-3">
          <Callout tone="risk" title="Processing failed — this is a technical state, not a decision">
            <ul className="list-disc pl-4">{app.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
            <div className="mt-1">Decision status remains <b>{app.decisionStatus.replace(/_/g, " ")}</b>. Upload a readable version from <Link className="underline" href="/applications/new">intake</Link>.</div>
          </Callout>
        </div>
      )}
      {app.processingStatus === "needs_attention" && (
        <div className="mb-3">
          <Callout tone="warn" title="Needs attention">
            <ul className="list-disc pl-4">{[...app.errors, ...app.warnings].map((e, i) => <li key={i}>{e}</li>)}</ul>
          </Callout>
        </div>
      )}
      {ev && <div className="mb-3"><SimulatedBanner label={ev.providerLabel} /></div>}

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "evaluation", label: <>Evaluation{conflicts.filter((c) => c.status === "open").length > 0 && <Badge tone="risk" className="ml-1.5">{conflicts.filter((c) => c.status === "open").length}</Badge>}</> },
          { id: "research", label: "Research & evidence" },
          { id: "documents", label: "Documents" },
          { id: "activity", label: "Activity" },
        ]}
      />
      {tab === "overview" && <OverviewTab appId={app.id} ev={ev} />}
      {tab === "evaluation" && (ev ? <EvaluationTab appId={app.id} ev={ev} /> : <Empty title="No evaluation yet">Processing has not produced an evaluation for this application.</Empty>)}
      {tab === "research" && <ResearchTab appId={app.id} />}
      {tab === "documents" && <DocumentsTab appId={app.id} />}
      {tab === "activity" && <ActivityTab appId={app.id} />}
    </div>
  );
}

function OverviewTab({ appId, ev }: { appId: string; ev?: Evaluation }) {
  const d = useData();
  const role = useRole();
  const act = useStore((s) => s.act);
  const app = d.applications.find((a) => a.id === appId)!;
  const company = d.companies.find((c) => c.id === app.companyId);
  const founders = d.founders.filter((f) => f.companyId === app.companyId);
  const fv = (k: string) => d.fields.find((f) => f.applicationId === appId && f.field === k && f.value)?.value;
  const conflicts = d.conflicts.filter((c) => c.applicationId === appId);
  const research = d.research.filter((r) => r.applicationId === appId);
  const claims = d.claims.filter((c) => c.applicationId === appId && !c.text.startsWith("Deck slide"));
  const ov = latestOverlap(d, appId);
  const decisions = d.decisions.filter((x) => x.applicationId === appId);
  const [conf, setConf] = useState<Conflict | null>(null);
  const [cmt, setCmt] = useState("");
  const [reopenOpen, setReopenOpen] = useState(false);
  const [ovNote, setOvNote] = useState("");
  const byClass = claims.reduce<Record<string, number>>((m, c) => ((m[c.classification] = (m[c.classification] ?? 0) + 1), m), {});
  const missing = d.fields.filter((f) => f.applicationId === appId && f.validation === "missing").map((f) => FIELD_DISPLAY[f.field] ?? f.field);

  const NA = <span className="text-faint">Not provided</span>;
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel title="Company profile" id="company">
            <KV
              rows={[
                ["Legal name", company?.legalName ?? NA],
                ["Website", company?.website ? <span className="font-mono text-[12px]">{company.website}</span> : NA],
                ["Location", company?.location ?? NA],
                ["Incorporated", company?.incorporated ?? NA],
                ["Sector", <span key="s">{SECTOR_LABEL[app.sectorKey]}{app.sectorSelected && !app.sectorSelected.toLowerCase().startsWith(SECTOR_LABEL[app.sectorKey].toLowerCase()) && <span className="text-faint"> (selected: {app.sectorSelected})</span>}</span>],
                ["Tags", app.tags.length ? app.tags.map((t) => <Badge key={t} tone="navy" className="mr-1">{t}</Badge>) : NA],
                ["Stage", app.stage ?? NA],
                ["Team size", fv("team_size") ?? NA],
                ["Source", app.source ?? NA],
              ]}
            />
            {missing.length > 0 && <div className="mt-2 text-[11.5px] text-warn-700">Missing from submission: {missing.join(", ")}</div>}
          </Panel>
          <Panel title={<span className="flex items-center gap-1.5"><Users size={13} /> Founder profiles</span>} id="founders">
            {founders.length ? (
              <div className="space-y-2.5">
                {founders.map((f) => (
                  <div key={f.id} className="rounded-md border border-line px-2.5 py-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{f.name}</span>
                      <span className="text-[11.5px] text-muted">{f.role || "role not stated"}</span>
                    </div>
                    <div className="mt-0.5 text-[12.5px]">{f.background || <span className="text-faint">No background given</span>}</div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-faint">
                      <span className="rounded bg-navy-50 px-1 font-mono text-navy-600">{f.sourceLabel}</span>
                      {f.profileUrl && <span className="font-mono">{f.profileUrl}</span>}
                      <span>· applicant-provided, unverified</span>
                    </div>
                  </div>
                ))}
                <div className="text-[12px] text-muted">Commitment: {fv("time_commitment") ?? "not stated"} · Prior startups: {fv("prior_startup") ?? "not stated"}{fv("earlier_cofounder") ? ` · ${fv("earlier_cofounder")}` : ""}</div>
              </div>
            ) : (
              <Empty title="No founders extracted" />
            )}
          </Panel>
        </div>
        <Panel title="Product, traction, economics and fundraising (as submitted)">
          <KV
            rows={[
              ["Product", fv("built") ?? NA],
              ["Customers", fv("customers") ?? fv("users") ?? fv("workers") ?? NA],
              ["Revenue / volume", fv("revenue") ?? fv("volume") ?? NA],
              ["Repeat", fv("repeat") ?? NA],
              ["Unit economics", fv("unit_economics") ?? NA],
              ["Acquisition", fv("acquisition") ?? NA],
              ["Raising", app.raiseInr ? `${formatInr(app.raiseInr)}${fv("valuation") ? ` at ${fv("valuation")}` : ""}` : NA],
              ["Use of funds", fv("use_of_funds") ?? NA],
              ["Existing investors", fv("existing_investors") ?? NA],
              ["Key risks (applicant)", fv("key_risks") ?? NA],
            ]}
          />
        </Panel>
        <Panel title={`Conflicting claims (${conflicts.length})`}>
          {conflicts.length ? (
            <div className="space-y-2.5">
              {conflicts.map((c) => (
                <ConflictCard key={c.id} c={c} onResolve={can(role, "conflict.resolve") ? () => setConf(c) : undefined} />
              ))}
            </div>
          ) : (
            <div className="text-[12.5px] text-muted">No conflicts detected between the submitted documents{app.tags.length || ev ? "" : ""}. {ev && !ev.flags.some((f) => /deck\/form cross-checks/.test(f.text)) ? "" : "Cross-checks need both a deck and a form."}</div>
          )}
        </Panel>
        <Panel title="Risks and unknowns">
          {ev ? (
            <ul className="space-y-1 text-[12.5px]">
              {ev.criticalUnknowns.map((u) => (
                <li key={u} className="text-risk-700">● {u}</li>
              ))}
              {ev.assessments.flatMap((a) => a.unknowns.map((u) => (
                <li key={a.criterion + u}><span className="text-muted">{CRITERION_SHORT[a.criterion]}:</span> {u}</li>
              )))}
            </ul>
          ) : (
            <span className="text-faint">Not evaluated.</span>
          )}
        </Panel>
        <Panel title="Reviewer comments">
          <div className="space-y-2">
            {app.comments.length ? (
              app.comments.map((c) => (
                <div key={c.id} className="text-[12.5px]">
                  <span className="font-medium">{ROLE_INFO[c.by].name}</span> <span className="text-faint">{c.at.slice(0, 16).replace("T", " ")}</span>
                  {c.criterion && <Badge tone="navy" className="ml-1">{CRITERION_SHORT[c.criterion]}</Badge>}
                  <div>{c.text}</div>
                </div>
              ))
            ) : (
              <div className="text-[12px] text-faint">No comments yet.</div>
            )}
            <div className="flex gap-2">
              <input className={inputCls} value={cmt} onChange={(e) => setCmt(e.target.value)} placeholder={`Comment as ${ROLE_INFO[role].name}…`} />
              <Button onClick={() => !act((w, r) => comment(w, r, appId, cmt)) && setCmt("")}>Add</Button>
            </div>
          </div>
        </Panel>
      </div>

      <div className="space-y-4">
        <Panel title="Partner decision">
          {decisions.length > 0 && (
            <div className="mb-3 space-y-1.5">
              {decisions.map((x) => (
                <div key={x.id} className="rounded-md border border-line px-2.5 py-1.5 text-[12.5px]">
                  <div className="flex items-center justify-between">
                    <b>{DECISION_TYPE_LABEL[x.decision]}</b>
                    <span className="text-[11px] text-faint">cycle {d.cycles.find((c) => c.id === x.cycleId)?.number}</span>
                  </div>
                  {x.passReason && <div className="text-muted">{PASS_REASON_LABEL[x.passReason]}</div>}
                  <div>{x.rationale}</div>
                  <div className="text-[11px] text-faint">{ROLE_INFO[x.decidedBy].name} · {x.decidedAt.slice(0, 16).replace("T", " ")} · system suggested: {x.recommendationAtTime ? RECOMMENDATION_LABEL[x.recommendationAtTime] : "—"}</div>
                </div>
              ))}
            </div>
          )}
          {can(role, "decision.record") ? (
            ["call_approved", "passed_by_partner", "on_hold", "information_requested"].includes(app.decisionStatus) ? (
              <div className="space-y-2">
                <div className="text-[12.5px]">Outcome recorded for this cycle.</div>
                <div className="flex gap-2">
                  <Button onClick={() => setReopenOpen(true)}><RotateCcw size={13} /> Reopen (new cycle)</Button>
                  {app.decisionStatus !== "call_approved" && app.decisionStatus !== "passed_by_partner" && <span className="text-[11.5px] text-muted">or record a new decision below</span>}
                </div>
                {app.decisionStatus !== "call_approved" && app.decisionStatus !== "passed_by_partner" && <DecisionForm appId={appId} recommendation={ev ? RECOMMENDATION_LABEL[ev.recommendation] : undefined} />}
              </div>
            ) : (
              <DecisionForm appId={appId} recommendation={ev ? RECOMMENDATION_LABEL[ev.recommendation] : undefined} />
            )
          ) : (
            <Callout tone="navy"><Lock size={12} className="mr-1 inline" /> Only Kushal records outcomes. {role === "riya" ? "Send the application to partner review when ready." : "Add comments or score corrections for Kushal."}</Callout>
          )}
          <ReopenDialog open={reopenOpen} onClose={() => setReopenOpen(false)} appId={appId} />
        </Panel>
        {ev && (
          <Panel title="Evaluation summary">
            <div className="mb-2 flex items-center gap-2">
              <RecBadge r={ev.recommendation} />
            </div>
            <ul className="mb-2 list-disc space-y-1 pl-4 text-[12.5px]">{ev.recommendationReasons.map((r) => <li key={r}>{r}</li>)}</ul>
            <div className="space-y-1.5">{ev.flags.map((f) => <FlagRow key={f.text} level={f.level} text={f.text} />)}</div>
            <div className="mt-3 grid grid-cols-3 gap-1">
              {ev.assessments.map((a) => {
                const e = effectiveAssessment(d, ev, a.criterion);
                return (
                  <div key={a.criterion} className="flex items-center justify-between rounded border border-line px-1.5 py-1 text-[11px]">
                    <span className="truncate text-muted">{CRITERION_SHORT[a.criterion]}</span>
                    <ScorePill score={e.score} size="sm" />
                  </div>
                );
              })}
            </div>
          </Panel>
        )}
        <Panel title={<span className="flex items-center gap-1.5"><ShieldAlert size={13} /> Portfolio overlap</span>}>
          {ov ? (
            <div className="space-y-2 text-[12.5px]">
              <Callout tone={ov.results.length ? "risk" : "warn"}>{ov.statusText}</Callout>
              {ov.results.map((r) => (
                <div key={r.portfolioId} className="rounded border border-line px-2 py-1.5">
                  <div className="flex items-center justify-between"><b>{r.portfolioName}</b><Badge tone="risk">{RELATIONSHIP_LABEL[r.relationship]}</Badge></div>
                  <div className="text-[11.5px] text-muted">{r.evidence}</div>
                </div>
              ))}
              <div className="text-[11px] text-faint">Compared with {ov.comparedCount} companies ({ov.datasetVersion}). Reviewer: {ov.reviewerDecision.replace(/_/g, " ")}{ov.reviewNote ? ` — ${ov.reviewNote}` : ""}</div>
              {can(role, "overlap.review") && ov.results.length > 0 && ov.reviewerDecision === "pending" && (
                <div className="space-y-1.5">
                  <input className={inputCls} value={ovNote} onChange={(e) => setOvNote(e.target.value)} placeholder="Note (e.g. spoke to MeetRecord founder)" />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => act((w, r) => reviewOverlap(w, r, ov.id, "confirmed_conflict", ovNote), "Overlap confirmed.")}>Confirm conflict</Button>
                    <Button size="sm" onClick={() => act((w, r) => reviewOverlap(w, r, ov.id, "false_alarm", ovNote), "Marked as false alarm.")}>False alarm</Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <span className="text-faint">Not checked.</span>
          )}
        </Panel>
        <Panel title="Evidence coverage & research status">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {Object.entries(byClass).map(([k, n]) => (
              <span key={k} className="flex items-center gap-1"><ClassBadge c={k as never} /> <span className="num text-[12px]">{n}</span></span>
            ))}
          </div>
          <div className="text-[12.5px]">
            {research.filter((r) => r.status === "answered").length}/{research.length} research tasks answered · {research.filter((r) => r.priority === "high" && r.status !== "answered").length} high-priority open
          </div>
          <div className="mt-1 text-[11.5px] text-faint">Nothing is verified until a reviewer logs an independent source.</div>
        </Panel>
      </div>
      <ConflictDialog key={conf?.id} c={conf} onClose={() => setConf(null)} />
    </div>
  );
}

function EvaluationTab({ appId, ev }: { appId: string; ev: Evaluation }) {
  const d = useData();
  const role = useRole();
  const [open, setOpen] = useState<CriterionId | null>("founder_quality");
  const [correct, setCorrect] = useState<CriterionId | null>(null);
  const crit = d.criteriaVersions.find((c) => c.id === ev.criteriaVersionId);
  const history = d.evaluations.filter((e) => e.applicationId === appId);
  return (
    <div className="space-y-4">
      <Panel title="Hybrid scorecard" dense actions={<span className="text-[11px] text-muted">{ev.thesisVersionId} · {ev.criteriaVersionId} · {ev.portfolioDatasetVersion}</span>}>
        <table className="dt">
          <thead>
            <tr>
              <th />
              <th>Criterion</th>
              <th>Score</th>
              <th>Evidence</th>
              <th>Confidence</th>
              <th className="text-right">+ / −</th>
              <th>Key unknown</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {ev.assessments.map((a) => {
              const e = effectiveAssessment(d, ev, a.criterion);
              const isOpen = open === a.criterion;
              return [
                <tr key={a.criterion} className="cursor-pointer" onClick={() => setOpen(isOpen ? null : a.criterion)}>
                  <td className="w-6 text-muted">{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                  <td className="font-medium">
                    {crit?.criteria.find((c) => c.id === a.criterion)?.name}
                    <span className="num ml-1.5 text-[11px] text-faint">w{crit?.criteria.find((c) => c.id === a.criterion)?.weight}</span>
                  </td>
                  <td>
                    <div className="flex items-center gap-1.5">
                      <ScorePill score={e.score} />
                      {e.corrected && <span className="text-[11px] text-faint line-through" title="Original AI score">{a.score ?? "n/a"}</span>}
                    </div>
                  </td>
                  <td><EvidenceBadge s={e.evidenceState} /></td>
                  <td><ConfidenceBadge c={e.confidence} /></td>
                  <td className="num text-right text-[12px]"><span className="text-teal-700">{a.supporting.length}</span> / <span className="text-risk-700">{a.opposing.length}</span></td>
                  <td className="max-w-[300px] truncate text-[12px] text-muted">{a.unknowns[0] ?? "—"}</td>
                  <td>
                    {can(role, "score.correct") && (
                      <button className="flex items-center gap-1 text-[12px] font-medium text-teal-700 hover:underline" onClick={(x) => { x.stopPropagation(); setCorrect(a.criterion); }}>
                        <Pencil size={12} /> Correct
                      </button>
                    )}
                  </td>
                </tr>,
                isOpen && (
                  <tr key={a.criterion + "-d"}>
                    <td />
                    <td colSpan={7} className="bg-paper">
                      <p className="mb-2 text-[12.5px] text-muted">{crit?.criteria.find((c) => c.id === a.criterion)?.definition}</p>
                      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                        <div><div className="mb-1 text-[11px] font-semibold uppercase text-teal-700">Supporting evidence</div><SignalList items={a.supporting} kind="support" /></div>
                        <div><div className="mb-1 text-[11px] font-semibold uppercase text-risk-700">Opposing evidence</div><SignalList items={a.opposing} kind="oppose" /></div>
                      </div>
                      {a.notes.length > 0 && <div className="mt-2"><div className="mb-1 text-[11px] font-semibold uppercase text-muted">Notes</div><SignalList items={a.notes} kind="note" /></div>}
                      {a.unknowns.length > 0 && (
                        <div className="mt-2"><div className="mb-1 text-[11px] font-semibold uppercase text-warn-700">Key unknowns</div>
                          <ul className="list-disc pl-5 text-[12.5px]">{a.unknowns.map((u) => <li key={u}>{u}</li>)}</ul></div>
                      )}
                      {a.appliedRules.length > 0 && <div className="mt-2 text-[12px] text-gold-700"><BookMarked size={12} className="mr-1 inline" />{a.appliedRules.join(" · ")}</div>}
                      <div className="mt-2 text-[12px] italic text-muted">{a.rationale}</div>
                      {d.corrections.filter((c) => c.evaluationId === ev.id && c.criterion === a.criterion).map((c) => (
                        <div key={c.id} className="mt-2 rounded border border-gold-100 bg-gold-50 px-2 py-1 text-[12px]">
                          <b>Correction</b> by {ROLE_INFO[c.reviewer].name}: {c.original.score ?? "n/a"} → {c.revised.score ?? "n/a"} · “{c.reason}” · {c.scope.replace("_", " ")} · approval: {c.approval.replace("_", " ")}
                        </div>
                      ))}
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </Panel>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Stated thesis">
          <div className="mb-1"><Badge tone={ev.statedThesis.fit === "in_scope" ? "teal" : ev.statedThesis.fit === "unknown" ? "neutral" : "risk"}>{ev.statedThesis.fit.replace("_", " ")}</Badge></div>
          <p className="text-[12.5px]">{ev.statedThesis.detail}</p>
          <p className="mt-2 text-[11.5px] text-faint">Source: case brief. The fund publishes no rubric or exclusion list.</p>
        </Panel>
        <Panel title="Revealed thesis (from past decisions)">
          <table className="w-full text-[12.5px]">
            <tbody>
              {ev.revealedThesis.map((r) => {
                const p = d.thesisVersions.find((t) => t.id === ev.thesisVersionId)?.revealed.find((x) => x.id === r.patternId);
                return (
                  <tr key={r.patternId} className="border-b border-line last:border-0">
                    <td className="py-1 pr-2 align-top font-mono text-[11px]">{r.patternId}</td>
                    <td className="py-1 pr-2 align-top"><Badge tone={r.result === "consistent" ? "teal" : r.result === "concern" ? "risk" : "neutral"}>{r.result.replace("_", " ")}</Badge></td>
                    <td className="py-1 align-top"><div className="font-medium">{p?.title}</div><div className="text-muted">{r.detail}</div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-[11.5px] text-faint">Shown separately from the stated thesis on purpose. RP-9 (Riya&apos;s drift observation) is contested and not scored.</p>
        </Panel>
      </div>
      <Panel title="Evaluation history" dense>
        <table className="dt">
          <thead><tr><th>Created</th><th>Provider</th><th>Versions</th><th>Overall (AI)</th><th>Recommendation</th><th>Learning rules</th></tr></thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id}>
                <td className="num">{h.createdAt.slice(0, 19).replace("T", " ")}</td>
                <td>{h.providerLabel}</td>
                <td className="font-mono text-[11px]">{h.thesisVersionId} · {h.criteriaVersionId} · {h.portfolioDatasetVersion} · cycle {d.cycles.find((c) => c.id === h.cycleId)?.number}</td>
                <td><ScorePill score={h.overall} size="sm" /></td>
                <td><RecBadge r={h.recommendation} /></td>
                <td>{h.appliedLearningRules.join(", ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      {correct && <CorrectionDialog key={correct} open onClose={() => setCorrect(null)} ev={ev} criterion={correct} />}
    </div>
  );
}

function ResearchTab({ appId }: { appId: string }) {
  const d = useData();
  const role = useRole();
  const tasks = d.research.filter((r) => r.applicationId === appId);
  const claims = d.claims.filter((c) => c.applicationId === appId && !c.text.startsWith("Deck slide"));
  const evidence = d.evidence.filter((e) => e.applicationId === appId && e.addedBy !== "system");
  const [task, setTask] = useState<ResearchTask | null>(null);
  const [evOpen, setEvOpen] = useState(false);
  const [filter, setFilter] = useState("");
  return (
    <div className="space-y-4">
      <Panel title="Research tasks (10 workstreams)" dense actions={can(role, "evidence.add") && <Button size="sm" onClick={() => setEvOpen(true)}><Plus size={12} /> Log evidence</Button>}>
        <table className="dt">
          <thead><tr><th>Workstream</th><th>Question</th><th>Priority</th><th>Status</th><th>Findings / provider note</th><th /></tr></thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id}>
                <td className="whitespace-nowrap font-medium">{WORKSTREAM_LABEL[t.workstream]}</td>
                <td className="max-w-[380px] text-[12.5px]">{t.question}<div className="mt-0.5 text-[11px] text-faint">{t.suggestedSources.map((s) => `T${s.tier} ${s.name}`).join(" · ")}</div></td>
                <td><Badge tone={t.priority === "high" ? "risk" : t.priority === "medium" ? "gold" : "neutral"}>{t.priority}</Badge></td>
                <td><Badge tone={t.status === "answered" ? "ok" : t.status === "inaccessible" || t.status === "blocked" ? "warn" : "neutral"}>{t.status.replace("_", " ")}</Badge></td>
                <td className="max-w-[300px] text-[12px]">{t.findings || <span className="text-faint">{t.failureReason ?? t.providerNote}</span>}</td>
                <td>{can(role, "research.update") && <button className="text-[12px] font-medium text-teal-700 hover:underline" onClick={() => setTask(t)}>Update</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      {evidence.length > 0 && (
        <Panel title="Logged external evidence" dense>
          <table className="dt">
            <thead><tr><th>Source</th><th>Type</th><th>Direction</th><th>Classification</th><th>Excerpt</th><th>Added</th></tr></thead>
            <tbody>
              {evidence.map((e) => (
                <tr key={e.id}>
                  <td>{e.title}<div className="text-[11px] text-faint">{e.publisher}{e.url && <> · <a className="underline" href={e.url} target="_blank" rel="noreferrer noopener">{e.url}</a></>}</div></td>
                  <td className="text-[12px]">{e.sourceType.replace(/_/g, " ")}</td>
                  <td>{e.direction}</td>
                  <td><ClassBadge c={e.verification} /></td>
                  <td className="max-w-[320px] text-[12px]">“{e.excerpt}” <span className="text-faint">{e.location}</span></td>
                  <td className="text-[11px]">{e.addedBy !== "system" && ROLE_INFO[e.addedBy].name}<br />{e.retrievedAt.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
      <Panel title={`Evidence ledger — claims (${claims.length})`} dense actions={<input className={`${inputCls} h-7 w-56`} placeholder="Filter claims…" value={filter} onChange={(e) => setFilter(e.target.value)} />}>
        <table className="dt">
          <thead><tr><th>Claim</th><th>Source</th><th>Classification</th><th>Original text</th><th>Criteria</th></tr></thead>
          <tbody>
            {claims.filter((c) => !filter || `${c.text} ${c.excerpt}`.toLowerCase().includes(filter.toLowerCase())).map((c) => (
              <tr key={c.id}>
                <td className="max-w-[300px]">{c.text}</td>
                <td><span className="rounded bg-navy-50 px-1 font-mono text-[11px] text-navy-600">{c.sourceLabel}</span></td>
                <td><ClassBadge c={c.classification} /></td>
                <td className="max-w-[340px] font-mono text-[11px] text-muted">{c.excerpt.slice(0, 200)}</td>
                <td className="text-[11px] text-muted">{c.criteria.map((x) => CRITERION_SHORT[x]).join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <ResearchDialog key={task?.id} t={task} onClose={() => setTask(null)} />
      {evOpen && <EvidenceDialog open onClose={() => setEvOpen(false)} appId={appId} claims={claims} />}
    </div>
  );
}

function DocumentsTab({ appId }: { appId: string }) {
  const d = useData();
  const role = useRole();
  const act = useStore((s) => s.act);
  const app = d.applications.find((a) => a.id === appId)!;
  const [openDoc, setOpenDoc] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ id: string; v: string } | null>(null);
  if (!canViewDocuments(role, app))
    return (
      <Callout tone="warn" title="Access restricted">
        {ROLE_INFO[role].name} can open an application&apos;s documents only after Kushal shares it with him. Access follows the signed-in user and explicit grants — never sector tags or anything written in the founder&apos;s documents. Scores, evidence and the report remain visible. (Enforced in the permission layer, and in Supabase RLS in production mode.)
      </Callout>
    );
  const docs = d.documents.filter((x) => x.applicationId === appId);
  const fields = d.fields.filter((f) => f.applicationId === appId);
  const spans = screeningFor(d, appId);
  return (
    <div className="space-y-4">
      <ScreeningPanel appId={appId} spans={spans} />
      <AccessPanel appId={appId} />
      <Panel title="Documents" dense>
        <table className="dt">
          <thead><tr><th>File</th><th>Kind</th><th>Status</th><th>Pages</th><th>Method</th><th>SHA-256</th><th>Uploaded</th><th /></tr></thead>
          <tbody>
            {docs.map((x) => [
              <tr key={x.id}>
                <td className="font-mono text-[12px]">{x.filename}<div className="num text-[11px] text-faint">{(x.size / 1024).toFixed(0)} KB</div></td>
                <td><Badge tone="navy">{x.kind}</Badge></td>
                <td>{x.status === "extracted" ? <Badge tone="ok">extracted</Badge> : <Badge tone="risk" title={x.error}>{x.status}</Badge>}{x.error && <div className="max-w-[260px] text-[11px] text-risk-700">{x.error}</div>}{x.warnings.map((w) => <div key={w} className="text-[11px] text-warn-700">{w}</div>)}</td>
                <td className="num">{x.pages.length}</td>
                <td className="text-[12px]">{x.method ?? "—"}</td>
                <td className="font-mono text-[11px]">{x.sha256 ? x.sha256.slice(0, 12) : "—"}</td>
                <td className="text-[11px]">{ROLE_INFO[x.uploadedBy].name}<br />{x.uploadedAt.slice(0, 16).replace("T", " ")}</td>
                <td>{x.pages.length > 0 && <button className="text-[12px] font-medium text-teal-700 hover:underline" onClick={() => setOpenDoc(openDoc === x.id ? null : x.id)}>{openDoc === x.id ? "Hide" : "View text"}</button>}</td>
              </tr>,
              openDoc === x.id && (
                <tr key={x.id + "p"}>
                  <td colSpan={8} className="bg-paper">
                    <div className="max-h-[420px] space-y-2 overflow-y-auto">
                      {x.pages.map((p) => (
                        <div key={p.index} className="rounded border border-line bg-surface">
                          <div className="border-b border-line px-2 py-0.5 font-mono text-[11px] text-navy-600">{x.kind === "deck" ? "Deck" : "Form"} p{p.index}</div>
                          <pre className="whitespace-pre-wrap px-2 py-1 font-mono text-[11.5px]">
                            <HighlightedPage text={p.text} spans={spans.filter((s) => s.docId === x.id && s.page === p.index)} />
                          </pre>
                        </div>
                      ))}
                    </div>
                  </td>
                </tr>
              ),
            ])}
          </tbody>
        </table>
        <p className="px-3 py-2 text-[11px] text-faint">Original files are not stored in demo mode (only extracted text with page provenance). In production mode originals go to a private Supabase bucket and open via short-lived signed URLs.</p>
      </Panel>
      <Panel title="Extracted fields — review" dense>
        <table className="dt">
          <thead><tr><th>Field</th><th>Value</th><th>Source</th><th>Method</th><th>State</th><th /></tr></thead>
          <tbody>
            {fields.map((f) => {
              const doc = docs.find((x) => x.id === f.documentId);
              return (
                <tr key={f.id}>
                  <td className="whitespace-nowrap font-medium">{FIELD_DISPLAY[f.field.replace(/_\d+$/, "")] ?? f.label}</td>
                  <td className="max-w-[420px]">
                    {edit?.id === f.id ? (
                      <div className="flex gap-1.5">
                        <input className={inputCls} value={edit.v} onChange={(e) => setEdit({ id: f.id, v: e.target.value })} />
                        <Button size="sm" variant="primary" onClick={() => !act((w, r) => editField(w, r, f.id, edit.v), "Field updated. Re-evaluate to use it.") && setEdit(null)}>Save</Button>
                        <Button size="sm" onClick={() => setEdit(null)}>Cancel</Button>
                      </div>
                    ) : f.value ? (
                      <>
                        {f.value}
                        {f.originalValue !== undefined && f.originalValue !== f.value && <div className="text-[11px] text-faint">extracted: {f.originalValue ?? "—"}</div>}
                      </>
                    ) : (
                      <span className="text-warn-700">Not found in submission (left blank, not inferred)</span>
                    )}
                  </td>
                  <td><span className="rounded bg-navy-50 px-1 font-mono text-[11px] text-navy-600">{doc ? `${doc.kind === "deck" ? "Deck" : "Form"}${f.page ? ` p${f.page}` : ""}` : "—"}</span></td>
                  <td className="text-[11px]">{f.method}</td>
                  <td><Badge tone={f.validation === "missing" ? "warn" : f.validation.startsWith("human") ? "ok" : "neutral"}>{f.validation.replace("_", " ")}</Badge></td>
                  <td className="whitespace-nowrap">
                    {can(role, "extraction.edit") && edit?.id !== f.id && (
                      <span className="flex gap-2">
                        <button className="text-[12px] text-teal-700 hover:underline" onClick={() => setEdit({ id: f.id, v: f.value ?? "" })}>Edit</button>
                        {f.validation === "parsed" && <button className="text-[12px] text-teal-700 hover:underline" onClick={() => act((w, r) => confirmField(w, r, f.id))}><Check size={12} className="inline" /> Confirm</button>}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

function ActivityTab({ appId }: { appId: string }) {
  const d = useData();
  const events = d.audit.filter((a) => a.applicationId === appId);
  const cycles = d.cycles.filter((c) => c.applicationId === appId);
  const jobs = d.jobs.filter((j) => j.applicationId === appId);
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <Panel title={`Audit trail (${events.length})`} dense>
        <table className="dt">
          <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Detail</th></tr></thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td className="num whitespace-nowrap text-[12px]">{e.at.slice(0, 19).replace("T", " ")}</td>
                <td className="whitespace-nowrap">{e.actor === "system" ? <span className="text-muted">System</span> : ROLE_INFO[e.actor].name}</td>
                <td className="whitespace-nowrap font-mono text-[11.5px]">{e.action}</td>
                <td className="text-[12.5px]">{e.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <div className="space-y-4">
        <Panel title="Application cycles">
          {cycles.map((c) => (
            <div key={c.id} className="mb-1.5 text-[12.5px]">
              <b>Cycle {c.number}</b> · opened {c.openedAt.slice(0, 10)} by {ROLE_INFO[c.openedBy].name}{c.closedAt ? ` · closed ${c.closedAt.slice(0, 10)}` : " · current"}
              <div className="text-muted">{c.reason}</div>
            </div>
          ))}
        </Panel>
        <Panel title="Processing jobs">
          {jobs.map((j) => (
            <div key={j.id} className={cx("mb-1.5 text-[12.5px]", j.status === "failed" && "text-risk-700")}>
              <b>{j.status}</b> · {j.step} · attempt {j.attempts}{j.durationMs !== undefined ? ` · ${j.durationMs} ms` : ""}
              {j.error && <div>{j.error}</div>}
            </div>
          ))}
        </Panel>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- P2 · C8: screened passages, reviewer restore, and P-C access

function HighlightedPage({ text, spans }: { text: string; spans: ScreenedSpan[] }) {
  if (!spans.length) return <>{text}</>;
  const out: React.ReactNode[] = [];
  let at = 0;
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    if (s.start > at) out.push(text.slice(at, s.start));
    out.push(
      <mark key={s.id} title={`${s.kind === "hypothetical" ? "Hypothetical figure" : "Possible instruction to the evaluator"} — ${s.restored ? "restored by a reviewer" : "set aside, not scored"} [${s.id}]`} className={cx("rounded px-0.5", s.restored ? "bg-teal-50 text-teal-700" : s.kind === "hypothetical" ? "bg-warn-50 text-warn-700" : "bg-risk-50 text-risk-700")}>
        {text.slice(s.start, s.end)}
      </mark>,
    );
    at = s.end;
  }
  out.push(text.slice(at));
  return <>{out}</>;
}

function ScreeningPanel({ appId, spans }: { appId: string; spans: ScreenedSpan[] }) {
  const d = useData();
  const role = useRole();
  const setScreenedSpan = useStore((s) => s.setScreenedSpan);
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const restorations = d.screeningRestorations?.filter((r) => r.applicationId === appId) ?? [];
  const mayRestore = can(role, "screening.restore");
  return (
    <Panel title={<span className="flex items-center gap-1.5"><ShieldAlert size={13} /> Passages set aside for review ({spans.filter((s) => !s.restored).length})</span>} dense>
      {spans.length === 0 ? (
        <p className="px-3 py-2.5 text-[12.5px] text-muted">Nothing in these documents read like an instruction to the evaluator or a hypothetical figure. All founder text was screened as data before scoring.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
          <table className="dt">
            <thead><tr><th>Where</th><th>Type</th><th>Original wording (exactly as extracted)</th><th>Status</th><th /></tr></thead>
            <tbody>
              {spans.map((s) => {
                const rec = restorations.filter((r) => r.spanId === s.id).at(-1);
                return [
                  <tr key={s.id}>
                    <td className="whitespace-nowrap font-mono text-[11.5px]">{spanLocation(s)}<div className="text-[10.5px] text-faint">{s.id}</div></td>
                    <td>
                      <Badge tone={s.kind === "hypothetical" ? "warn" : "risk"}>{s.kind === "hypothetical" ? "Hypothetical figure" : "Possible instruction"}</Badge>
                      <div className="mt-0.5 text-[11px] text-muted">{s.reasons.map((r) => r.replace(/_/g, " ")).join(", ")}</div>
                    </td>
                    <td className="max-w-[460px]"><blockquote className="border-l-2 border-line-strong pl-2 font-mono text-[11.5px] text-ink">{s.text}</blockquote></td>
                    <td className="text-[12px]">
                      {s.restored ? <Badge tone="teal">Restored — scored as unverified claim</Badge> : <Badge tone="neutral">Set aside — not scored</Badge>}
                      {rec && <div className="mt-0.5 text-[11px] text-muted">{rec.revokedAt ? `Restored by ${ROLE_INFO[rec.restoredBy].name}, set aside again by ${ROLE_INFO[rec.revokedBy!].name}` : `By ${ROLE_INFO[rec.restoredBy].name}: “${rec.note}”`}</div>}
                    </td>
                    <td className="text-right">{mayRestore && <Button size="sm" variant="ghost" onClick={() => { setOpen(open === s.id ? null : s.id); setNote(""); }}>{s.restored ? "Set aside again" : "Restore…"}</Button>}</td>
                  </tr>,
                  open === s.id && (
                    <tr key={s.id + "-form"}>
                      <td colSpan={5} className="bg-paper">
                        <div className="flex flex-wrap items-center gap-2 py-1">
                          <input className={`${inputCls} max-w-[520px]`} value={note} onChange={(e) => setNote(e.target.value)} placeholder={s.restored ? "Why set this aside again? (recorded in the audit trail)" : "Why restore this passage? (required; recorded in the audit trail)"} />
                          <Button size="sm" variant="primary" disabled={!note.trim() || busy} onClick={async () => { setBusy(true); const err = await setScreenedSpan(appId, s.id, !s.restored, note); setBusy(false); if (!err) setOpen(null); }}>
                            {s.restored ? "Set aside and re-evaluate" : "Restore and re-evaluate"}
                          </Button>
                        </div>
                        {!s.restored && <p className="text-[11px] text-muted">Restoring includes this text in scoring as an ordinary, unverified founder claim. It never becomes verified evidence.</p>}
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
          </div>
          <p className="px-3 py-2 text-[11px] text-faint">Founder documents are treated as data. A passage is set aside when it reads like an instruction to the evaluating system, or presents figures hypothetically. A flag is a prompt for human review — it is not proof that the founder acted in bad faith. Original text and page numbers are kept unchanged.</p>
        </>
      )}
    </Panel>
  );
}

function AccessPanel({ appId }: { appId: string }) {
  const d = useData();
  const role = useRole();
  const act = useStore((s) => s.act);
  const [note, setNote] = useState("");
  const app = d.applications.find((a) => a.id === appId)!;
  const grants = app.accessGrants ?? [];
  const aditya = grants.find((g) => g.role === "aditya");
  const suggested = app.sectorKey === "deeptech" || app.tags.includes("deeptech") || app.tags.includes("hardware");
  if (role !== "kushal" && !aditya) return null;
  return (
    <Panel title={<span className="flex items-center gap-1.5"><Lock size={13} /> Document access</span>}>
      <div className="space-y-2 text-[12.5px]">
        <p className="text-muted">Kushal and Riya see every application by role. Aditya sees an application&apos;s documents — and joins its calls — only when Kushal shares it here. Nothing in a founder&apos;s documents can change access.</p>
        {aditya ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="teal">Shared with Aditya</Badge>
            <span className="text-[11.5px] text-muted">by {ROLE_INFO[aditya.grantedBy].name}, {aditya.at.slice(0, 10)} — “{aditya.note}”</span>
            {role === "kushal" && <Button size="sm" variant="ghost" onClick={() => act((w, r) => revokeDocumentAccess(w, r, { applicationId: appId, grantee: "aditya", note: "Withdrawn from the Documents tab" }), "Access withdrawn.")}>Withdraw</Button>}
          </div>
        ) : (
          role === "kushal" && (
            <div className="flex flex-wrap items-center gap-2">
              {suggested && <Badge tone="navy">Suggested: deeptech review</Badge>}
              <input className={`${inputCls} max-w-[360px]`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why share with Aditya? (recorded)" />
              <Button size="sm" variant="primary" disabled={!note.trim()} onClick={() => { if (!act((w, r) => grantDocumentAccess(w, r, { applicationId: appId, grantee: "aditya", note }), "Shared with Aditya.")) setNote(""); }}>Share with Aditya</Button>
            </div>
          )
        )}
      </div>
    </Panel>
  );
}
