// Research planning. Generates specific questions per workstream with a source-quality hierarchy.
// No research is performed in demo mode: every task starts "not_started" and says why.
import type { Conflict, ResearchTask, Workstream } from "@/lib/shared/types";
import type { Profile } from "../pipeline";

export const SOURCE_TIERS: { tier: number; name: string }[] = [
  { tier: 1, name: "Government and regulatory sources" },
  { tier: 2, name: "Official company records" },
  { tier: 3, name: "Named customers and partners" },
  { tier: 4, name: "Company websites and product documentation" },
  { tier: 5, name: "Credible independent media" },
  { tier: 6, name: "Professional profiles" },
  { tier: 7, name: "Directories and aggregators (leads only)" },
];

export const WORKSTREAM_LABEL: Record<Workstream, string> = {
  company_verification: "Company verification",
  founder_background: "Founder background",
  product_technology: "Product and technology",
  customers_traction: "Customers and traction",
  market: "Market opportunity",
  competition: "Competition",
  regulatory: "Regulatory environment",
  business_model: "Business model and economics",
  distribution: "Distribution",
  portfolio_overlap: "Portfolio overlap",
};

export const NO_PROVIDER_NOTE =
  "Not started — no research provider is configured. MockAIProvider cannot search the web; a reviewer must research and log sources manually.";

