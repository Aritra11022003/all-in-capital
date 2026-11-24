"use client";
import { useState } from "react";
import type { Claim, Conflict, CorrectionCategory, CriterionId, Evaluation, EvidenceState, Confidence, PartnerDecisionType, PassReason, ResearchStatus, ResearchTask, SourceType } from "@/lib/shared/types";
import { useStore } from "@/lib/store";
import { addEvidence, correctScore, recordDecision, reopen, resolveConflict, updateResearchTask } from "@/lib/domain/workspace";
import { CORRECTION_CATEGORY_LABEL, CRITERION_SHORT, DECISION_TYPE_LABEL, EVIDENCE_STATE_LABEL, PASS_REASON_LABEL, SOURCE_TYPE_LABEL } from "@/lib/shared/labels";
import { Button, Callout, Field, Modal, inputCls } from "./ui";

export function CorrectionDialog({ open, onClose, ev, criterion }: { open: boolean; onClose: () => void; ev: Evaluation; criterion: CriterionId }) {
  const act = useStore((s) => s.act);
  const orig = ev.assessments.find((a) => a.criterion === criterion)!;
  const [score, setScore] = useState<string>(orig.score === null ? "" : String(orig.score));
  const [state, setState] = useState<EvidenceState>(orig.evidenceState);
  const [conf, setConf] = useState<Confidence>(orig.confidence);
  const [reason, setReason] = useState("");
  const [category, setCategory] = useState<CorrectionCategory>("evidence_misread");
  const [scope, setScope] = useState<"case_specific" | "reusable">("case_specific");
  const [kw, setKw] = useState("");
  const submit = () => {
    const err = act(
      (d, role) =>
        correctScore(d, role, {
          evaluationId: ev.id,
          criterion,
          score: score === "" ? null : Number(score),
          evidenceState: score === "" ? "insufficient" : state,
          confidence: conf,
          reason,
          category,
          scope,
          keywords: kw.split(",").map((x) => x.trim()).filter(Boolean),
        }),
      scope === "reusable" ? "Correction saved. Reusable rule proposed — it needs partner approval before it affects any evaluation." : "Correction saved. The original AI assessment is preserved.",
    );
    if (!err) onClose();
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Correct score — ${CRITERION_SHORT[criterion]}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit}>Save correction</Button>
        </>
      }
    >
      <Callout tone="navy">
        Original AI assessment: <b>{orig.score ?? "insufficient evidence"}</b> · {EVIDENCE_STATE_LABEL[orig.evidenceState]} · {orig.confidence} confidence. It is kept unchanged; your correction is stored alongside it.
      </Callout>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Field label="Revised score">
          <select className={inputCls} value={score} onChange={(e) => setScore(e.target.value)}>
            <option value="">Insufficient evidence</option>
            {[1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </Field>
        <Field label="Evidence state">
          <select className={inputCls} value={state} onChange={(e) => setState(e.target.value as EvidenceState)}>
            {Object.entries(EVIDENCE_STATE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="Confidence">
          <select className={inputCls} value={conf} onChange={(e) => setConf(e.target.value as Confidence)}>
            {["low", "medium", "high"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="One-line reason" required hint="Kushal: 'say why in a line so the correction can be reused'.">
        <input className={inputCls} maxLength={240} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Missing repeat data for a consumer brand should drag the score" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Category">
          <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value as CorrectionCategory)}>
            {Object.entries(CORRECTION_CATEGORY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="Scope">
          <select className={inputCls} value={scope} onChange={(e) => setScope(e.target.value as "case_specific" | "reusable")}>
            <option value="case_specific">Case-specific (this application only)</option>
            <option value="reusable">Reusable (propose a learning rule)</option>
          </select>
        </Field>
      </div>
      {scope === "reusable" && (
        <Field label="Apply to similar applications mentioning (comma-separated keywords, optional)" hint="The proposed rule matches the same sector plus any of these keywords. It is inactive until Kushal or Aditya approves it.">
          <input className={inputCls} value={kw} onChange={(e) => setKw(e.target.value)} placeholder="e.g. NBFC, credit" />
        </Field>
      )}
    </Modal>
  );
}

export function ConflictDialog({ c, onClose }: { c: Conflict | null; onClose: () => void }) {
  const act = useStore((s) => s.act);
  const [status, setStatus] = useState<Conflict["status"]>("explained");
  const [note, setNote] = useState("");
  if (!c) return null;
  return (
    <Modal
      open={!!c}
      onClose={onClose}
      title="Review conflict"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => !act((d, r) => resolveConflict(d, r, c.id, status, note), "Conflict updated.") && onClose()}>Save</Button>
        </>
      }
    >
      <p className="mb-2 font-medium">{c.label}</p>
      <Callout tone="warn">The platform never picks a side. Record what the founder or an independent source said. Every original value stays on file.{c.scoring === "flag_only" ? " This conflict is flag only: it does not change any score or recommendation." : ""}</Callout>
      <div className="mt-3">
        <Field label="Status">
          <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as Conflict["status"])}>
            <option value="open">Open</option>
            <option value="explained">Explained (founder / source clarified)</option>
            <option value="confirmed">Confirmed inconsistency</option>
          </select>
        </Field>
        <Field label="Note" required>
          <textarea className={`${inputCls} h-20`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Founder confirmed 24 paying + 7 trial; deck counted trials as paying." />
        </Field>
      </div>
    </Modal>
  );
}

export function ResearchDialog({ t, onClose }: { t: ResearchTask | null; onClose: () => void }) {
  const act = useStore((s) => s.act);
  const [status, setStatus] = useState<ResearchStatus>(t?.status ?? "in_progress");
  const [findings, setFindings] = useState(t?.findings ?? "");
  const [sources, setSources] = useState((t?.sourcesExamined ?? []).join("\n"));
  const [unanswered, setUnanswered] = useState((t?.unanswered ?? []).join("\n"));
  const [failure, setFailure] = useState(t?.failureReason ?? "");
  if (!t) return null;
  return (
    <Modal
      open={!!t}
      onClose={onClose}
      wide
      title="Update research task"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() =>
              !act(
                (d, r) =>
                  updateResearchTask(d, r, t.id, {
                    status,
                    findings,
                    sourcesExamined: sources.split("\n").map((s) => s.trim()).filter(Boolean),
                    unanswered: unanswered.split("\n").map((s) => s.trim()).filter(Boolean),
                    failureReason: failure || undefined,
                    reviewerStatus: status === "answered" ? "reviewed" : "pending",
                  }),
                "Research task updated.",
              ) && onClose()
            }
          >
            Save
          </Button>
        </>
      }
    >
      <p className="mb-2 font-medium">{t.question}</p>
      <div className="mb-2 text-[12px] text-muted">
        Suggested sources:{" "}
        {t.suggestedSources.map((s) => (
          <span key={s.name} className="mr-2">
            T{s.tier} {s.name}
          </span>
        ))}
      </div>
      <Callout tone="gold">Respect site terms, robots rules and paywalls. Never record a source you did not open. If a source was unreachable, mark the task Inaccessible and say why.</Callout>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Field label="Status">
          <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as ResearchStatus)}>
            {["not_started", "in_progress", "answered", "blocked", "inaccessible"].map((s) => (
              <option key={s} value={s}>{s.replace("_", " ")}</option>
            ))}
          </select>
        </Field>
        <Field label="Failure reason (required if blocked / inaccessible)">
          <input className={inputCls} value={failure} onChange={(e) => setFailure(e.target.value)} placeholder="e.g. MCA portal down; website is a placeholder" />
        </Field>
      </div>
      <Field label="Findings">
        <textarea className={`${inputCls} h-20`} value={findings} onChange={(e) => setFindings(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Sources examined (one per line)">
          <textarea className={`${inputCls} h-20 font-mono text-[12px]`} value={sources} onChange={(e) => setSources(e.target.value)} />
        </Field>
        <Field label="Still unanswered (one per line)">
          <textarea className={`${inputCls} h-20`} value={unanswered} onChange={(e) => setUnanswered(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

export function EvidenceDialog({ open, onClose, appId, claims, taskId }: { open: boolean; onClose: () => void; appId: string; claims: Claim[]; taskId?: string }) {
  const act = useStore((s) => s.act);
  const [f, setF] = useState({ sourceType: "official_company_record" as SourceType, title: "", publisher: "", url: "", publishedAt: "", excerpt: "", location: "", direction: "supports" as "supports" | "contradicts" | "context", notes: "" });
  const [claimIds, setClaimIds] = useState<string[]>([]);
  const [crit, setCrit] = useState<CriterionId[]>([]);
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });
  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Log evidence"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() =>
              !act(
                (d, r) => {
                  addEvidence(d, r, { applicationId: appId, claimIds, sourceType: f.sourceType, title: f.title, publisher: f.publisher, url: f.url || undefined, publishedAt: f.publishedAt || undefined, excerpt: f.excerpt, location: f.location, direction: f.direction, criteria: crit, reviewerNotes: f.notes || undefined, researchTaskId: taskId });
                },
                "Evidence logged.",
              ) && onClose()
            }
          >
            Save evidence
          </Button>
        </>
      }
    >
      <Callout tone="navy">A pitch deck shows the founder made a claim; it does not prove it. A company website shows what the company says publicly. A LinkedIn profile supports employment history, not execution quality.</Callout>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Field label="Source type" required>
          <select className={inputCls} value={f.sourceType} onChange={(e) => set("sourceType", e.target.value)}>
            {Object.entries(SOURCE_TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="Direction">
          <select className={inputCls} value={f.direction} onChange={(e) => set("direction", e.target.value)}>
            <option value="supports">Supports the claim</option>
            <option value="contradicts">Contradicts the claim</option>
            <option value="context">Context only</option>
          </select>
        </Field>
        <Field label="Source title" required>
          <input className={inputCls} value={f.title} onChange={(e) => set("title", e.target.value)} />
        </Field>
        <Field label="Publisher">
          <input className={inputCls} value={f.publisher} onChange={(e) => set("publisher", e.target.value)} />
        </Field>
        <Field label="URL">
          <input className={inputCls} value={f.url} onChange={(e) => set("url", e.target.value)} placeholder="https://…" />
        </Field>
        <Field label="Publication date">
          <input type="date" className={inputCls} value={f.publishedAt} onChange={(e) => set("publishedAt", e.target.value)} />
        </Field>
      </div>
      <Field label="Relevant excerpt" required>
        <textarea className={`${inputCls} h-16`} value={f.excerpt} onChange={(e) => set("excerpt", e.target.value)} />
      </Field>
      <Field label="Page / section">
        <input className={inputCls} value={f.location} onChange={(e) => set("location", e.target.value)} />
      </Field>
      <Field label="Linked claims">
        <select multiple className={`${inputCls} h-28`} value={claimIds} onChange={(e) => setClaimIds(Array.from(e.target.selectedOptions).map((o) => o.value))}>
          {claims.map((c) => (
            <option key={c.id} value={c.id}>
              [{c.sourceLabel}] {c.text.slice(0, 110)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Linked criteria">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(CRITERION_SHORT) as CriterionId[]).map((c) => (
            <label key={c} className="flex items-center gap-1 text-[12px]">
              <input type="checkbox" checked={crit.includes(c)} onChange={(e) => setCrit(e.target.checked ? [...crit, c] : crit.filter((x) => x !== c))} />
              {CRITERION_SHORT[c]}
            </label>
          ))}
        </div>
      </Field>
      <Field label="Reviewer notes">
        <input className={inputCls} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
    </Modal>
  );
}

export function DecisionForm({ appId, recommendation }: { appId: string; recommendation?: string }) {
  const act = useStore((s) => s.act);
  const [decision, setDecision] = useState<PartnerDecisionType>("approve_call");
  const [reason, setReason] = useState<PassReason | "">("");
  const [rationale, setRationale] = useState("");
  return (
    <div>
      <div className="grid grid-cols-2 gap-1.5">
        {(Object.keys(DECISION_TYPE_LABEL) as PartnerDecisionType[]).map((k) => (
          <button key={k} onClick={() => setDecision(k)} className={`rounded-md border px-2 py-1.5 text-[12.5px] font-medium ${decision === k ? "border-navy-700 bg-navy-800 text-white" : "border-line-strong hover:bg-navy-50"}`}>
            {DECISION_TYPE_LABEL[k]}
          </button>
        ))}
      </div>
      {decision === "pass" && (
        <Field label="Pass reason" required>
          <select className={`${inputCls} mt-2`} value={reason} onChange={(e) => setReason(e.target.value as PassReason)}>
            <option value="">Choose…</option>
            {Object.entries(PASS_REASON_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Rationale" required>
        <textarea className={`${inputCls} mt-2 h-20`} value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder={recommendation ? `System suggested: ${recommendation}. Your reasoning…` : "Your reasoning…"} />
      </Field>
      <Button
        variant="gold"
        className="w-full"
        onClick={() => {
          const err = act((d, r) => {
            recordDecision(d, r, { applicationId: appId, decision, rationale, passReason: reason || undefined });
          }, `Decision recorded: ${DECISION_TYPE_LABEL[decision]}.${decision === "approve_call" ? " Slots proposed in Scheduling." : ""}`);
          if (!err) setRationale("");
        }}
      >
        Record decision as Kushal
      </Button>
      <p className="mt-1.5 text-[11px] text-faint">Approving a call is not approving an investment. Every decision is audited with your name, time and rationale.</p>
    </div>
  );
}

export function ReopenDialog({ open, onClose, appId }: { open: boolean; onClose: () => void; appId: string }) {
  const act = useStore((s) => s.act);
  const [reason, setReason] = useState("");
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Reopen application"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => !act((d, r) => reopen(d, r, appId, reason), "Reopened as a new cycle. History preserved.") && onClose()}>Reopen</Button>
        </>
      }
    >
      <p className="mb-2 text-[12.5px] text-muted">Reopening starts a new application cycle. Earlier decisions, evaluations and corrections stay on record under their original cycle.</p>
      <Field label="Reason" required>
        <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Founder returned with six months of cohort data" />
      </Field>
    </Modal>
  );
}
