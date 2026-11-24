// Turns extracted documents into structured records: company, founders, fields, claims, conflicts and a profile.
import type {
  Application,
  Claim,
  Company,
  Conflict,
  CriterionId,
  DocKind,
  DocPage,
  DocumentRec,
  ExtractedField,
  ExtractionMethod,
  Founder,
  Role,
  SectorKey,
} from "@/lib/shared/types";
import { FORM_LABELS, foundersFromDeck, looksLikeForm, parseFormWithProvenance, parseFounder } from "./extraction/form";
import { flat } from "./extraction/text";
import { extractCounts, extractMoney, parseInr, type MetricHit } from "./evidence/metrics";
import { detectConflicts } from "./evidence/conflicts";
import { screenDocuments, spanLocation, type ScreeningSummary } from "./safety/untrusted";

export const uid = (p: string) => `${p}_${(globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)).replace(/-/g, "").slice(0, 12)}`;

export interface DocInput {
  filename: string;
  kind?: DocKind;
  pages: DocPage[];
  method: ExtractionMethod;
  sha256: string;
  size: number;
  warnings?: string[];
}

export interface DocBundle {
  deckPages: DocPage[];
  formPages: DocPage[];
  deckText: string;
  formText: string;
  formFounderText: string;
  allText: string;
}

export interface Profile {
  name: string;
  legalName: string | null;
  oneLiner: string | null;
  sectorSelected: string | null;
  sectorKey: SectorKey;
  tags: string[];
  stage: string | null;
  stageKey: "pre_seed" | "seed" | "series_a_plus" | "unknown";
  raiseInr: number | null;
  valuationInr: number | null;
  source: string | null;
  fields: Record<string, string>;
  founders: { name: string; role: string; background: string }[];
  hasDeck: boolean;
  hasForm: boolean;
  bundle: DocBundle;
  /** P2 C1/C2: founder text set aside as possible instructions or hypotheticals (not scored unless restored). */
  screening?: ScreeningSummary;
}

export interface Analysis {
  company: Company;
  founders: Founder[];
  documents: DocumentRec[];
  fields: ExtractedField[];
  claims: Claim[];
  conflicts: Conflict[];
  profile: Profile;
  appPatch: Partial<Application>;
  warnings: string[];
  screening?: ScreeningSummary;
}

export function classifyDoc(d: DocInput): DocKind {
  if (d.kind && d.kind !== "other") return d.kind;
  const n = d.filename.toLowerCase();
  if (/form|response|application|questionnaire/.test(n)) return "form";
  if (/deck|pitch|presentation|slides/.test(n)) return "deck";
  return looksLikeForm(d.pages) ? "form" : "deck";
}

const FIELD_CRITERIA: Record<string, CriterionId[]> = {
  founder_1: ["founder_quality", "founder_market_fit"],
  founder_2: ["founder_quality", "founder_market_fit"],
  founder_3: ["founder_quality", "founder_market_fit"],
  founder: ["founder_quality", "founder_market_fit"],
  time_commitment: ["founder_quality"],
  prior_startup: ["founder_quality"],
  earlier_cofounder: ["founder_quality"],
  equity: ["capital_fit"],
  built: ["product_tech"],
  liability: ["product_tech", "path_to_market"],
  customers: ["traction"],
  users: ["traction"],
  workers: ["traction"],
  advances: ["traction"],
  revenue: ["traction", "business_model"],
  volume: ["traction"],
  growth: ["traction"],
  repeat: ["traction"],
  evidence_of_value: ["traction", "product_tech"],
  unit_economics: ["business_model"],
  capex: ["business_model", "capital_fit"],
  credit_funding: ["business_model", "founder_quality"],
  credit_book: ["business_model"],
  defaults: ["business_model", "founder_quality"],
  advances_funding: ["business_model", "founder_quality"],
  regulatory_status: ["path_to_market"],
  acquisition: ["path_to_market", "business_model"],
  channel_mix: ["path_to_market"],
  dependencies: ["path_to_market"],
  competition: ["path_to_market", "market"],
  why_win: ["path_to_market"],
  key_risks: ["path_to_market"],
  raise: ["capital_fit"],
  valuation: ["capital_fit"],
  existing_investors: ["capital_fit"],
  use_of_funds: ["capital_fit"],
  other_investors: ["capital_fit"],
  stage: ["capital_fit"],
  sector: ["thesis_fit"],
  one_liner: ["thesis_fit", "product_tech"],
};

