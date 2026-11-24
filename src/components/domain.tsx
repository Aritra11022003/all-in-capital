"use client";
import Link from "next/link";
import { AlertTriangle, ArrowLeftRight, FlaskConical, Info, ShieldAlert } from "lucide-react";
import type { Conflict, Confidence, DecisionStatus, EvidenceClass, EvidenceState, ProcessingStatus, Recommendation, Signal } from "@/lib/shared/types";
import { DECISION_LABEL, EVIDENCE_CLASS_LABEL, EVIDENCE_STATE_LABEL, PROCESSING_LABEL, RECOMMENDATION_LABEL } from "@/lib/shared/labels";
import { Badge, cx, type Tone } from "./ui";

export function ProcessingBadge({ s }: { s: ProcessingStatus }) {
  const tone: Tone = s === "ready_for_review" ? "teal" : s === "failed" ? "risk" : s === "needs_attention" ? "warn" : "navy";
  return (
    <Badge tone={tone} title="Processing status (technical). Separate from the decision status.">
      {!["ready_for_review", "failed", "needs_attention"].includes(s) && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {PROCESSING_LABEL[s]}
    </Badge>
  );
}

export function DecisionBadge({ s }: { s: DecisionStatus }) {
  const tone: Tone = s === "call_approved" ? "ok" : s === "passed_by_partner" ? "neutral" : s === "on_hold" ? "warn" : s === "awaiting_partner_review" ? "gold" : s === "information_requested" ? "navy" : s === "reopened" ? "gold" : "neutral";
  return (
    <Badge tone={tone} title="Decision status (human). Only Kushal can set a final outcome.">
      {DECISION_LABEL[s]}
    </Badge>
  );
}

export function RecBadge({ r, simulated = true }: { r: Recommendation; simulated?: boolean }) {
  const tone: Tone = r === "take_call" ? "teal" : r === "request_info" ? "gold" : "neutral";
  return (
    <Badge tone={tone} title="AI recommendation — not a decision.">
      {simulated && <FlaskConical size={11} />}
      {RECOMMENDATION_LABEL[r]}
    </Badge>
  );
}

export function ScorePill({ score, size = "md" }: { score: number | null; size?: "sm" | "md" }) {
  if (score === null || score === undefined)
    return (
      <span title="Insufficient evidence — unknown is not zero" className={cx("num inline-flex items-center justify-center rounded border border-dashed border-line-strong font-semibold text-faint", size === "sm" ? "h-5 w-8 text-[11px]" : "h-6 w-10 text-[12px]")}>
        n/a
      </span>
    );
  const bg = score >= 4 ? "bg-teal-600 text-white" : score >= 3 ? "bg-navy-600 text-white" : score >= 2 ? "bg-gold-100 text-gold-700" : "bg-risk-50 text-risk-700";
  return <span className={cx("num inline-flex items-center justify-center rounded font-semibold", bg, size === "sm" ? "h-5 w-8 text-[11px]" : "h-6 w-10 text-[12px]")}>{score.toFixed(score % 1 ? (String(score).split(".")[1]?.length ?? 1) > 1 ? 2 : 1 : 0)}</span>;
}

export function EvidenceBadge({ s }: { s: EvidenceState }) {
  const tone: Tone = s === "strong" ? "teal" : s === "mixed" ? "navy" : s === "weak" ? "neutral" : s === "conflicting" ? "risk" : "warn";
  return <Badge tone={tone}>{EVIDENCE_STATE_LABEL[s]}</Badge>;
}

export function ConfidenceBadge({ c }: { c: Confidence }) {
  return (
    <Badge tone={c === "high" ? "ok" : c === "medium" ? "navy" : "neutral"} title="Confidence is capped at medium until independent evidence is attached.">
      {c} conf.
    </Badge>
  );
}

export function ClassBadge({ c }: { c: EvidenceClass }) {
  const tone: Tone = c === "corroborated" ? "ok" : c === "independent" ? "teal" : c === "conflicting" ? "risk" : c === "inaccessible" ? "warn" : c === "unverified" ? "warn" : "neutral";
  return <Badge tone={tone}>{EVIDENCE_CLASS_LABEL[c]}</Badge>;
}

export function SimulatedBanner({ label }: { label?: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-gold-100 bg-gold-50 px-3 py-2 text-[12px] text-gold-700">
      <FlaskConical size={14} className="mt-0.5 shrink-0" />
      <div>
        <span className="font-semibold">Simulated output — {label ?? "MockAIProvider v1"}.</span> Rule-based reading of the submitted documents only. No external research was performed and no claim has been independently verified. Recommendations are not decisions.
      </div>
    </div>
  );
}

export function SignalList({ items, kind }: { items: Signal[]; kind: "support" | "oppose" | "note" }) {
  if (!items.length) return <div className="text-[12px] text-faint">None.</div>;
  return (
    <ul className="space-y-1">
      {items.map((s, i) => (
        <li key={i} className="flex gap-2 text-[12.5px]">
          <span className={cx("num mt-0.5 w-9 shrink-0 text-right text-[11px] font-semibold", kind === "support" ? "text-teal-700" : kind === "oppose" ? "text-risk-700" : "text-faint")}>
            {s.effect ? (s.effect > 0 ? `+${s.effect}` : s.effect) : "·"}
          </span>
          <span className="flex-1">
            {s.text}
            {s.ref && <span className="ml-1.5 rounded bg-navy-50 px-1 py-px font-mono text-[10.5px] text-navy-600" title="Source: stored document page">{s.ref}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

const RELATION_LABEL: Record<string, string> = {
  contradiction: "Contradiction",
  different_period: "Different period",
  different_definition: "Different definition",
  possibly_updated: "Possibly updated",
  one_sided: "One-sided",
  possible_match: "Possible match",
};

export function ConflictCard({ c, onResolve }: { c: Conflict; onResolve?: () => void }) {
  const values = c.values ?? [c.a, c.b];
  const superseded = c.status === "superseded";
  const flagOnly = c.scoring === "flag_only";
  return (
    <div className={cx("rounded-md border", c.status === "open" ? "border-risk-700/25" : "border-line", superseded && "opacity-75")}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-risk-50/40 px-3 py-1.5">
        <div className="flex items-center gap-2 font-medium text-ink">
          <ArrowLeftRight size={14} className="text-risk-700" />
          {c.label}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={c.relation && c.relation !== "contradiction" ? "neutral" : "risk"}>{RELATION_LABEL[c.relation ?? "contradiction"] ?? c.relation}</Badge>
          <span title={flagOnly ? "Shown for review only. Does not change any score or recommendation." : "Counts in scoring (existing rule) while open."}>
            <Badge tone={flagOnly ? "neutral" : "warn"}>{flagOnly ? "flag only" : "scored"}</Badge>
          </span>
          <Badge tone={c.severity === "high" ? "risk" : c.severity === "medium" ? "warn" : "neutral"}>{c.severity}</Badge>
          <Badge tone={c.status === "open" ? "risk" : superseded ? "neutral" : "ok"}>{c.status}</Badge>
          {onResolve && !superseded && (
            <button onClick={onResolve} className="text-[12px] font-medium text-teal-700 hover:underline">
              Review
            </button>
          )}
        </div>
      </div>
      <div className={cx("grid grid-cols-1 divide-y divide-line", values.length === 2 && "md:grid-cols-2 md:divide-x md:divide-y-0")}>
        {values.map((s, i) => (
          <div key={`${s.claimId}-${i}`} className="px-3 py-2">
            <div className="mb-0.5 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
              Value {i + 1} <span className="rounded bg-navy-50 px-1 font-mono normal-case text-navy-600">{s.sourceLabel}</span>
              {s.origin === "human_correction" && <span className="rounded bg-warn-50 px-1 normal-case text-warn-700" title="A reviewer's correction. Not independent verification.">human correction</span>}
              {s.restored && <span className="rounded bg-warn-50 px-1 normal-case text-warn-700" title="From a passage a reviewer restored. Still an unverified founder claim.">restored passage · unverified</span>}
              {s.asOf && <span className="rounded bg-navy-50 px-1 normal-case text-navy-600">as of {s.asOf}</span>}
            </div>
            <div className="font-medium">{s.display}</div>
            <div className="mt-1 line-clamp-3 font-mono text-[11px] text-muted">“{s.excerpt}”</div>
          </div>
        ))}
      </div>
      <div className="border-t border-line px-3 py-1.5 text-[12px] text-muted">
        {c.note}
        {c.resolutionNote && (
          <div className="mt-1 text-ink">
            <span className="font-medium">Reviewer:</span> {c.resolutionNote}
          </div>
        )}
        {c.supersededReason && (
          <div className="mt-1 text-ink">
            <span className="font-medium">Superseded:</span> {c.supersededReason}
          </div>
        )}
      </div>
    </div>
  );
}

export function FlagRow({ level, text }: { level: "critical" | "warning" | "info"; text: string }) {
  const Icon = level === "critical" ? ShieldAlert : level === "warning" ? AlertTriangle : Info;
  return (
    <div className={cx("flex items-start gap-2 text-[12.5px]", level === "critical" ? "text-risk-700" : level === "warning" ? "text-warn-700" : "text-navy-700")}>
      <Icon size={14} className="mt-0.5 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

export function AppLink({ id, name }: { id: string; name: string }) {
  return (
    <Link href={`/applications/${id}`} className="font-medium text-navy-800 hover:text-teal-700 hover:underline">
      {name}
    </Link>
  );
}
