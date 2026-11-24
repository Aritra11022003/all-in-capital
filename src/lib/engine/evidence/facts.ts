// P3 · Non-numeric "fact" claims (company name, founders and roles, founded/incorporated, stage, location,
// team size) with full provenance: document, page and the exact passage. Facts are applicant-provided claims
// like any other; they are compared across and within documents but never scored.
import type { Claim, ClaimOrigin, DocPage, DocumentRec, ExtractedField, FactKey } from "@/lib/shared/types";
import { foundersFromDeck, parseFounder } from "../extraction/form";
import { flat } from "../extraction/text";
import { normaliseCity, normaliseCompany, normalisePerson, normaliseRole, normaliseStage } from "./identity";

export const FACT_LABEL: Record<FactKey, string> = {
  company_name: "Company name",
  founder: "Founder",
  founder_role: "Founder role",
  founded: "Founded",
  incorporated: "Incorporated",
  stage: "Stage",
  location: "Location",
  team_size: "Team size",
};

type Uid = (p: string) => string;
const label = (d: DocumentRec, page: number | null) => `${d.kind === "deck" ? "Deck" : d.kind === "form" ? "Form" : "Doc"}${page ? ` p${page}` : ""}`;

function fact(uid: Uid, appId: string, cycleId: string, d: DocumentRec, page: number | null, key: FactKey, value: string, normalized: string, excerpt: string, extra: Partial<Claim> = {}): Claim {
  return {
    id: uid("clm"),
    applicationId: appId,
    cycleId,
    text: `${FACT_LABEL[key]}: ${value}`,
    metric: `fact:${key}`,
    sourceDocId: d.id,
    sourceKind: d.kind,
    sourceLabel: label(d, page),
    page,
    excerpt: excerpt.slice(0, 300),
    classification: "applicant_provided",
    criteria: [],
    fact: { key, value, normalized },
    ...extra,
  };
}

const year = (s: string) => /\b(19|20)\d{2}\b/.exec(s)?.[0] ?? null;
const firstInt = (s: string) => {
  const m = /\b(\d{1,4})\b/.exec(s);
  return m ? m[1] : null;
};

/** Facts from FORM answers (one fact per answer; provenance = the field's page and original text). */
export function factsFromFields(uid: Uid, appId: string, cycleId: string, fields: ExtractedField[], documents: DocumentRec[], origin: ClaimOrigin = "applicant", extra: Partial<Claim> = {}): Claim[] {
  const out: Claim[] = [];
  for (const f of fields) {
    if (!f.value || f.method !== "form-label") continue;
    const d = documents.find((x) => x.id === f.documentId);
    if (!d) continue;
    const base = (key: FactKey, value: string, normalized: string | null) => {
      if (!normalized) return;
      out.push(fact(uid, appId, cycleId, d, f.page, key, value, normalized, f.originalText || `${f.label} ${f.value}`, { fieldId: f.id, ...(origin === "human_correction" ? { origin } : {}), ...extra }));
    };
    const key = f.field.replace(/_\d+$/, "");
    if (key === "company_name") {
      const name = f.value.replace(/\([^)]*\)/g, "").trim();
      base("company_name", name, normaliseCompany(name).compact || null);
    } else if (/^founder$|^founder_\d$/.test(f.field)) {
      const p = parseFounder(f.value);
      if (p.name) {
        base("founder", p.name, normalisePerson(p.name).compact || null);
        const role = normaliseRole(p.role);
        if (role) base("founder_role", `${p.name}: ${p.role}`, `${normalisePerson(p.name).compact}=${role}`);
      }
    } else if (key === "incorporated") base("incorporated", f.value, year(f.value));
    else if (key === "stage") base("stage", f.value, normaliseStage(f.value));
    else if (key === "location") base("location", f.value, normaliseCity(f.value));
    else if (key === "team_size") base("team_size", f.value, firstInt(f.value));
  }
  return out;
}