function metricCriteria(m: string): CriterionId[] {
  if (/^(cac|price|margin|capex|cost_total|revenue_net|revenue_gross)$/.test(m)) return ["business_model"];
  if (/^(raise|valuation)$/.test(m)) return ["capital_fit"];
  return ["traction"];
}

export function sectorKeyFrom(selected: string | null, text: string): SectorKey {
  const s = (selected ?? "").toLowerCase();
  if (/crypto|web3|blockchain/.test(s)) return "web3";
  if (/fintech|financ/.test(s)) return "fintech";
  if (/deep\s?tech/.test(s)) return "deeptech";
  if (/consumer brand|d2c/.test(s)) return "consumer_brand";
  if (/consumer tech/.test(s)) return "consumer_tech";
  if (/health/.test(s)) return "healthcare";
  if (s && !/other/.test(s)) return "other";
  const t = text.toLowerCase();
  if (/crypto|web3|blockchain|token/.test(t)) return "web3";
  if (/clinic|hospital|patient|diagnostic/.test(t)) return "healthcare";
  if (/\b(lending|loan|nbfc|payments?|credit card|invoice financing|wealth|insurance)\b/.test(t)) return "fintech";
  if (/sensor|robot|firmware|drone|aircraft|satellite|semiconductor|battery|hardware/.test(t)) return "deeptech";
  if (/\b(d2c|brand|skincare|snack|apparel|jewell?ery|beverage)\b/.test(t)) return "consumer_brand";
  if (/other/.test(s)) return "other";
  return text.trim() ? "consumer_tech" : "unknown";
}

export function tagsFrom(sector: SectorKey, text: string): string[] {
  const t = text.toLowerCase().replace(/credit\s+cards?/g, "card");
  const tags = new Set<string>();
  if (/\b(credit|loans?|lend(?:ing)?|nbfc|advances|financing|bnpl|earned wage|pay later|invoice financing)\b/.test(t)) tags.add("lending");
  if (sector === "deeptech" || /sensor|firmware|robot|drone|aircraft|evtol|satellite|semiconductor/.test(t)) tags.add("deeptech");
  if (/sensor|hardware|device|gateway|robot|drone|aircraft/.test(t)) tags.add("hardware");
  if (tags.has("lending") || /payment aggregator|card networks|rbi|clinic|patient|call-recording|recording restrictions|drone|aircraft|digital lending/.test(t)) tags.add("regulated");
  if (/\b(sme|smes|enterprise|teams|firms|retailers|stores|factories|plants|hr heads|employers)\b/.test(t)) tags.add("b2b");
  if (/\b(ai|model|machine learning|ml|language model)\b/.test(t)) tags.add("ai");
  if (/clinic|capex|inventory|working capital|dark store/.test(t)) tags.add("capital_intensive");
  return [...tags];
}

export function stageKey(stage: string | null): Profile["stageKey"] {
  const s = (stage ?? "").toLowerCase();
  if (!s) return "unknown";
  if (/pre-?seed|angel|idea/.test(s)) return "pre_seed";
  if (/series\s?[a-z]|growth|late/.test(s)) return "series_a_plus";
  if (/seed|early/.test(s)) return "seed";
  return "unknown";
}

function firstMoney(text: string | undefined | null): number | null {
  if (!text) return null;
  const m = /(?:\bINR|\bRs\.|₹)\s?(\d[\d,]*(?:\.\d+)?)\s*(lakh\s+Cr|lakhs?|L|Cr|crores?|K|thousand)?(?![\w])/i.exec(text);
  return m ? parseInr(m[1], m[2]) : null;
}

