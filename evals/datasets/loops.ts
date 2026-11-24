// Builds the offline Loop 1 / Loop 2 evaluation datasets from the private B6 exports.
// Inputs:  data/private/loop1/*.csv, data/private/loop2/*.csv   (git-ignored; never copied into the repo)
// Outputs: data/private/evals/loop{1,2}.offline.json            (git-ignored)
// Original record IDs are preserved. Draft, Riya's edit and final output are stored as separate fields.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sha256 } from "../framework/runner";
import { LOOP1_CATEGORIES, LOOP1_POST_APPLICATION_INFO, LOOP2_EXCEPTIONS } from "./annotations";

export const PRIVATE_DIR = join(process.cwd(), "data", "private");
export const LOOP1_CSV = join(PRIVATE_DIR, "loop1", "AIC_B6_Loop1_Screening_Export.csv");
export const LOOP2_CSV = join(PRIVATE_DIR, "loop2", "AIC_B6_Loop2_Email_Export.csv");
export const OFFLINE_DIR = join(PRIVATE_DIR, "evals");

/** RFC 4180 CSV parser (quoted fields, doubled quotes, multi-line cells). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { f += '"'; i++; } else q = false;
      } else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(f); f = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else f += c;
  }
  if (f || row.length) { row.push(f); if (row.some((x) => x !== "")) rows.push(row); }
  const [head, ...body] = rows;
  const h = head.map((x) => x.replace(/^﻿/, "").trim());
  return body.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ""])));
}

/**
 * One-way fingerprint of a private export row, used as the key for the committed annotations. It is derived from the
 * row ID, startup and date, so it can be recomputed only by someone who holds the export; on its own it reveals none
 * of them.
 */
export const rowFingerprint = (loop: "L1" | "L2", r: Record<string, string>) => sha256(`aic-b6:${loop}:${r.row_id}:${r.startup}:${loop === "L1" ? r.date : r.date_sent}`).slice(0, 16);

const norm = (s: string) => s.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim();

// ------------------------------------------------------------------ Loop 1
export interface Loop1Record {
  id: string;
  date: string;
  startup: string;
  founderType: string;
  sector: string;
  stage: string;
  city: string;
  applicationSummary: string;
  system: { score: number; call: "Go" | "No-go" };
  riya: { call: "Go" | "No-go"; reason: string | null };
  overturned: boolean;
  category: string; // "agreement" or the annotated overturn category
  postApplicationInfo: boolean;
}

export function loadLoop1(): Loop1Record[] | null {
  if (!existsSync(LOOP1_CSV)) return null;
  return parseCsv(readFileSync(LOOP1_CSV, "utf8")).map((r) => {
    const overturned = r.system_call.trim() !== r.riya_final_call.trim();
    return {
      id: r.row_id,
      date: r.date,
      startup: r.startup,
      founderType: r.founder_type,
      sector: r.sector,
      stage: r.stage,
      city: r.city,
      applicationSummary: r.application_summary,
      system: { score: Number(r.system_score), call: r.system_call.trim() as "Go" | "No-go" },
      riya: { call: r.riya_final_call.trim() as "Go" | "No-go", reason: r.riya_reason.trim() || null },
      overturned,
      category: overturned ? (LOOP1_CATEGORIES[rowFingerprint("L1", r)] ?? "unannotated") : "agreement",
      postApplicationInfo: LOOP1_POST_APPLICATION_INFO.includes(rowFingerprint("L1", r)),
    };
  });
}

// ------------------------------------------------------------------ Loop 2
export type DiffOp = { op: "keep" | "del" | "add"; line: string };

/** Line-level LCS diff between the system draft and Riya's final (Riya's edit, stored separately). */
export function lineDiff(a: string, b: string): DiffOp[] {
  const x = norm(a).split("\n"), y = norm(b).split("\n");
  const dp = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffOp[] = [];
  let i = 0, j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) { out.push({ op: "keep", line: x[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ op: "del", line: x[i++] });
    else out.push({ op: "add", line: y[j++] });
  }
  while (i < x.length) out.push({ op: "del", line: x[i++] });
  while (j < y.length) out.push({ op: "add", line: y[j++] });
  return out;
}

