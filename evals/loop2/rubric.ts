// Loop 2 (first email) rubric. Hard assertions are automated (judge: code). Soft assertions go to a human
// (judge: human) — no model is called. Every `actual` string is privacy-safe: counts, dates, record IDs,
// never founder names or email text.
import type { AssertionDef, CheckResult } from "../framework/types";

export interface Loop2Subject {
  /** The email under test (a system draft or Riya's final). */
  text: string;
  recordId: string;
  dateSent: string; // YYYY-MM-DD
  founderName: string;
  sector: string;
  founderType: string;
  background: string;
  tractionFacts: string[];
  /** Full names of every OTHER founder and every OTHER startup in the dataset (cross-record leak check). */
  otherNames: string[];
  startup: string;
}

// ------------------------------------------------------------------ parsing
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SLOT_RE = /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\b/g;
/** Fixed-date holidays only. Movable festivals (Diwali, Holi, Eid …) are NOT covered — see docs/EVALS.md. */
const FIXED_HOLIDAYS: Record<string, string> = { "01-01": "New Year's Day", "01-26": "Republic Day", "08-15": "Independence Day", "10-02": "Gandhi Jayanti", "12-25": "Christmas" };

export interface Slot {
  label: string;
  iso: string;
  weekdayOk: boolean;
  future: boolean;
  tueThu: boolean;
  daysAhead: number;
  holiday?: string;
}

export function parseSlots(text: string, dateSent: string): Slot[] {
  const y0 = +dateSent.slice(0, 4), m0 = +dateSent.slice(5, 7) - 1;
  return [...text.matchAll(SLOT_RE)].map((m) => {
    const mon = MONTHS.indexOf(m[3]);
    const y = mon < m0 - 6 ? y0 + 1 : y0; // a January slot sent in December belongs to next year
    const d = new Date(Date.UTC(y, mon, +m[2]));
    const iso = d.toISOString().slice(0, 10);
    const daysAhead = Math.round((d.getTime() - Date.parse(`${dateSent}T00:00:00Z`)) / 86400000);
    return { label: `${m[1]} ${m[2]} ${m[3]}`, iso, weekdayOk: DAYS[d.getUTCDay()] === m[1] && d.getUTCDate() === +m[2], future: iso > dateSent, tueThu: m[1] === "Tuesday" || m[1] === "Thursday", daysAhead, holiday: FIXED_HOLIDAYS[iso.slice(5)] };
  });
}

export interface ParsedEmail {
  paragraphs: string[];
  greeting: string;
  signoff: string;
  body: string[]; // between greeting and sign-off
  opening: string;
  slotParagraph: string | null;
  questionParagraphs: string[];
  slots: Slot[];
}

export function parseEmail(text: string, dateSent: string): ParsedEmail {
  const paragraphs = text.replace(/\r\n?/g, "\n").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const greeting = paragraphs[0] ?? "";
  const last = paragraphs[paragraphs.length - 1] ?? "";
  const hasSignoff = /^(Riya|Best regards|Kind regards|Regards|Warm regards|Thanks)/i.test(last) || /\bRiya\b/.test(last.split("\n").slice(-2).join(" "));
  const signoff = hasSignoff ? last : "";
  const body = paragraphs.slice(1, hasSignoff ? -1 : undefined);
  const isSlot = (p: string) => /30 minutes|30-minute/i.test(p) || new RegExp(SLOT_RE.source).test(p);
  const slotParagraph = body.find(isSlot) ?? null;
  const nonSlot = body.filter((p) => p !== slotParagraph);
  return { paragraphs, greeting, signoff, body, opening: nonSlot[0] ?? "", slotParagraph, questionParagraphs: nonSlot.filter((p) => p.includes("?")), slots: slotParagraph ? parseSlots(slotParagraph, dateSent) : [] };
}

