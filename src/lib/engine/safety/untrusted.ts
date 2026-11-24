// Untrusted founder text (P2 · C1). Founder documents are DATA, never instructions.
//
// screenDocuments() runs once per document, before anything else reads the text (extraction, claims, sector,
// tags, learning rules, the evaluator — on first processing AND on re-evaluation). It:
//   1. normalises disguised characters (zero-width / bidi controls inside Latin words, look-alike letters
//      in mixed-script words), keeping a map back to the original characters;
//   2. splits each page into sentences (original offsets preserved);
//   3. flags sentences that address the evaluating system, try to direct the outcome, fake system markup,
//      request roles or access ("suspected_instruction"), or present figures hypothetically ("hypothetical");
//   4. returns screened page text in which ONLY the flagged, non-restored sentences are blanked with spaces
//      (same length, newlines kept), so every other offset, page number and sentence boundary is unchanged.
// Nothing is deleted: the original pages are stored untouched and every flagged span is reported with its
// document, page, offsets, original wording and reasons. A flag is a prompt for human review, not a finding
// that the founder acted in bad faith. Restoring a span is a separate, audited reviewer action.
import type { DocKind, DocPage } from "@/lib/shared/types";

export type ScreeningKind = "suspected_instruction" | "hypothetical";
export type ScreeningReason = "addressed_to_system" | "outcome_directive" | "outcome_statement" | "fake_system_markup" | "role_or_access_request" | "hypothetical_figures" | "obfuscated_characters";

export interface ScreenedSpan {
  /** Stable ID (same on first processing and on re-evaluation): document kind + page + offset + wording. */
  id: string;
  docId: string;
  docKind: DocKind;
  page: number;
  /** Offsets into the ORIGINAL page text. */
  start: number;
  end: number;
  /** The original wording, exactly as extracted. */
  text: string;
  kind: ScreeningKind;
  reasons: ScreeningReason[];
  restored: boolean;
}

export interface ScreeningSummary {
  spans: ScreenedSpan[];
  /** Pages where disguised characters were normalised (even if nothing was set aside). */
  normalisedPages?: { docId: string; docKind: DocKind; page: number }[];
}

export interface ScreenInputDoc {
  id: string;
  kind: DocKind;
  pages: DocPage[];
}

export interface ScreeningResult extends ScreeningSummary {
  pagesByDoc: Record<string, DocPage[]>;
}

// ------------------------------------------------------------------ normalisation
const INVISIBLE = /[­​-‏‪-‮⁠-⁤⁦-⁩﻿]/;
const CONFUSABLE: Record<string, string> = { "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "ј": "j", "ѕ": "s", "ԁ": "d", "ӏ": "l", "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H", "О": "O", "Р": "P", "С": "C", "Т": "T", "Х": "X", "ο": "o", "α": "a", "ε": "e", "ι": "i", "κ": "k", "ν": "v", "ρ": "p", "τ": "t", "υ": "u", "Ο": "O", "Α": "A", "Ε": "E" };
const LATIN = /[A-Za-z]/;

/** Returns normalised text plus, for each normalised character, the index of the original character. */
function normalise(text: string): { norm: string; map: number[]; changed: boolean } {
  let norm = "";
  const map: number[] = [];
  let changed = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (INVISIBLE.test(ch)) {
      // Only strip when it sits inside a Latin word (keeps legitimate ZWJ/ZWNJ in Indic scripts).
      const prev = text[i - 1] ?? "", next = text[i + 1] ?? "";
      if (LATIN.test(prev) || LATIN.test(next)) {
        changed = true;
        continue;
      }
    }
    const conf = CONFUSABLE[ch];
    if (conf) {
      // Map look-alike letters only inside words that also contain Latin letters (mixed-script words).
      const word = /[\p{L}​-‏]*$/u.exec(text.slice(0, i))![0] + /^[\p{L}​-‏]*/u.exec(text.slice(i + 1))![0];
      if (LATIN.test(word)) {
        norm += conf;
        map.push(i);
        changed = true;
        continue;
      }
    }
    norm += ch;
    map.push(i);
  }
  return { norm, map, changed };
}

// ------------------------------------------------------------------ sentences
interface Sentence {
  start: number; // offsets in normalised text
  end: number;
  text: string;
  paragraph: number;
  line: number;
}