/** Reviewer-facing warnings for the current screening state (shared by first processing and re-evaluation). */
export const SCREENING_WARNING_RE = /passage\(s\) that read like instructions|hypothetical figure\(s\) were set aside|look-alike characters were normalised/;
export function screeningWarnings(screening: ScreeningSummary): string[] {
  const out: string[] = [];
  const setAside = screening.spans.filter((s) => !s.restored);
  const where = (xs: typeof setAside) => [...new Set(xs.map(spanLocation))].join(", ");
  const inst = setAside.filter((s) => s.kind === "suspected_instruction");
  const hyp = setAside.filter((s) => s.kind === "hypothetical");
  if (inst.length) out.push(`${inst.length} passage(s) that read like instructions to the evaluator were set aside and not scored (${where(inst)}). Review them in the Documents tab; a flag is a prompt for review, not proof of intent.`);
  if (hyp.length) out.push(`${hyp.length} hypothetical figure(s) were set aside and not scored as reported results (${where(hyp)}).`);
  if (screening.normalisedPages?.length) out.push(`Hidden or look-alike characters were normalised on ${[...new Set(screening.normalisedPages.map(spanLocation))].join(", ")}.`);
  return out;
}

export function analyseDocuments(opts: {
  applicationId: string;
  cycleId: string;
  actor: Role;
  now: string;
  docs: DocInput[];
  nameHint?: string;
  /** Span IDs a reviewer has explicitly restored (re-processing only; empty on first intake). */
  restoredSpanIds?: Iterable<string>;
}): Analysis {
  const { applicationId: appId, cycleId, actor, now } = opts;
  const warnings: string[] = [];
  const documents: DocumentRec[] = opts.docs.map((d) => ({
    id: uid("doc"),
    applicationId: appId,
    cycleId,
    kind: classifyDoc(d),
    filename: d.filename,
    ext: d.filename.split(".").pop()?.toLowerCase() ?? "",
    size: d.size,
    sha256: d.sha256,
    uploadedBy: actor,
    uploadedAt: now,
    method: d.method,
    pages: d.pages,
    status: "extracted",
    warnings: d.warnings ?? [],
  }));
  // P2 C1/C2: screen founder text ONCE, before anything reads it. Stored document pages stay original.
  const screening = screenDocuments(documents.map((d) => ({ id: d.id, kind: d.kind, pages: d.pages })), opts.restoredSpanIds);
  const screened = (d: DocumentRec) => screening.pagesByDoc[d.id] ?? d.pages;
  const decks = documents.filter((d) => d.kind === "deck");
  const forms = documents.filter((d) => d.kind === "form");
  if (decks.length > 1) warnings.push(`${decks.length} documents look like decks; all are used, the first is primary.`);
  if (forms.length > 1) warnings.push(`${forms.length} documents look like forms; the first is used for fields.`);
  if (!decks.length) warnings.push("No pitch deck supplied — deck-only evidence is unavailable and deck/form cross-checks were skipped.");
  if (!forms.length) warnings.push("No application form supplied — structured fields were inferred from the deck where possible.");

  const deckPages = decks.flatMap((d) => screened(d));
  const formPages = forms[0] ? screened(forms[0]) : [];
  warnings.push(...screeningWarnings(screening));
  const deckText = deckPages.map((p) => p.text).join("\n");
  const formText = formPages.map((p) => p.text).join("\n");

  // --- fields
  const fields: ExtractedField[] = [];
  const fieldMap: Record<string, string> = {};
  if (forms[0]) {
    const parsed = parseFormWithProvenance(formPages);
    for (const u of parsed.unattached) warnings.push(`Unlabelled text on Form p${u.page} after the last answer was not attached to any answer: "${u.text.slice(0, 80)}${u.text.length > 80 ? "…" : ""}"`);
    for (const f of parsed.fields) {
      fields.push({
        id: uid("fld"),
        applicationId: appId,
        documentId: forms[0].id,
        field: f.field,
        label: f.label,
        value: f.value || null,
        originalText: f.originalText,
        page: f.page,
        method: "form-label",
        validation: f.value ? "parsed" : "missing",
        confidence: f.value ? 0.9 : 0,
        extractedAt: now,
      });
      if (f.value && !(f.field in fieldMap)) fieldMap[f.field] = f.value;
    }
  }
  // deck fallbacks for core identity fields
  const deck0 = decks[0];
  const cover = (deck0 ? screened(deck0) : [])[0]?.text.split("\n").map((l) => l.trim()).filter(Boolean) ?? [];
  const coverLine = cover.find((l) => /raising|pre-?seed|seed|series/i.test(l)) ?? "";
  const derive = (field: string, value: string | null, page: number, original: string) => {
    if (!value || fieldMap[field] || !deck0) return;
    fieldMap[field] = value;
    fields.push({
      id: uid("fld"),
      applicationId: appId,
      documentId: deck0.id,
      field,
      label: `${field} (from deck)`,
      value,
      originalText: original,
      page,
      method: "deck-pattern",
      validation: "parsed",
      confidence: 0.6,
      extractedAt: now,
    });
  };
  const coverName = cover[0] && cover[0].length <= 40 && !/[|:]/.test(cover[0]) && !/^(MESA|CONFIDENTIAL|PITCH DECK|DECK)\b/i.test(cover[0]) ? cover[0] : null;
  derive("company_name", coverName ?? opts.nameHint ?? null, 1, cover.join(" | "));
  derive("one_liner", cover[1] && !/raising|pre-?seed|series/i.test(cover[1]) ? cover[1] : null, 1, cover.join(" | "));
  const stageM = /(pre-?seed|seed|series [a-e])/i.exec(coverLine);
  derive("stage", stageM ? stageM[1] : null, 1, coverLine);
  const raiseM = /raising\s+(INR|Rs\.?|₹)\s?[\d.,]+\s*(?:Cr|L|lakh|crore)?/i.exec(coverLine) ?? /raising\s+(INR|Rs\.?|₹)\s?[\d.,]+\s*(?:Cr|L|lakh|crore)?/i.exec(flat(deckText));
  derive("raise", raiseM ? raiseM[0].replace(/^raising\s+/i, "") : null, 1, coverLine);
  const locM = coverLine.split("|").map((s) => s.trim()).pop();
  derive("location", locM && !/raising|seed|series/i.test(locM) ? locM : null, 1, coverLine);

  // mark expected-but-missing core fields explicitly (never invented)
  for (const core of ["company_name", "one_liner", "sector", "stage", "raise", "customers", "revenue", "acquisition", "use_of_funds"]) {
    if (!fieldMap[core] && !(core === "customers" && (fieldMap.users || fieldMap.workers)) && !(core === "revenue" && fieldMap.volume)) {
      fields.push({
        id: uid("fld"),
        applicationId: appId,
        documentId: forms[0]?.id ?? deck0?.id ?? "",
        field: core,
        label: FORM_LABELS[core]?.[0] ?? core,
        value: null,
        originalText: "",
        page: null,
        method: "derived",
        validation: "missing",
        confidence: 0,
        extractedAt: now,
      });
    }
  }

  // --- company + founders
  const rawName = fieldMap.company_name ?? "Unnamed applicant";
  const nameM = /^([^(]+?)\s*\(([^)]+)\)/.exec(rawName);
  const company: Company = {
    id: uid("co"),
    name: (nameM ? nameM[1] : rawName).trim().slice(0, 80),
    legalName: nameM ? nameM[2].trim() : null,
    website: fieldMap.website?.split(/\s/)[0] ?? null,
    location: fieldMap.location ?? null,
    incorporated: fieldMap.incorporated ?? null,
  };
  const founderFields = fields.filter((f) => /^founder(_\d)?$/.test(f.field) && f.value);
  let founders: Founder[] = founderFields.map((f) => {
    const p = parseFounder(f.value!);
    return { id: uid("fd"), companyId: company.id, name: p.name, role: p.role, background: p.background, profileUrl: p.profileUrl, sourceLabel: `Form p${f.page}` };
  });
  if (!founders.length && deck0) {
    founders = foundersFromDeck(deckPages).map((p) => ({ id: uid("fd"), companyId: company.id, name: p.name, role: p.role, background: p.background, sourceLabel: `Deck p${p.page}` }));
  }
  if (!founders.length) warnings.push("No founder information could be extracted.");

  // --- claims
  const claims: Claim[] = [];
  const docLabel = (d: DocumentRec, page: number | null) => `${d.kind === "deck" ? "Deck" : d.kind === "form" ? "Form" : "Doc"}${page ? ` p${page}` : ""}`;
  for (const f of fields) {
    if (!f.value) continue;
    const d = documents.find((x) => x.id === f.documentId)!;
    claims.push({
      id: uid("clm"),
      applicationId: appId,
      cycleId,
      text: `${f.label.replace(/ \(from deck\)$/, "")}: ${f.value}`,
      sourceDocId: d.id,
      sourceKind: d.kind,
      sourceLabel: docLabel(d, f.page),
      page: f.page,
      excerpt: f.originalText.slice(0, 300),
      classification: "applicant_provided",
      criteria: FIELD_CRITERIA[f.field.replace(/_\d+$/, "")] ?? [],
    });
  }
  for (const d of documents) {
    for (const p of screened(d)) {
      const hits: MetricHit[] = [...extractMoney(p.text), ...extractCounts(p.text)];
      const seen = new Set<string>();
      for (const h of hits) {
        const k = `${h.metric}|${h.value}|${h.projection}`;
        if (seen.has(k)) continue;
        seen.add(k);
        claims.push({
          id: uid("clm"),
          applicationId: appId,
          cycleId,
          text: `${h.display}${h.projection ? " (projection / market sizing)" : ""}`,
          metric: h.projection ? `projection:${h.metric}` : h.metric,
          value: h.value,
          bound: h.bound,
          unit: h.unit,
          period: h.period,
          sourceDocId: d.id,
          sourceKind: d.kind,
          sourceLabel: docLabel(d, p.index),
          page: p.index,
          excerpt: h.excerpt,
          classification: "applicant_provided",
          criteria: h.projection ? ["market"] : metricCriteria(h.metric.split(":")[0] === "count" ? "count" : h.metric),
        });
      }
      if (d.kind === "deck") {
        const title = p.text.split("\n")[0]?.trim();
        if (title && title.length > 6 && p.index > 1) {
          claims.push({
            id: uid("clm"),
            applicationId: appId,
            cycleId,
            text: `Deck slide headline: "${title}"`,
            sourceDocId: d.id,
            sourceKind: "deck",
            sourceLabel: docLabel(d, p.index),
            page: p.index,
            excerpt: flat(p.text).slice(0, 300),
            classification: "applicant_provided",
            criteria: [],
          });
        }
      }
    }
  }

  const bundle: DocBundle = {
    deckPages,
    formPages,
    deckText,
    formText,
    formFounderText: founderFields.map((f) => f.value).join("\n") + "\n" + (fieldMap.prior_startup ?? ""),
    allText: `${deckText}\n${formText}`,
  };
  const conflicts = detectConflicts(appId, claims, bundle);
  for (const c of conflicts) {
    for (const s of [c.a, c.b]) {
      const cl = claims.find((x) => x.id === s.claimId);
      if (cl) cl.classification = "conflicting";
    }
  }

  const sectorSelected = fieldMap.sector ?? null;
  const sectorKey = sectorKeyFrom(sectorSelected, bundle.allText);
  const modelText = [fieldMap.one_liner, fieldMap.built, fieldMap.credit_funding, fieldMap.advances_funding, fieldMap.dependencies, fieldMap.key_risks, deckText].join(" ");
  const tags = tagsFrom(sectorKey, modelText);
  const stage = fieldMap.stage ?? null;
  const profile: Profile = {
    name: company.name,
    legalName: company.legalName,
    oneLiner: fieldMap.one_liner ?? null,
    sectorSelected,
    sectorKey,
    tags,
    stage,
    stageKey: stageKey(stage),
    raiseInr: firstMoney(fieldMap.raise) ?? firstMoney(raiseM?.[0]),
    valuationInr: firstMoney(fieldMap.valuation),
    source: fieldMap.heard_from ?? null,
    fields: fieldMap,
    founders: founders.map((f) => ({ name: f.name, role: f.role, background: f.background })),
    hasDeck: decks.length > 0,
    hasForm: forms.length > 0,
    bundle,
    screening: { spans: screening.spans, normalisedPages: screening.normalisedPages },
  };
  const appPatch: Partial<Application> = {
    name: company.name,
    oneLiner: profile.oneLiner,
    sectorSelected,
    sectorKey,
    tags,
    stage,
    raiseInr: profile.raiseInr,
    valuationInr: profile.valuationInr,
    source: /introduc|referr|warm/i.test(profile.source ?? "") ? "Warm introduction" : profile.source ? "Public application form" : null,
  };
  return { company, founders, documents, fields, claims, conflicts, profile, appPatch, warnings, screening: { spans: screening.spans, normalisedPages: screening.normalisedPages } };
}