export function planResearch(appId: string, p: Profile, conflicts: Conflict[]): ResearchTask[] {
  const name = p.name;
  const t = p.bundle.allText;
  const tasks: Omit<ResearchTask, "id" | "applicationId" | "status" | "sourcesExamined" | "findings" | "conflicts" | "reviewerStatus" | "providerNote" | "linkedClaimIds">[] = [];
  const S = (tier: number, nm: string, note: string) => ({ tier, name: nm, note });
  const isPlaceholder = /\.example\b|-example\b/.test(t);

  tasks.push({
    workstream: "company_verification",
    question: `Does ${p.legalName ?? name} exist as stated (incorporation ${p.fields.incorporated ?? "date not given"}, ${p.fields.location ?? "location not given"})? Confirm CIN, directors and registered address.`,
    priority: "high",
    suggestedSources: [S(2, "MCA21 company master data", "CIN, incorporation date, directors"), S(1, "GST portal (taxpayer search)", "Active GSTIN and trade name"), S(4, p.fields.website ?? "Company website", isPlaceholder ? "Website in the application is a placeholder (.example) — cannot be checked" : "Product claims only")],
    unanswered: [],
  });
  for (const f of p.founders) {
    const extra = /chartered accountant/i.test(f.background) ? [S(1, "ICAI member verification", "Confirm CA membership")] : /MBBS|medicine|Dr\./i.test(`${f.name} ${f.background}`) ? [S(1, "National Medical Commission register", "Confirm medical registration")] : [];
    tasks.push({
      workstream: "founder_background",
      question: `Verify ${f.name}'s background: "${f.background.slice(0, 140)}". Does employment history support the claimed role and tenure?`,
      priority: conflicts.some((c) => c.type === "credential") ? "high" : "medium",
      suggestedSources: [...extra, S(2, "MCA21 director records (DIN)", "Other directorships"), S(6, "Professional profile (LinkedIn)", "Supports employment history only, not execution quality"), S(5, "Media / talks", "Independent mentions")],
      unanswered: [],
    });
  }
  tasks.push({
    workstream: "product_technology",
    question: `Is the product live as described ("${(p.fields.built ?? p.oneLiner ?? "").slice(0, 120)}")? Any public docs, app listing or demo?`,
    priority: p.tags.includes("deeptech") ? "high" : "medium",
    suggestedSources: [S(4, "Product documentation / app store listing", "Existence and release history"), S(3, "Named customer references", "Actual use"), ...(p.tags.includes("deeptech") ? [S(3, "Technical reference call (Aditya)", "Feasibility and calibration")] : [])],
    unanswered: [],
  });
  const tractionConflicts = conflicts.filter((c) => c.criteria.includes("traction"));
  tasks.push({
    workstream: "customers_traction",
    question: tractionConflicts.length
      ? `Resolve traction conflicts: ${tractionConflicts.map((c) => c.label).join("; ")}. Which figures are current and how are they defined?`
      : `Can any named customer or partner confirm usage and payment? (${p.fields.customers ?? p.fields.users ?? "customer count not given"})`,
    priority: tractionConflicts.length ? "high" : "medium",
    suggestedSources: [S(3, "Customer reference calls", "Ask the founder for 2–3 references"), S(2, "Bank statement / MIS extract (request from founder)", "Revenue confirmation")],
    unanswered: [],
  });
  tasks.push({
    workstream: "market",
    question: `Independent sizing for ${p.oneLiner ?? name}: are the deck's market assumptions consistent with public data?`,
    priority: "low",
    suggestedSources: [S(1, "Government statistics (MoSPI, Udyam, RBI data)", "Base populations"), S(5, "Industry reports in credible media", "Cross-check")],
    unanswered: [],
  });
  tasks.push({
    workstream: "competition",
    question: /no direct competitors/i.test(t) ? `The applicant claims "no direct competitors". Identify existing players offering the same product in India.` : `Who are the closest competitors and how funded are they? Applicant lists: ${(p.fields.competition ?? "none listed").slice(0, 120)}.`,
    priority: /no direct competitors/i.test(t) ? "high" : "medium",
    suggestedSources: [S(5, "Credible independent media", "Funding and launches"), S(7, "Startup directories", "Leads only — verify elsewhere")],
    unanswered: [],
  });
  if (p.tags.includes("regulated") || p.tags.includes("lending") || p.tags.includes("deeptech")) {
    const reg = p.tags.includes("lending")
      ? "RBI Digital Lending Directions; NBFC registration status of the company and its partner (RBI NBFC list)"
      : /rent|card/i.test(t)
        ? "RBI / card-network rules on rent payments via payment aggregators"
        : /clinic|patient/i.test(t)
          ? "Clinical Establishments Act registration; diagnostic lab accreditation"
          : /call-recording|recording/i.test(t)
            ? "Telecom / IT rules on call recording and consent; data protection (DPDP Act)"
            : "Certification and safety approvals required for the hardware";
    tasks.push({
      workstream: "regulatory",
      question: `What regulatory permissions does ${name} need, and does it have them? Focus: ${reg}.`,
      priority: "high",
      suggestedSources: [S(1, "Primary regulator publications (RBI, MeitY, CDSCO, BIS, DGCA as relevant)", "Rules and registers"), S(2, "Company's own licences / partner agreement (request)", "Proof of status")],
      unanswered: [],
    });
  }
  tasks.push({
    workstream: "business_model",
    question: `Check unit economics: ${p.fields.unit_economics ?? "CAC, margin and payback not fully reported"}. Request the underlying cohort / MIS data.`,
    priority: "medium",
    suggestedSources: [S(2, "Founder-supplied MIS / cohort sheet", "Primary data"), S(3, "Customer references", "Pricing paid")],
    unanswered: [],
  });
  tasks.push({
    workstream: "distribution",
    question: `Is the acquisition channel repeatable beyond the founders? (${(p.fields.acquisition ?? "not described").slice(0, 120)})`,
    priority: "medium",
    suggestedSources: [S(3, "Named channel partners", "Confirm the partnership exists"), S(4, "Marketplace / listing presence", "Visibility")],
    unanswered: [],
  });
  tasks.push({
    workstream: "portfolio_overlap",
    question: `Confirm or dismiss possible overlaps with portfolio companies. The internal portfolio list is incomplete — check the full Fund I/II list.`,
    priority: "high",
    suggestedSources: [S(2, "Fund's own portfolio register (internal)", "Full list, not memory"), S(4, "Portfolio company websites", "Current product scope")],
    unanswered: [],
  });

  return tasks.map((x, i) => ({
    ...x,
    id: `rt_${appId}_${i + 1}`,
    applicationId: appId,
    status: "not_started",
    sourcesExamined: [],
    findings: "",
    conflicts: "",
    reviewerStatus: "pending",
    providerNote: NO_PROVIDER_NOTE,
    linkedClaimIds: [],
  }));
}
