// Text normalisation helpers shared by every extractor and parser.

const LIGATURES: Record<string, string> = { "ﬁ": "fi", "ﬂ": "fl", "ﬀ": "ff", "ﬃ": "ffi", "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st" };

export function normaliseText(t: string): string {
  return t
    .replace(/[ﬁﬂﬀﬃﬄﬅﬆ]/g, (c) => LIGATURES[c] ?? c)
    .replace(/ /g, " ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Collapse to a single line for regex matching across wrapped lines. */
export function flat(t: string): string {
  return t.replace(/\s+/g, " ").trim();
}

export function sentences(t: string): string[] {
  return flat(t)
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function excerptAround(text: string, idx: number, len = 140): string {
  const f = text;
  const start = Math.max(0, idx - Math.floor(len / 2));
  const end = Math.min(f.length, start + len);
  return (start > 0 ? "…" : "") + f.slice(start, end).trim() + (end < f.length ? "…" : "");
}
