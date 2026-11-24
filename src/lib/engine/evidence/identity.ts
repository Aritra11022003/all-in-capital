// P3 · Conservative identity matching for companies and people (decision D4, as modified).
//
// Three outcomes, never a merge:
//   "same"      — exact after conservative normalisation, or a clear formatting / one-letter spelling variant
//   "possible"  — abbreviation, initials, partial name or ambiguous similarity → human review required
//   "different" — likely different identity → prominent identity conflict
// There is deliberately NO word-overlap percentage rule.

export type IdentityMatch = "same" | "possible" | "different";

// Only legal-form suffixes are removed. Descriptive words ("Technologies", "Labs", "Health") are kept.
const LEGAL = /\b(?:private|pvt|limited|ltd|llp|inc|incorporated|opc|corp|corporation|co|company)\b\.?/gi;
const TITLES = /\b(?:dr|mr|mrs|ms|prof)\b\.?/gi;

export function normaliseCompany(name: string): { words: string[]; compact: string } {
  const base = name.replace(/\([^)]*\)/g, " ").replace(LEGAL, " ").toLowerCase();
  const words = base.split(/[^a-z0-9]+/).filter(Boolean);
  return { words, compact: words.join("") };
}

export function normalisePerson(name: string): { words: string[]; compact: string } {
  const words = name.replace(TITLES, " ").toLowerCase().split(/[^a-z]+/).filter(Boolean);
  return { words, compact: words.join("") };
}

/** Optimal-string-alignment distance (insert, delete, substitute, adjacent transpose). */
export function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

const initials = (words: string[]) => words.map((w) => w[0]).join("");

export function matchCompany(a: string, b: string): IdentityMatch {
  const x = normaliseCompany(a), y = normaliseCompany(b);
  if (!x.compact || !y.compact) return "possible";
  if (x.compact === y.compact) return "same"; // "CAPilot" = "CA Pilot" = "CAPilot Pvt. Ltd."
  if (Math.min(x.compact.length, y.compact.length) >= 6 && editDistance(x.compact, y.compact) <= 1) return "same"; // one-letter spelling variant
  const [short, long] = x.compact.length <= y.compact.length ? [x, y] : [y, x];
  if (short.compact.length >= 3 && long.compact.includes(short.compact)) return "possible"; // partial name
  if (short.compact.length >= 2 && (short.compact === initials(long.words) || initials(short.words) === initials(long.words))) return "possible"; // abbreviation
  if (editDistance(x.compact, y.compact) <= 3) return "possible"; // ambiguous similarity
  return "different";
}

export function matchPerson(a: string, b: string): IdentityMatch {
  const x = normalisePerson(a), y = normalisePerson(b);
  if (!x.compact || !y.compact) return "possible";
  if (x.compact === y.compact) return "same";
  if (Math.min(x.compact.length, y.compact.length) >= 6 && editDistance(x.compact, y.compact) <= 1) return "same";
  // Same first name and every other word compatible as an initial ("Meenakshi S" vs "Meenakshi Sundaram").
  if (x.words[0] === y.words[0]) {
    const [short, long] = x.words.length <= y.words.length ? [x.words, y.words] : [y.words, x.words];
    const rest = short.slice(1);
    if (!rest.length || rest.every((w, i) => long[i + 1] && (long[i + 1] === w || (w.length === 1 && long[i + 1][0] === w)))) return "possible";
  }
  if (editDistance(x.compact, y.compact) <= 2) return "possible";
  return "different";
}

const ROLES: [RegExp, string][] = [
  [/\bceo\b|chief executive/i, "ceo"],
  [/\bcto\b|chief technology/i, "cto"],
  [/\bcoo\b|chief operating/i, "coo"],
  [/\bcfo\b|chief financial/i, "cfo"],
  [/\bcpo\b|chief product/i, "cpo"],
];
/** Normalised C-level role, or null when the role is not one we can compare reliably. */
export function normaliseRole(role: string): string | null {
  for (const [re, k] of ROLES) if (re.test(role)) return k;
  return null;
}

export function normaliseStage(s: string): string | null {
  const t = s.toLowerCase();
  if (/pre[-\s]?seed/.test(t)) return "pre_seed";
  const series = /series\s+([a-e])\b/.exec(t);
  if (series) return `series_${series[1]}`;
  if (/\bseed\b/.test(t)) return "seed";
  if (/\bangel\b/.test(t)) return "angel";
  return null;
}

const CITY_ALIASES: Record<string, string> = { bangalore: "bengaluru", gurgaon: "gurugram", bombay: "mumbai", madras: "chennai", calcutta: "kolkata", "new delhi": "delhi", trivandrum: "thiruvananthapuram", cochin: "kochi", mysore: "mysuru" };
export function normaliseCity(s: string): string | null {
  const first = s.split(/[,|(]/)[0].trim().toLowerCase();
  if (!first || !/^[a-z][a-z .-]+$/.test(first)) return null;
  return CITY_ALIASES[first] ?? first;
}