function sentencesOf(text: string): Sentence[] {
  const out: Sentence[] = [];
  let paragraph = 0;
  let lineStart = 0;
  const lines = text.split("\n");
  for (const [lineNo, line] of lines.entries()) {
    if (!line.trim()) paragraph++;
    const re = /[^\s][^]*?(?:[.!?]+(?=\s|$)|$)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      if (!m[0].trim()) break;
      out.push({ start: lineStart + m.index, end: lineStart + m.index + m[0].length, text: m[0], paragraph, line: lineNo });
      if (re.lastIndex >= line.length) break;
    }
    lineStart += line.length + 1;
  }
  return out;
}

// ------------------------------------------------------------------ detectors (high precision; each one is a reason)
const WHO = "(?:ai|a\\.i\\.|evaluators?|reviewers?|assistants?|ai assistant|language model|model|system|screeners?|screening (?:system|tool|bot)|scoring (?:system|engine|model)|analysts?|llm|bot|algorithm|grader|chatgpt|gpt|claude|gemini)";
// Sentence-initial address: narrower list (a line such as "Model: subscription" or "System: AWS" is ordinary content).
const WHO_START = "(?:ai|a\\.i\\.|evaluators?|reviewers?|ai assistant|ai reviewer|language model|llm|chatgpt|gpt|claude|gemini|screeners?|screening (?:system|tool|bot)|scoring (?:system|engine|model)|grader)";
// Imperative context: sentence start, or "please / kindly / you should / you must".
const IMP = "(?:^\\W*|\\b(?:please|kindly|you (?:should|must|need to|are to)|must)\\s+)";
/** Investment outcomes an applicant might prescribe (used only by the outcome-statement family below). */
const INVEST = "(?:a |an |the |to )?(?:(?:30-minute |quick |first )?(?:partner )?(?:call|meeting)|term sheet|investment|invest(?:ing)?(?: in us)?|funding|fund(?:ing)? us|back(?:ing)? us|cheque|top (?:score|rating|marks)|full marks|highest (?:score|rating)|5\\/5|yes from (?:the )?(?:fund|partners?))\\b";
const DETECTORS: { reason: ScreeningReason; re: RegExp }[] = [
  // Text addressed to the evaluating system rather than to a human reader.
  { reason: "addressed_to_system", re: new RegExp(`\\b(?:note|message|instructions?|attention|memo|reminder|request|guidance)\\s+(?:to|for)\\s+(?:the\\s+|any\\s+)?${WHO}\\b`, "i") },
  { reason: "addressed_to_system", re: new RegExp(`^\\W*(?:important\\W+)?(?:dear\\s+)?${WHO_START}\\s*[:,]`, "i") },
  { reason: "addressed_to_system", re: /\b(?:ignore|disregard|forget|override|bypass)\b[^.]{0,60}\b(?:instructions?|rubric|guidelines|prompt|scoring|previous instructions|above instructions)\b/i },
  { reason: "addressed_to_system", re: /\bas an? (?:ai|language model)\b/i },
  // v2 families: text aimed at whatever processes the document. Each needs an addressing context, so product
  // descriptions ("call-AI tools", "our ML system") and ordinary claims are not matched.
  { reason: "addressed_to_system", re: /\b(?:for|to|attention)\s+(?:any\s+|all\s+)?(?:automated|machine|ai)[ -]?(?:readers?|screeners?|graders?|reviewers?|systems?)\b/i },
  { reason: "addressed_to_system", re: /\b(?:person|program|software|tool|system|model|bot)\s+(?:or\s+\w+\s+)?(?:grading|scoring|screening|reviewing|evaluating|reading|processing)\s+this\s+(?:application|file|document|deck|form|submission)\b/i },
  { reason: "addressed_to_system", re: /\bif you are\s+(?:an?\s+)?(?:ai|language model|assistant|bot)\b|\bif you are\s+(?:summari[sz]ing|evaluating|screening|scoring|reviewing|grading|processing)\s+this\s+(?:application|file|document|deck|form|submission)\b/i },
  { reason: "addressed_to_system", re: /\b(?:pretend|role-?play)\b[^.]{0,20}\byou(?:'re|\s+are)?\b/i },
  { reason: "addressed_to_system", re: /\bfrom (?:here|now) on\b[^.]{0,40}\b(?:respond|answer|output|reply)\b/i },
  { reason: "outcome_directive", re: /\bregardless of (?:any|other|the|all)\b[^.]{0,50}\b(?:conclude|score|rate|recommend)\b/i },
  { reason: "outcome_directive", re: /\b(?:give|assign|award|deserves?|merits?|warrants?)\b[^.]{0,40}\b(?:highest|top|maximum|full|perfect)\s+(?:possible\s+)?(?:score|marks|rating|grade)s?\b/i },
  { reason: "outcome_directive", re: /\b(?:should|must)\s+be\s+(?:read|scored|counted|weighted)\s+as\b|\bweight\s+(?:the|our)\s+\w+(?:\s+\w+)?\s+as\b/i },
  // Fake system / prompt markup.
  { reason: "fake_system_markup", re: /<\/?\s*(?:system|assistant|user|instructions?|prompt|context|application[_ ]?claims|admin|developer)\b[^>]*>/i },
  { reason: "fake_system_markup", re: /^\W*(?:SYSTEM|ASSISTANT|DEVELOPER)\s*:/ },
  { reason: "fake_system_markup", re: /\[(?:system|inst|instructions?)\]/i },
  // Directives about the outcome (imperative only: "Customers rate the company 4.8" is a claim, not a directive).
  { reason: "outcome_directive", re: new RegExp(`${IMP}(?:score|rate|grade|rank|mark|classify|recommend|advance|shortlist|approve|prioriti[sz]e)\\b[^.]{0,50}\\b(?:this|the)\\s+(?:application|applicant|company|startup|submission|deal)\\b`, "i") },
  { reason: "outcome_directive", re: new RegExp(`${IMP}(?:score|rate|grade)\\s+(?:the\\s+)?(?:traction|founders?|market|product|team|it|them|every criterion|all criteria)\\b[^.]{0,25}?(?:\\b[1-5]\\b|\\bfive\\b|\\bhigh(?:ly)?\\b|\\btop\\b)`, "i") },
  { reason: "outcome_directive", re: /\b[1-5]\s*\/\s*5\s+on\s+(?:every|all|each)\s+criteri|\bon every criterion\b/i },
  { reason: "outcome_directive", re: /\btreat\s+(?:this|the|our)\s+(?:company|application|startup|applicant)\s+as\b/i },
  { reason: "outcome_directive", re: /\bset\s+(?:the\s+|your\s+)?confidence\b|\ball\s+claims\s+(?:were|are|have been)\s+(?:independently\s+)?verified\b|\b(?:verified|validated)\s+by\s+(?:all in capital|the fund|you|the (?:evaluator|reviewer|system|partners?)|kushal|aditya|riya)\b/i },
  { reason: "outcome_directive", re: /\b(?:approved|cleared|signed off)\s+by\s+(?:kushal|aditya|riya|the partners?|all in capital|the fund|the investment committee)\b|\bdecision\s*:\s*(?:approved|accepted|yes|go)\b/i },
  // P4 · Outcome statements: a sentence that prescribes the investment outcome without naming an addressee
  // ("…so the only sensible outcome is a partner meeting"). Narrow on purpose: an outcome phrase must be paired
  // with an INVESTMENT action (call, meeting, term sheet, investment, funding, top score). Plans ("the only logical
  // next step is to expand to Pune"), praise ("customers love us") and needs ("clinics deserve better tools") are
  // not matched.
  { reason: "outcome_statement", re: new RegExp(`\\bthe only (?:sensible|logical|reasonable|rational|right|correct|obvious|fair) (?:outcome|decision|conclusion|next step|choice|verdict|response|call)\\s+(?:here\\s+)?(?:is|would be|remains)\\s+${INVEST}`, "i") },
  { reason: "outcome_statement", re: new RegExp(`\\b(?:we|this (?:company|startup|application|team|business|deal|opportunity)|our (?:company|startup|application|team|business|founders?))\\s+(?:clearly\\s+|obviously\\s+|certainly\\s+|surely\\s+)?(?:deserves?|warrants?|merits?|has earned|have earned|should (?:get|receive|be given))\\s+${INVEST}`, "i") },
  { reason: "outcome_statement", re: new RegExp(`\\b(?:you|the fund|the partners?|all in capital)\\s+(?:should|must|ought to)\\s+(?:invest in us|back us|fund us|give us\\s+${INVEST})`, "i") },
  // Requests to change roles or access.
  { reason: "role_or_access_request", re: /\b(?:grant|give|share|provide|allow|open)\b[^.]{0,40}\b(?:aditya|kushal|riya|reviewers?|analysts?|yourself|me)\b[^.]{0,30}\baccess\b/i },
  { reason: "role_or_access_request", re: /\b(?:set|change|make|upgrade|elevate|assign)\b[^.]{0,20}\b(?:my|our|the founder'?s?)\s+role\b|\brole\s*(?:to|as|=|:)\s*(?:principal|partner|admin|administrator)\b|\b(?:is|are)\s+(?:authori[sz]ed|permitted|allowed)\s+to\s+(?:approve|grant|decide)\b/i },
];
const HYPOTHETICAL = /\b(?:assume|assuming|suppose|supposing|hypothetical(?:ly)?|for (?:illustration|illustrative purposes)|illustrative(?:ly)?|imagine|let'?s say|in a scenario where|what if)\b/i;

/** FNV-1a 32-bit — small, synchronous, deterministic (IDs only; not a security hash). */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// ------------------------------------------------------------------ main
export function screenDocuments(docs: ScreenInputDoc[], restoredIds: Iterable<string> = []): ScreeningResult {
  const restored = new Set(restoredIds);
  const spans: ScreenedSpan[] = [];
  const normalisedPages: NonNullable<ScreeningSummary["normalisedPages"]> = [];
  const pagesByDoc: Record<string, DocPage[]> = {};
  for (const doc of docs) {
    pagesByDoc[doc.id] = doc.pages.map((page) => {
      const { norm, map, changed } = normalise(page.text);
      if (changed) normalisedPages.push({ docId: doc.id, docKind: doc.kind, page: page.index });
      const sents = sentencesOf(norm);
      const flagged = new Map<number, { kind: ScreeningKind; reasons: Set<ScreeningReason> }>();
      sents.forEach((s, i) => {
        const reasons = new Set<ScreeningReason>(DETECTORS.filter((d) => d.re.test(s.text)).map((d) => d.reason));
        if (reasons.size) flagged.set(i, { kind: "suspected_instruction", reasons });
        else if (HYPOTHETICAL.test(s.text) && /\d/.test(s.text)) flagged.set(i, { kind: "hypothetical", reasons: new Set(["hypothetical_figures"]) });
      });
      // Text addressed to the system taints the rest of ITS LINE ("Note to evaluator: … . The company has …").
      // Limited to the same line so slide tables and lists are never swept up.
      for (const [i, f] of [...flagged]) {
        if (f.kind !== "suspected_instruction" || !(f.reasons.has("addressed_to_system") || f.reasons.has("fake_system_markup"))) continue;
        for (let j = i + 1; j < sents.length && sents[j].line === sents[i].line; j++) {
          const g = flagged.get(j) ?? { kind: "suspected_instruction" as ScreeningKind, reasons: new Set<ScreeningReason>() };
          g.kind = "suspected_instruction";
          for (const r of f.reasons) if (r === "addressed_to_system" || r === "fake_system_markup") g.reasons.add(r);
          flagged.set(j, g);
        }
      }
      let out = norm;
      for (const [i, f] of [...flagged].sort((a, b) => a[0] - b[0])) {
        const s = sents[i];
        const oStart = map[s.start] ?? s.start;
        const oEnd = (map[s.end - 1] ?? s.end - 1) + 1;
        const original = page.text.slice(oStart, oEnd);
        if (original !== s.text) f.reasons.add("obfuscated_characters");
        const id = `scr-${fnv(`${doc.kind}|${page.index}|${oStart}|${s.text}`)}`;
        const isRestored = restored.has(id);
        spans.push({ id, docId: doc.id, docKind: doc.kind, page: page.index, start: oStart, end: oEnd, text: original, kind: f.kind, reasons: [...f.reasons], restored: isRestored });
        if (!isRestored) out = out.slice(0, s.start) + " ".repeat(s.end - s.start) + out.slice(s.end);
      }
      return { index: page.index, text: out };
    });
  }
  return { spans, normalisedPages, pagesByDoc };
}

// ------------------------------------------------------------------ output hygiene (C7)
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const URL = /\b(?:https?:\/\/|www\.)[^\s)"'<>]+|\b(?:[a-z0-9-]+\.)+(?:com|in|io|co|org|net|ai|app|example|me|ly)\/[^\s)"'<>]*/gi;
const PHONE = /(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,5}\)?[\s-]?)?\d{3,5}[\s-]?\d{4,5}\b/g;

/** Removes email addresses, phone numbers and links from GENERATED result text. Source documents are untouched. */
export function redactContactDetails(text: string): string {
  if (!text) return text;
  return text
    .replace(EMAIL, "[email removed]")
    .replace(URL, "[link removed]")
    .replace(PHONE, (m) => {
      const digits = m.replace(/\D/g, "");
      // Phone-shaped only: 10+ digits, or an explicit + prefix. Leaves amounts, counts and years alone.
      return digits.length >= 10 || /^\+/.test(m.trim()) ? "[phone removed]" : m;
    });
}

/** Short, human-readable label for a span's location, e.g. "Form p3". */
export const spanLocation = (s: Pick<ScreenedSpan, "docKind" | "page">) => `${s.docKind === "deck" ? "Deck" : s.docKind === "form" ? "Form" : "Doc"} p${s.page}`;