// ------------------------------------------------------------------ lexicons (data-derived; see docs/EVALS.md)
/** Phrases that appear in rewritten system drafts and never in any email Riya sent (0/60). */
export const EMPTY_PRAISE = /\b(impressive|exciting|thrilled|congratulations|great to see|caught our eye|love backing|always excited|bold founders|ambitious founders|great milestone|real momentum|says a lot|exactly the kind|strong start)\b/i;
/**
 * Fund self-promotion (boilerplate) paragraphs, matched by STRUCTURE rather than copied wording: the fund's name
 * followed by "we", "we … back/support/work with … founders", "we love/are always …", "our partners", "how we work".
 * Verified to give the same verdict as the earlier phrase list on every draft and sent email in the private export.
 */
export const FUND_BOILERPLATE = /\bAll In Capital\b,?\s+we\b|\bwe\s+(?:\w+\s+){0,2}(?:back|backing|support|work (?:closely )?with)\s+(?:\w+\s+){0,1}founders?\b|\bwe\s+(?:love|are always|re always)\s+(?:backing|excited|keen)\b|\bour partners\b|\bhow we work\b/i;
const BEHAVIOUR_FACT = /(repeat|reorder|renew|again|second|every|retention|still|return|rebook|refill|list again|straight months|days a month|times a (month|season)|seasons|per month)/i;
const CONTACT = /([\w.+-]+@[\w-]+\.[a-z]{2,})|(\+91[\s-]?\d)|(\b[6-9]\d{9}\b)|(https?:\/\/|www\.)|(linkedin\.com)/i;

const nums = (s: string) => (s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, "").replace(/\.0+$/, ""));
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const NUMBER_WORDS: Record<string, string> = { one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12", fifteen: "15", twenty: "20", thirty: "30", forty: "40", fifty: "50", hundred: "100" };
/** Digits plus spelled-out numbers ("reorders within four weeks"). Used only for matching an opening to the facts —
 *  never for the invented-fact check, where common words like "one" would cause false alarms. */
const numsWithWords = (s: string) => [...nums(s), ...(s.toLowerCase().match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred)\b/g) ?? []).map((w) => NUMBER_WORDS[w])];

// ------------------------------------------------------------------ checks
export function checkFacts(s: Loop2Subject, p: ParsedEmail): CheckResult {
  const allowed = new Set(nums([...s.tractionFacts, s.background].join(" ")));
  // Only sentences that ASSERT something: a number inside a question ("in the last 30 days?") is a question
  // parameter, not a claim. (Calibration finding v1.1: two of Riya's own sends were wrongly flagged.)
  const statements = p.body.filter((x) => x !== p.slotParagraph).flatMap((x) => x.split(/(?<=[.!?])\s+/)).filter((x) => !x.trim().endsWith("?"));
  const used = statements.flatMap(nums);
  const invented = used.filter((n) => !allowed.has(n));
  return { pass: invented.length === 0, actual: invented.length ? `${invented.length} number(s) not present in the founder's facts: ${[...new Set(invented)].join(", ")}` : `${used.length} number(s), all traceable to the input facts` };
}

export function checkIdentity(s: Loop2Subject, p: ParsedEmail): CheckResult {
  const first = s.founderName.split(/\s+/)[0];
  const last = s.founderName.split(/\s+/).slice(-1)[0];
  const g = p.greeting.replace(/[,!]$/, "");
  const named = g.replace(/^(Hi|Hello|Dear|Hey)\s+/i, "").replace(/^(Ms|Mr|Mrs|Dr)\.?\s+/i, "").trim();
  const okGreeting = !named || named === first || named === last || named === s.founderName;
  const wrongStartup = s.otherNames.filter((n) => n.length > 3 && new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(s.text));
  return { pass: okGreeting && wrongStartup.length === 0, actual: `greeting addresses ${okGreeting ? "the correct founder" : "a DIFFERENT name"}; other founders/startups named: ${wrongStartup.length}` };
}

export function checkNoPersonalData(s: Loop2Subject): CheckResult {
  const contact = CONTACT.test(s.text);
  const leaked = s.otherNames.filter((n) => n.length > 3 && s.text.includes(n)).length;
  return { pass: !contact && leaked === 0, actual: `contact details: ${contact ? "PRESENT" : "none"}; other people/companies named: ${leaked}` };
}

