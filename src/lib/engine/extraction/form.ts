// Parses application-form responses ("Label value" layout, labels possibly wrapped across lines).
import type { DocPage } from "@/lib/shared/types";

export interface ParsedField {
  field: string;
  label: string;
  value: string;
  page: number;
  originalText: string;
}

// canonical key -> printed labels (longest first is enforced at runtime)
export const FORM_LABELS: Record<string, string[]> = {
  company_name: ["Company name", "Company"],
  website: ["Website"],
  location: ["Location", "Headquarters"],
  incorporated: ["Incorporated", "Date of incorporation"],
  one_liner: ["One-line description", "One line description", "Tagline"],
  sector: ["Sector (as selected)", "Sector"],
  stage: ["Stage (as selected)", "Stage"],
  team_size: ["Team size"],
  founder_1: ["Founder 1"],
  founder_2: ["Founder 2"],
  founder_3: ["Founder 3"],
  founder: ["Founder"],
  time_commitment: ["Time commitment"],
  prior_startup: ["Prior startup experience"],
  earlier_cofounder: ["Earlier co-founder"],
  equity: ["Equity split"],
  built: ["What have you built?"],
  customers: ["Active customers", "Customers"],
  users: ["Users"],
  workers: ["Workers"],
  advances: ["Advances"],
  advances_funding: ["Funding of advances"],
  revenue: ["Revenue / GMV", "Revenue", "Volume and revenue"],
  volume: ["Rent volume"],
  growth: ["Growth"],
  repeat: ["Repeat behaviour", "Repeat"],
  channel_mix: ["Channel mix"],
  unit_economics: ["Unit economics"],
  acquisition: ["Customer acquisition", "Patient acquisition"],
  capex: ["Capex"],
  liability: ["Accuracy and liability"],
  dependencies: ["Dependencies"],
  evidence_of_value: ["Evidence of value"],
  competition: ["Who else is doing this?", "Competition"],
  why_win: ["Why will you win?"],
  key_risks: ["Key risks"],
  credit_funding: ["How is credit funded?"],
  credit_book: ["Credit book size"],
  defaults: ["Defaults to date"],
  regulatory_status: ["Regulatory status"],
  raise: ["Amount raising"],
  valuation: ["Valuation expectation"],
  existing_investors: ["Existing investors"],
  use_of_funds: ["Use of funds"],
  other_investors: ["Other investors in conversation"],
  heard_from: ["How did you hear about us?"],
  anything_else: ["Anything else we should know?"],
};

export const FIELD_DISPLAY: Record<string, string> = Object.fromEntries(
  Object.entries(FORM_LABELS).map(([k, v]) => [k, v[v.length > 1 && k === "customers" ? 1 : 0].replace(/\?$/, "")]),
);

// Single words that also appear as ordinary prose at the start of wrapped lines.
const GENERIC = new Set(["Customers", "Users", "Workers", "Advances", "Revenue", "Growth", "Repeat", "Competition", "Dependencies", "Company", "Founder"]);

const SECTION_HEADERS = [
  "Company",
  "Founders",
  "Product and traction",
  "Fundraising",
  "Credit",
  "Competition and differentiation",
  "Application Form Response",
];

const NOISE_LINE = /^(ALL IN CAPITAL|MESA |All In Capital —|Submitted through|Responses are reproduced|them\. Pair with|Pair with the applicant)/i;

