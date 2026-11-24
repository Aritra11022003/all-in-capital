// Investment assessment report: one structured object, rendered as a page and exported as Markdown.
import type { CriterionId } from "@/lib/shared/types";
import {
  CRITERION_SHORT,
  DECISION_LABEL,
  DECISION_TYPE_LABEL,
  EVIDENCE_STATE_LABEL,
  PASS_REASON_LABEL,
  PROCESSING_LABEL,
  RECOMMENDATION_LABEL,
  RELATIONSHIP_LABEL,
  SECTOR_LABEL,
  SOURCE_TYPE_LABEL,
} from "@/lib/shared/labels";
import { effectiveAssessment, effectiveOverall, getApp, latestEvaluation, latestOverlap, type WorkspaceData } from "@/lib/domain/workspace";
import { formatInr } from "../evidence/metrics";
import { WORKSTREAM_LABEL } from "../research/plan";
import { ROLE_INFO } from "@/lib/domain/permissions";

export interface ReportSection {
  id: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
  table?: { head: string[]; rows: string[][] };
}

export interface Report {
  appId: string;
  title: string;
  subtitle: string;
  simulatedBanner: string;
  generatedAt: string;
  sections: ReportSection[];
}

const CRIT_ORDER: CriterionId[] = ["founder_quality", "founder_market_fit", "market", "traction", "business_model", "product_tech", "path_to_market", "capital_fit", "thesis_fit"];