export function checkAvailability(p: ParsedEmail): CheckResult {
  const bad = p.slots.filter((x) => !x.weekdayOk || !x.future || !x.tueThu);
  return { pass: bad.length === 0, actual: p.slots.length ? `${p.slots.length} slot(s): ${p.slots.map((x) => `${x.iso}${x.weekdayOk ? "" : " weekday-mismatch"}${x.future ? "" : " NOT-AFTER-SEND-DATE"}${x.tueThu ? "" : " not-Tue/Thu"}`).join("; ")}` : "no slots offered" };
}

export function loop2Assertions(opts: { soft: boolean }): AssertionDef<Loop2Subject>[] {
  const P = (s: Loop2Subject) => parseEmail(s.text, s.dateSent);
  const hard: AssertionDef<Loop2Subject>[] = [
    // Critical checks (user-specified): no invented facts, no incorrect availability, no personal-data disclosure.
    { id: "R1-facts", description: "R1/R10 Factual accuracy: every number stated as fact (outside questions and the scheduling line) appears in the founder's facts", kind: "hard", judge: "code", severity: "critical", check: (s) => checkFacts(s, P(s)) },
    { id: "R1-identity", description: "R1 Correct founder and company: greeting addresses this founder; no other founder or startup is named", kind: "hard", judge: "code", severity: "critical", check: (s) => checkIdentity(s, P(s)) },
    { id: "R7-availability", description: "R7/R10 Meeting availability is valid: real dates, after the send date, Tue/Thu only", kind: "hard", judge: "code", severity: "critical", check: (s) => checkAvailability(P(s)) },
    { id: "C3-personal-data", description: "No disclosure of personal information (emails, phones, URLs, other people's names)", kind: "hard", judge: "code", severity: "critical", check: (s) => checkNoPersonalData(s) },
    // High
    { id: "R2-specific-opening", description: "R2 Opening is specific: it cites at least one of this founder's traction facts", kind: "hard", judge: "code", severity: "high", check: (s) => { const p = P(s); const f = new Set(numsWithWords(s.tractionFacts.join(" "))); const hit = numsWithWords(p.opening).filter((n) => f.has(n)); return { pass: hit.length > 0, actual: hit.length ? `opening cites ${hit.length} fact number(s)` : "opening cites no traction fact" }; } },
    { id: "R4-no-praise", description: "R4 No unsupported praise (empty-praise phrases never used in sent emails)", kind: "hard", judge: "code", severity: "high", check: (s) => { const m = s.text.match(EMPTY_PRAISE); return { pass: !m, actual: m ? `praise phrase present: "${m[0].toLowerCase()}"` : "none" }; } },
    { id: "R5-one-question", description: "R5 Exactly one diligence question (outside the scheduling line), at most 30 words", kind: "hard", judge: "code", severity: "high", check: (s) => { const p = P(s); const qs = p.questionParagraphs.flatMap((x) => x.split(/(?<=\?)\s+/).filter((y) => y.includes("?"))); return { pass: qs.length === 1 && words(qs[0]) <= 30, actual: `${qs.length} question(s)${qs[0] ? `, ${words(qs[0])} words` : ""}` }; } },
    { id: "R6-call-request", description: "R6 Clear 30-minute call request with at least one specific date", kind: "hard", judge: "code", severity: "high", check: (s) => { const p = P(s); const ok = !!p.slotParagraph && /30 minutes|30-minute/i.test(p.slotParagraph) && p.slots.length > 0; return { pass: ok, actual: ok ? `30-minute request with ${p.slots.length} date(s)` : p.slotParagraph ? "request lacks 30 minutes or a date" : "no call request" }; } },
    { id: "R7-holiday-window", description: "R7 Slots avoid fixed public holidays and fall within 21 days of sending", kind: "hard", judge: "code", severity: "high", check: (s) => { const p = P(s); const bad = p.slots.filter((x) => x.holiday || x.daysAhead > 21); return { pass: bad.length === 0, actual: bad.length ? bad.map((x) => `${x.iso}${x.holiday ? ` (${x.holiday})` : ""}${x.daysAhead > 21 ? ` (+${x.daysAhead}d)` : ""}`).join("; ") : `${p.slots.length} slot(s) OK` }; } },
    { id: "R8-aditya", description: "R8 Aditya is included if and only if the startup is Deeptech", kind: "hard", judge: "code", severity: "high", check: (s) => { const has = /\bAditya\b/.test(s.text); const deep = s.sector === "Deeptech"; return { pass: has === deep, actual: `sector ${deep ? "Deeptech" : "not Deeptech"}; Aditya ${has ? "included" : "absent"}` }; } },
    { id: "R9-no-boilerplate", description: "R9 No generic fund boilerplate paragraph", kind: "hard", judge: "code", severity: "high", check: (s) => ({ pass: !FUND_BOILERPLATE.test(s.text), actual: FUND_BOILERPLATE.test(s.text) ? "boilerplate present" : "none" }) },
    // Low (style; logged, never blocks)
    { id: "R3-behaviour-metric", description: "R3 Opening uses a behavioural/repeat metric when the founder has one", kind: "hard", judge: "code", severity: "low", check: (s) => { const p = P(s); const bf = s.tractionFacts.filter((f) => BEHAVIOUR_FACT.test(f)); if (!bf.length) return { pass: true, actual: "no behavioural fact available (n/a)" }; const set = new Set(numsWithWords(bf.join(" "))); const hit = numsWithWords(p.opening).some((n) => set.has(n)); return { pass: hit, actual: hit ? "opens with a behavioural metric" : "opens with a non-behavioural metric" }; } },
    { id: "R7-two-slots-afternoon", description: "R7 Offers exactly two slots and says afternoon", kind: "hard", judge: "code", severity: "low", check: (s) => { const p = P(s); const ok = p.slots.length === 2 && /afternoon/i.test(p.slotParagraph ?? ""); return { pass: ok, actual: `${p.slots.length} slot(s); afternoon ${/afternoon/i.test(p.slotParagraph ?? "") ? "stated" : "not stated"}` }; } },
    { id: "R9-concise", description: "R9 Concise: at most 80 words in total", kind: "hard", judge: "code", severity: "low", check: (s) => ({ pass: words(s.text) <= 80, actual: `${words(s.text)} words` }) },
    { id: "R9-house-style", description: "R9 House style: 'Hi {first name}' greeting and 'Riya / All In Capital' sign-off", kind: "hard", judge: "code", severity: "low", check: (s) => { const p = P(s); const first = s.founderName.split(/\s+/)[0]; const g = new RegExp(`^Hi ${first},?$`).test(p.greeting); const so = /^Riya\s*\n\s*All In Capital$/.test(p.signoff); return { pass: g && so, actual: `greeting ${g ? "ok" : "differs"}; sign-off ${so ? "ok" : "differs"}` }; } },
  ];
  if (!opts.soft) return hard;
  const soft: AssertionDef<Loop2Subject>[] = [
    { id: "S1-opening-relevance", description: "S1 (human) Opening is specific to this founder and uses the most relevant metric", kind: "soft", judge: "human", severity: "high", rubric: "Would Riya keep this opening? It must be specific to this founder, built on the most decision-relevant fact (usually repeat behaviour), with no flattery.", reviewMaterial: (s) => `${s.recordId}\nFACTS: ${s.tractionFacts.join("; ")}\n---\n${s.text}` },
    { id: "S2-question-quality", description: "S2 (human) The diligence question probes the quality of the cited metric", kind: "soft", judge: "human", severity: "high", rubric: "Does the single question test whether the cited metric is real and durable (e.g. concentration, subsidy, cohort, who pays)? Generic questions ('biggest challenge', 'plans for scaling') fail.", reviewMaterial: (s) => `${s.recordId}\n---\n${s.text}` },
    { id: "S3-tone", description: "S3 (human) Professional, concise, peer-to-peer tone", kind: "soft", judge: "human", severity: "low", rubric: "Short, one clear ask, courteous, no hype, no pressure.", reviewMaterial: (s) => `${s.recordId}\n---\n${s.text}` },
  ];
  return [...hard, ...soft];
}

/** IDs of the assertions that make a draft "send-ready" (all critical + high hard checks). */
export const SEND_READY_IDS = ["R1-facts", "R1-identity", "R7-availability", "C3-personal-data", "R2-specific-opening", "R4-no-praise", "R5-one-question", "R6-call-request", "R7-holiday-window", "R8-aditya", "R9-no-boilerplate"];