function esc(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function looksLikeForm(pages: DocPage[]): boolean {
  const text = pages.map((p) => p.text).join("\n");
  if (/Application Form Response|INBOUND APPLICATION/i.test(text)) return true;
  return parseForm(pages).length >= 6;
}

export function parseForm(pages: DocPage[]): ParsedField[] {
  // Concatenate pages, remembering offsets for provenance.
  let full = "";
  const offsets: { start: number; page: number }[] = [];
  for (const p of pages) {
    const lines = p.text.split("\n").filter((l) => !NOISE_LINE.test(l.trim()));
    offsets.push({ start: full.length, page: p.index });
    full += lines.join("\n") + "\n";
  }
  const pageAt = (i: number) => {
    let pg = offsets[0]?.page ?? 1;
    for (const o of offsets) if (o.start <= i) pg = o.page;
    return pg;
  };

  type Hit = { field: string; label: string; start: number; end: number };
  const hits: Hit[] = [];
  const all: { field: string; label: string }[] = [];
  for (const [field, labels] of Object.entries(FORM_LABELS)) for (const label of labels) all.push({ field, label });
  all.sort((a, b) => b.label.length - a.label.length);

  for (const { field, label } of all) {
    const words = label.split(" ").map(esc).join("\\s+");
    const re = new RegExp(`(^|\\n)(${words})(?=[\\s:]|$)`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(full))) {
      const start = m.index + m[1].length;
      const end = start + m[2].length;
      if (hits.some((h) => start < h.end && end > h.start)) continue; // already claimed by a longer label
      if (GENERIC.has(label) && !lineBoundaryOk(full, start)) continue;
      // "Company" and "Founder" alone on a line are section headers, not labels.
      const restOfLine = full.slice(end).split("\n")[0].trim();
      if ((label === "Company" || label === "Credit") && restOfLine === "") continue;
      const wholeLine = (label + " " + restOfLine).trim();
      if (SECTION_HEADERS.includes(wholeLine)) continue;
      hits.push({ field, label, start, end });
    }
  }
  hits.sort((a, b) => a.start - b.start);

  const out: ParsedField[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    const next = hits[i + 1]?.start ?? full.length;
    let raw = full.slice(h.end, next);
    // drop trailing section headers
    const lines = raw.split("\n").map((l) => l.trim());
    while (lines.length && (SECTION_HEADERS.includes(lines[lines.length - 1]) || lines[lines.length - 1] === "")) lines.pop();
    raw = lines.join("\n");
    const value = raw
      .replace(/^[\s:]+/, "")
      .replace(/\s*\n\s*/g, " ")
      .replace(/-\s(?=[a-z])/g, "-")
      .trim();
    const key = seen.has(h.field) ? `${h.field}_${i}` : h.field;
    seen.add(h.field);
    out.push({
      field: key,
      label: h.label,
      value,
      page: pageAt(h.start),
      originalText: `${h.label} ${value}`.slice(0, 400),
    });
  }
  return out;
}

function lineBoundaryOk(full: string, start: number): boolean {
  if (start === 0) return true;
  const before = full.slice(0, start).replace(/\n$/, "");
  const prevLine = before.split("\n").pop()?.trim() ?? "";
  if (prevLine === "") return true;
  if (SECTION_HEADERS.includes(prevLine)) return true;
  return /[.?!)%]$/.test(prevLine) || /\.$/.test(prevLine);
}

export interface ParsedFounder {
  name: string;
  role: string;
  background: string;
  profileUrl?: string;
}

export function parseFounder(value: string): ParsedFounder {
  let v = value.replace(/\s+/g, " ").trim();
  // "Name, Role LinkedIn: … Background: …" layout
  const bg = /Background:\s*(.*)$/i.exec(v);
  if (bg) {
    const head = v.slice(0, bg.index).replace(/LinkedIn:.*$/i, "").trim();
    const [name, ...role] = head.split(",");
    const url0 = /linkedin\.com\/in\/[\w-]+/i.exec(v)?.[0];
    return { name: name.trim(), role: role.join(",").trim(), background: bg[1].trim(), profileUrl: url0 };
  }
  const url = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[\w-]+(?:\s?-\s?[\w-]+)*/i.exec(v)?.[0]?.replace(/\s/g, "");
  v = v
    .replace(/LinkedIn:\s*/i, "")
    .replace(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[\w-]+(?:\s?-\s?[\w-]+)*/i, "")
    .replace(/Background:\s*/i, "")
    .trim();
  const m = /^((?:Dr\.\s)?[A-Z][\w'-]*(?:\s[A-Z][\w'.-]*){0,3}?)(?:,\s*([^.]+?))?\.\s*([\s\S]*)$/.exec(v) ||
    /^((?:Dr\.\s)?[A-Z][\w'-]*(?:\s[A-Z][\w'.-]*){0,3}),\s*([A-Za-z ]+?)\s{1,}([\s\S]*)$/.exec(v);
  if (m) return { name: m[1].trim(), role: (m[2] ?? "").trim(), background: (m[3] ?? "").trim(), profileUrl: url };
  return { name: v.split(/[,.]/)[0].trim().slice(0, 60), role: "", background: v, profileUrl: url };
}

/** Fallback: founders from a deck "team" slide ("Name, Role" lines followed by a bio). */
export function foundersFromDeck(pages: DocPage[]): (ParsedFounder & { page: number })[] {
  const out: (ParsedFounder & { page: number })[] = [];
  for (const p of pages) {
    if (!/team|founder/i.test(p.text)) continue;
    const lines = p.text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = /^((?:Dr\.\s)?[A-Z][a-z'-]+(?:\s[A-Z][\w'.-]*){0,3}),\s*((?:Co-)?(?:CEO|CTO|COO|CFO|CPO|Founder|Co-founder|Growth|Head)[^.\n]*)\.?\s*(.*)$/.exec(lines[i].trim());
      if (m) {
        const bio = [m[3], lines[i + 1] ?? "", lines[i + 2] ?? ""].join(" ");
        out.push({ name: m[1], role: m[2].trim(), background: bio.split(/\s(?=[A-Z][a-z]+ [A-Z][a-z]+,)/)[0].trim(), page: p.index });
      }
    }
  }
  return out;
}