export function buildReport(d: WorkspaceData, appId: string): Report {
  const app = getApp(d, appId);
  const company = d.companies.find((c) => c.id === app.companyId);
  const founders = d.founders.filter((f) => f.companyId === app.companyId);
  const ev = latestEvaluation(d, appId);
  const ov = latestOverlap(d, appId);
  const conflicts = d.conflicts.filter((c) => c.applicationId === appId);
  const research = d.research.filter((r) => r.applicationId === appId);
  const decisions = d.decisions.filter((x) => x.applicationId === appId);
  const field = (k: string) => d.fields.find((f) => f.applicationId === appId && f.field === k && f.value)?.value ?? "Not provided";
  const crit = (id: CriterionId) => (ev ? effectiveAssessment(d, ev, id) : null);
  const sig = (id: CriterionId) => {
    const a = crit(id);
    if (!a) return ["No evaluation available."];
    return [
      `Score: ${a.score ?? "insufficient evidence"}/5 · Evidence: ${EVIDENCE_STATE_LABEL[a.evidenceState]} · Confidence: ${a.confidence}${a.corrected ? ` · Corrected by ${ROLE_INFO[a.corrected.reviewer].name}: "${a.corrected.reason}"` : ""}`,
      ...a.supporting.map((s) => `(+) ${s.text}${s.ref ? ` [${s.ref}]` : ""}`),
      ...a.opposing.map((s) => `(−) ${s.text}${s.ref ? ` [${s.ref}]` : ""}`),
      ...a.notes.map((s) => `(note) ${s.text}${s.ref ? ` [${s.ref}]` : ""}`),
      ...a.unknowns.map((u) => `(unknown) ${u}`),
    ];
  };
  const overall = ev ? effectiveOverall(d, ev) : null;
  const sections: ReportSection[] = [
    {
      id: "snapshot",
      title: "1. Company snapshot",
      paragraphs: [],
      table: {
        head: ["Field", "Value"],
        rows: [
          ["Company", `${app.name}${company?.legalName ? ` (${company.legalName})` : ""}`],
          ["One-liner", app.oneLiner ?? "Not provided"],
          ["Sector (selected / classified)", `${app.sectorSelected ?? "—"} / ${SECTOR_LABEL[app.sectorKey]}`],
          ["Stage", app.stage ?? "Not provided"],
          ["Raising", app.raiseInr ? formatInr(app.raiseInr) : "Not provided"],
          ["Valuation expectation", app.valuationInr ? `${formatInr(app.valuationInr)} post-money` : "Not provided"],
          ["Location / incorporated", `${company?.location ?? "—"} / ${company?.incorporated ?? "—"}`],
          ["Source", app.source ?? "Unknown"],
          ["Processing / decision status", `${PROCESSING_LABEL[app.processingStatus]} / ${DECISION_LABEL[app.decisionStatus]}`],
        ],
      },
    },
    {
      id: "executive",
      title: "2. Executive assessment",
      paragraphs: ev
        ? [
            `Suggested next action: ${RECOMMENDATION_LABEL[ev.recommendation]} (a recommendation, not a decision). Overall ${overall ?? "n/a"}/5 across ${Math.round(ev.coverage * 100)}% of criteria scored.`,
            ...ev.recommendationReasons,
          ]
        : ["Not yet evaluated."],
      bullets: ev?.flags.map((f) => `[${f.level}] ${f.text}`),
    },
    { id: "founders", title: "3. Founder analysis", paragraphs: founders.map((f) => `${f.name}${f.role ? `, ${f.role}` : ""} — ${f.background} [${f.sourceLabel}]`), bullets: [...sig("founder_quality"), "— Founder-market fit —", ...sig("founder_market_fit")] },
    { id: "market", title: "4. Market opportunity", paragraphs: [], bullets: sig("market") },
    { id: "traction", title: "5. Traction and validation", paragraphs: [`Customers: ${field("customers")}`, `Revenue: ${field("revenue")}`], bullets: sig("traction") },
    { id: "economics", title: "6. Business model and economics", paragraphs: [`Unit economics (as stated): ${field("unit_economics")}`], bullets: sig("business_model") },
    { id: "product", title: "7. Product and technology", paragraphs: [`What they have built: ${field("built")}`], bullets: sig("product_tech") },
    { id: "gtm", title: "8. Path to market", paragraphs: [`Acquisition: ${field("acquisition")}`], bullets: sig("path_to_market") },
    {
      id: "thesis",
      title: "9. Thesis comparison (stated vs revealed — not merged)",
      paragraphs: ev ? [`Stated thesis: ${ev.statedThesis.fit.replace(/_/g, " ")} — ${ev.statedThesis.detail}`] : [],
      table: ev ? { head: ["Revealed pattern", "Result", "Detail"], rows: ev.revealedThesis.map((r) => [r.patternId, r.result.replace(/_/g, " "), r.detail]) } : undefined,
      bullets: sig("capital_fit").map((x) => `Capital fit: ${x}`),
    },
    {
      id: "scorecard",
      title: "10. Criterion scorecard",
      paragraphs: ev ? [`Thesis ${ev.thesisVersionId} · Criteria ${ev.criteriaVersionId} · ${ev.providerLabel}${ev.appliedLearningRules.length ? ` · Learning rules applied: ${ev.appliedLearningRules.join(", ")}` : ""}`] : [],
      table: ev
        ? {
            head: ["Criterion", "Score", "Evidence", "Confidence", "Key unknown"],
            rows: CRIT_ORDER.map((id) => {
              const a = crit(id)!;
              return [CRITERION_SHORT[id], a.score === null ? "—" : String(a.score), EVIDENCE_STATE_LABEL[a.evidenceState], a.confidence, a.unknowns[0] ?? ""];
            }),
          }
        : undefined,
    },
    {
      id: "research",
      title: "11. External research",
      paragraphs: [`${research.filter((r) => r.status === "answered").length} of ${research.length} research tasks answered. Research is not complete because queries were generated.`],
      table: { head: ["Workstream", "Status", "Question / finding"], rows: research.map((r) => [WORKSTREAM_LABEL[r.workstream], r.status.replace(/_/g, " "), r.findings || r.question]) },
    },
    {
      id: "overlap",
      title: "12. Portfolio overlap",
      paragraphs: ov ? [ov.statusText, `Compared against ${ov.comparedCount} companies in ${ov.datasetVersion}: ${ov.comparedNames.join(", ")}. Reviewer decision: ${ov.reviewerDecision.replace(/_/g, " ")}.`] : ["Not checked."],
      bullets: ov?.results.map((r) => `${r.portfolioName}: ${RELATIONSHIP_LABEL[r.relationship]} (confidence ${r.confidence}) — ${r.evidence}`),
    },
    {
      id: "risks",
      title: "13. Risks and unknowns",
      paragraphs: [`Applicant-stated key risks: ${field("key_risks")}`],
      bullets: ev ? [...ev.criticalUnknowns.map((u) => `Critical: ${u}`), ...ev.assessments.flatMap((a) => a.unknowns.map((u) => `${CRITERION_SHORT[a.criterion]}: ${u}`))] : [],
    },
    {
      id: "conflicts",
      title: "14. Conflicting information",
      paragraphs: conflicts.length
        ? [
            "Every side is a founder-provided claim (or a reviewer's correction, which is not independent verification). 'Flag only' conflicts are shown for review and never change a score or recommendation. Superseded conflicts are kept as history.",
          ]
        : ["No conflicts detected between the submitted documents."],
      table: conflicts.length
        ? {
            head: ["Conflict", "Relation", "Scoring", "Values (source, page, passage)", "Status", "Resolution / reason"],
            rows: conflicts.map((c) => [
              c.label,
              (c.relation ?? "contradiction").replace(/_/g, " "),
              c.scoring === "flag_only" ? "flag only" : "scored",
              (c.values ?? [c.a, c.b]).map((v) => `${v.display} [${v.sourceLabel}${v.origin === "human_correction" ? ", human correction" : ""}${v.restored ? ", restored passage" : ""}${v.asOf ? `, as of ${v.asOf}` : ""}] "${v.excerpt.slice(0, 120)}"`).join(" · "),
              c.status,
              [c.resolutionNote ? `${c.resolutionNote}${c.resolvedBy ? ` (${c.resolvedBy})` : ""}` : "", c.supersededReason ?? ""].filter(Boolean).join(" — ") || "—",
            ]),
          }
        : undefined,
    },
    {
      id: "next",
      title: "15. Suggested next action",
      paragraphs: ev ? [`${RECOMMENDATION_LABEL[ev.recommendation]}. Final outcome requires Kushal's decision in the Partner Decision Room.`] : ["Evaluate first."],
      bullets: research.filter((r) => r.priority === "high" && r.status !== "answered").map((r) => `Before/at the call: ${r.question}`),
    },
    {
      id: "sources",
      title: "16. Sources",
      paragraphs: [],
      table: {
        head: ["Source", "Type", "Location", "Classification"],
        rows: [
          ...d.documents.filter((x) => x.applicationId === appId).map((x) => [x.filename, "Applicant document", `${x.pages.length} page(s), sha256 ${x.sha256.slice(0, 10) || "n/a"}`, x.status === "failed" ? `Unreadable: ${x.error}` : "Applicant-provided"]),
          ...d.evidence.filter((e) => e.applicationId === appId && e.addedBy !== "system").map((e) => [`${e.title} — ${e.publisher}${e.url ? ` (${e.url})` : ""}`, SOURCE_TYPE_LABEL[e.sourceType], e.location, e.verification]),
        ],
      },
    },
    {
      id: "audit",
      title: "17. Review and audit history",
      paragraphs: decisions.map((x) => `${DECISION_TYPE_LABEL[x.decision]} by ${ROLE_INFO[x.decidedBy].name} on ${x.decidedAt.slice(0, 16).replace("T", " ")}${x.passReason ? ` (${PASS_REASON_LABEL[x.passReason]})` : ""}: ${x.rationale}`),
      bullets: d.audit.filter((a) => a.applicationId === appId).slice(0, 25).map((a) => `${a.at.slice(0, 16).replace("T", " ")} · ${a.actor === "system" ? "System" : ROLE_INFO[a.actor].name} · ${a.action} · ${a.detail}`),
    },
  ];
  return {
    appId,
    title: `Investment assessment — ${app.name}`,
    subtitle: app.oneLiner ?? "",
    simulatedBanner: ev?.simulated
      ? `SIMULATED REPORT — generated by ${ev.providerLabel}. No external research was performed; every claim is applicant-provided unless a source says otherwise. This is decision support, not a decision.`
      : "Not yet evaluated.",
    generatedAt: new Date().toISOString(),
    sections,
  };
}

export function reportToMarkdown(r: Report): string {
  const out: string[] = [`# ${r.title}`, "", r.subtitle ? `_${r.subtitle}_` : "", "", `> ${r.simulatedBanner}`, "", `Generated ${r.generatedAt}`, ""];
  for (const s of r.sections) {
    out.push(`## ${s.title}`, "");
    for (const p of s.paragraphs) out.push(p, "");
    if (s.table && s.table.rows.length) {
      out.push(`| ${s.table.head.join(" | ")} |`, `| ${s.table.head.map(() => "---").join(" | ")} |`);
      for (const row of s.table.rows) out.push(`| ${row.map((c) => c.replace(/\|/g, "\\|").replace(/\n/g, " ")).join(" | ")} |`);
      out.push("");
    }
    if (s.bullets?.length) {
      for (const b of s.bullets) out.push(`- ${b}`);
      out.push("");
    }
  }
  return out.join("\n");
}
