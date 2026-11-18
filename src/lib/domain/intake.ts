// Intake: validate → extract → duplicate check → group files into applications.
import { ExtractionError, extractFile, pagesFromPastedText, sha256Hex } from "@/lib/engine/extraction/files";
import type { DocInput } from "@/lib/engine/pipeline";
import { findDuplicate, type IntakeFailure, type WorkspaceData } from "./workspace";

export interface RawFile {
  name: string;
  bytes: Uint8Array;
}

export interface IntakeGroup {
  key: string;
  label: string;
  docs: DocInput[];
  failures: IntakeFailure[];
  duplicates: { filename: string; existingApp: string; existingAppId: string }[];
}

const STOP = new Set(["application", "app", "deck", "form", "pitch", "response", "responses", "final", "v1", "v2", "copy", "inbound", "submission", "the"]);

export function groupKey(filename: string): string {
  const base = filename.replace(/\.[a-z0-9]+$/i, "");
  const tokens = base.split(/[_\-\s.]+/).map((t) => t.toLowerCase()).filter((t) => t && !STOP.has(t) && !/^\d+$/.test(t));
  return tokens[0] ?? "";
}

function prettyLabel(key: string, filenames: string[]): string {
  for (const f of filenames) {
    const m = f.split(/[_\-\s.]+/).find((t) => t.toLowerCase() === key);
    if (m) return m;
  }
  return key ? key[0].toUpperCase() + key.slice(1) : "New application";
}

export async function prepareIntake(d: WorkspaceData, files: RawFile[], opts: { singleApplication?: boolean } = {}): Promise<IntakeGroup[]> {
  const groups = new Map<string, IntakeGroup>();
  const seenInBatch = new Map<string, string>();
  for (const f of files) {
    const key = opts.singleApplication ? "__single__" : groupKey(f.name) || "__unnamed__";
    if (!groups.has(key)) groups.set(key, { key, label: "", docs: [], failures: [], duplicates: [] });
    const g = groups.get(key)!;
    try {
      const sha = await sha256Hex(f.bytes);
      if (seenInBatch.has(sha)) {
        g.failures.push({ filename: f.name, size: f.bytes.byteLength, code: "duplicate_in_batch", error: `Identical to "${seenInBatch.get(sha)}" in this upload — skipped.` });
        continue;
      }
      seenInBatch.set(sha, f.name);
      const dup = findDuplicate(d, sha);
      if (dup) {
        g.duplicates.push({ filename: f.name, existingApp: dup.app.name, existingAppId: dup.app.id });
        continue;
      }
      const res = await extractFile(f.name, f.bytes);
      g.docs.push({ filename: f.name, pages: res.pages, method: res.method, sha256: sha, size: f.bytes.byteLength, warnings: res.warnings });
    } catch (e) {
      const code = e instanceof ExtractionError ? e.code : "unknown";
      g.failures.push({ filename: f.name, size: f.bytes.byteLength, code, error: e instanceof Error ? e.message : String(e) });
    }
  }
  for (const g of groups.values()) {
    const names = [...g.docs.map((x) => x.filename), ...g.failures.map((x) => x.filename), ...g.duplicates.map((x) => x.filename)];
    g.label = g.key === "__single__" || g.key === "__unnamed__" ? prettyLabel(groupKey(names[0] ?? ""), names) : prettyLabel(g.key, names);
  }
  return [...groups.values()];
}

export async function prepareTextIntake(input: { companyHint?: string; deckText?: string; formText?: string }): Promise<IntakeGroup> {
  const docs: DocInput[] = [];
  const failures: IntakeFailure[] = [];
  for (const [kind, text] of [["deck", input.deckText], ["form", input.formText]] as const) {
    if (!text || !text.trim()) continue;
    if (text.trim().length < 20) {
      failures.push({ filename: `pasted-${kind}.txt`, size: text.length, code: "no_text", error: `Pasted ${kind} text is too short to analyse (under 20 characters).` });
      continue;
    }
    const bytes = new TextEncoder().encode(text);
    docs.push({ filename: `pasted-${kind}.txt`, kind, pages: pagesFromPastedText(text), method: "pasted", sha256: await sha256Hex(bytes), size: bytes.byteLength });
  }
  return { key: "__pasted__", label: input.companyHint?.trim() || "Pasted application", docs, failures, duplicates: [] };
}