export interface Loop2Record {
  id: string;
  dateSent: string;
  founderName: string;
  startup: string;
  founderType: string;
  sector: string;
  stage: string;
  city: string;
  founderBackground: string;
  tractionFacts: string[];
  /** The system's original draft, unmodified. */
  systemDraft: string;
  /** Riya's edit, derived: whether she changed it and the line diff. */
  riyaEdit: { edited: boolean; changedLines: number; diff: DiffOp[] };
  /** The email Riya actually sent, unmodified. */
  riyaFinal: string;
  duplicateOf: string | null;
  exception: string | null;
  /** unique-clean = ordinary evaluation set; duplicate / exception = audit only. */
  use: "unique-clean" | "duplicate" | "exception";
}

export function loadLoop2(): Loop2Record[] | null {
  if (!existsSync(LOOP2_CSV)) return null;
  const raw = parseCsv(readFileSync(LOOP2_CSV, "utf8"));
  const firstByKey = new Map<string, string>();
  return raw.map((r) => {
    const key = [r.founder_name, r.startup, r.traction_facts, norm(r.riya_final_email)].join("|");
    const dupOf = firstByKey.get(key) ?? null;
    if (!dupOf) firstByKey.set(key, r.row_id);
    const diff = lineDiff(r.system_draft, r.riya_final_email);
    const edited = norm(r.system_draft) !== norm(r.riya_final_email);
    const exception = LOOP2_EXCEPTIONS[rowFingerprint("L2", r)] ?? null;
    return {
      id: r.row_id,
      dateSent: r.date_sent,
      founderName: r.founder_name,
      startup: r.startup,
      founderType: r.founder_type,
      sector: r.sector,
      stage: r.stage,
      city: r.city,
      founderBackground: r.founder_background,
      tractionFacts: r.traction_facts.split(";").map((s) => s.trim()).filter(Boolean),
      systemDraft: r.system_draft,
      riyaEdit: { edited, changedLines: diff.filter((d) => d.op !== "keep").length, diff },
      riyaFinal: r.riya_final_email,
      duplicateOf: dupOf,
      exception,
      use: dupOf ? "duplicate" : exception ? "exception" : "unique-clean",
    };
  });
}

export function datasetFingerprints(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, p] of [["loop1.csv", LOOP1_CSV], ["loop2.csv", LOOP2_CSV]] as const) if (existsSync(p)) out[k] = sha256(readFileSync(p, "utf8"));
  return out;
}

/** Writes the offline datasets (private, git-ignored). Returns the paths written. */
export function writeOfflineDatasets(): string[] {
  const l1 = loadLoop1(), l2 = loadLoop2();
  if (!l1 && !l2) return [];
  mkdirSync(OFFLINE_DIR, { recursive: true });
  const written: string[] = [];
  if (l1) {
    const p = join(OFFLINE_DIR, "loop1.offline.json");
    writeFileSync(p, JSON.stringify({ source: "AIC_B6_Loop1_Screening_Export.csv", fingerprint: datasetFingerprints()["loop1.csv"], records: l1 }, null, 2));
    written.push(p);
  }
  if (l2) {
    const p = join(OFFLINE_DIR, "loop2.offline.json");
    const counts = { total: l2.length, uniqueClean: l2.filter((r) => r.use === "unique-clean").length, duplicates: l2.filter((r) => r.use === "duplicate").map((r) => `${r.id}→${r.duplicateOf}`), exceptions: l2.filter((r) => r.use === "exception").map((r) => r.id), edited: l2.filter((r) => r.riyaEdit.edited).length };
    writeFileSync(p, JSON.stringify({ source: "AIC_B6_Loop2_Email_Export.csv", fingerprint: datasetFingerprints()["loop2.csv"], counts, records: l2 }, null, 2));
    written.push(p);
  }
  return written;
}