const FOUNDED = /\b(founded|established|started|incorporated)\b(?:\s+(?:in|on))?\s+(?:[A-Z][a-z]+\s+)?((?:19|20)\d{2})\b/i;
const STAGE_ROUND = /\b(pre-?seed|seed|series\s+[a-e])\s+round\b/i;
const HQ = /\b(?:[Hh]eadquartered|[Bb]ased|HQ)\s+in\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/;
// A past round ("Seed round of INR 9 Cr raised in 2024") is history, not the current stage.
const PAST_ROUND = /\b(?:raised|closed|completed|previous|prior|last|earlier)\b|\bin (?:19|20)\d{2}\b/i;
const TEAM = /\bteam\s+(?:size|of)\s*:?\s*(\d{1,4})\b/i;

/** Facts from DECK pages (screened text): cover name/stage/location, team slide founders, explicit statements. */
export function factsFromDeck(uid: Uid, appId: string, cycleId: string, decks: DocumentRec[], pagesOf: (d: DocumentRec) => DocPage[]): Claim[] {
  const out: Claim[] = [];
  for (const d of decks) {
    const pages = pagesOf(d);
    const cover = pages[0]?.text.split("\n").map((l) => l.trim()).filter(Boolean) ?? [];
    // Same cover-name heuristic the pipeline already uses for the deck fallback.
    if (d === decks[0] && cover[0] && cover[0].length <= 40 && !/[|:]/.test(cover[0]) && !/^(MESA|CONFIDENTIAL|PITCH DECK|DECK)\b/i.test(cover[0])) {
      const n = normaliseCompany(cover[0]).compact;
      if (n) out.push(fact(uid, appId, cycleId, d, pages[0].index, "company_name", cover[0], n, cover.slice(0, 3).join(" | ")));
    }
    const coverLine = cover.find((l) => /raising|pre-?seed|\bseed\b|series/i.test(l)) ?? "";
    if (d === decks[0] && coverLine) {
      const st = normaliseStage(coverLine);
      if (st) out.push(fact(uid, appId, cycleId, d, pages[0].index, "stage", coverLine.match(/pre-?seed|\bseed\b|series\s+[a-e]/i)?.[0] ?? coverLine, st, coverLine));
      const loc = coverLine.split("|").map((s) => s.trim()).pop();
      const city = loc && !/raising|seed|series|INR|₹/i.test(loc) ? normaliseCity(loc) : null;
      if (loc && city) out.push(fact(uid, appId, cycleId, d, pages[0].index, "location", loc, city, coverLine));
    }
    for (const p of pages) {
      for (const line of p.text.split("\n").map((l) => l.trim()).filter(Boolean)) {
        const fm = FOUNDED.exec(line);
        if (fm) out.push(fact(uid, appId, cycleId, d, p.index, /incorporated/i.test(fm[1]) ? "incorporated" : "founded", fm[2], fm[2], line));
        const sm = STAGE_ROUND.exec(line);
        if (sm && p.index !== pages[0].index && !PAST_ROUND.test(line)) out.push(fact(uid, appId, cycleId, d, p.index, "stage", sm[1], normaliseStage(sm[1])!, line));
        const hq = HQ.exec(line);
        if (hq) {
          const c = normaliseCity(hq[1]);
          if (c) out.push(fact(uid, appId, cycleId, d, p.index, "location", hq[1], c, line));
        }
        const tm = TEAM.exec(line);
        if (tm) out.push(fact(uid, appId, cycleId, d, p.index, "team_size", tm[1], tm[1], line));
      }
    }
    for (const f of foundersFromDeck(pages)) {
      const line = pages.find((p) => p.index === f.page)?.text.split("\n").find((l) => l.includes(f.name)) ?? `${f.name}, ${f.role}`;
      const n = normalisePerson(f.name).compact;
      if (!n) continue;
      out.push(fact(uid, appId, cycleId, d, f.page, "founder", f.name, n, flat(line)));
      const role = normaliseRole(f.role);
      if (role) out.push(fact(uid, appId, cycleId, d, f.page, "founder_role", `${f.name}: ${f.role}`, `${n}=${role}`, flat(line)));
    }
  }
  return out;
}
