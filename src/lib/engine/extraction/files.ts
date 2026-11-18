// Document text extraction with page/slide provenance. Runs in the browser and in Node (tests, API).
import JSZip from "jszip";
import type { DocPage, ExtractionMethod } from "@/lib/shared/types";
import { normaliseText } from "./text";

export const SUPPORTED_EXTENSIONS = ["pdf", "pptx", "docx", "xlsx", "csv", "txt", "md"] as const;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export type ExtractionErrorCode =
  | "unsupported_type"
  | "legacy_office_format"
  | "empty_file"
  | "too_large"
  | "encrypted"
  | "corrupted"
  | "no_text";

export class ExtractionError extends Error {
  code: ExtractionErrorCode;
  constructor(code: ExtractionErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "ExtractionError";
  }
}

export interface ExtractionResult {
  pages: DocPage[];
  method: ExtractionMethod;
  warnings: string[];
}

export function fileExtension(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

/** Validate before extraction. Throws ExtractionError with a user-facing message. */
export function validateFile(name: string, bytes: Uint8Array): string {
  const ext = fileExtension(name);
  if (["ppt", "doc", "xls", "key", "pages", "numbers"].includes(ext)) {
    throw new ExtractionError(
      "legacy_office_format",
      `"${name}" is a .${ext} file. Save it as .pptx, .docx, .xlsx or PDF and upload again.`,
    );
  }
  if (!(SUPPORTED_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new ExtractionError(
      "unsupported_type",
      `"${name}" is not a supported type. Upload PDF, PPTX, DOCX, XLSX, CSV or TXT.`,
    );
  }
  if (bytes.byteLength === 0) throw new ExtractionError("empty_file", `"${name}" is empty (0 bytes).`);
  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new ExtractionError(
      "too_large",
      `"${name}" is ${(bytes.byteLength / 1048576).toFixed(1)} MB. The limit is ${MAX_FILE_BYTES / 1048576} MB.`,
    );
  }
  const head = String.fromCharCode(...bytes.slice(0, 5));
  if (ext === "pdf" && !head.startsWith("%PDF")) {
    throw new ExtractionError("corrupted", `"${name}" has a .pdf name but is not a valid PDF file.`);
  }
  if (["pptx", "docx", "xlsx"].includes(ext) && !head.startsWith("PK")) {
    throw new ExtractionError("corrupted", `"${name}" has a .${ext} name but is not a valid Office file.`);
  }
  return ext;
}

export async function extractFile(name: string, bytes: Uint8Array): Promise<ExtractionResult> {
  const ext = validateFile(name, bytes);
  let result: ExtractionResult;
  switch (ext) {
    case "pdf":
      result = await extractPdf(name, bytes);
      break;
    case "pptx":
      result = await extractPptx(name, bytes);
      break;
    case "docx":
      result = await extractDocx(name, bytes);
      break;
    case "xlsx":
      result = await extractXlsx(name, bytes);
      break;
    default:
      result = extractPlain(bytes, ext === "csv" ? "csv" : "txt");
  }
  const totalChars = result.pages.reduce((n, p) => n + p.text.trim().length, 0);
  if (totalChars < 20) {
    throw new ExtractionError(
      "no_text",
      `No readable text found in "${name}". It may be a scanned or image-only file. OCR is not enabled by default; upload a text-based version or paste the text.`,
    );
  }
  return result;
}

async function extractPdf(name: string, bytes: Uint8Array): Promise<ExtractionResult> {
  const { getDocumentProxy, extractText } = await import("unpdf");
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes));
  } catch (e) {
    const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
    if (/password/i.test(msg)) {
      throw new ExtractionError("encrypted", `"${name}" is password-protected. Ask the applicant for an unlocked copy.`);
    }
    throw new ExtractionError("corrupted", `"${name}" could not be opened as a PDF (${msg.slice(0, 120)}).`);
  }
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = (text as string[]).map((t, i) => ({ index: i + 1, text: normaliseText(t) }));
  const warnings: string[] = [];
  const empty = pages.filter((p) => p.text.trim().length === 0).length;
  if (empty > 0 && empty < pages.length) warnings.push(`${empty} page(s) contain no extractable text (images only).`);
  return { pages, method: "pdf-text", warnings };
}

function xmlText(xml: string, tag: string, paraTag: string): string {
  // Collect text runs, inserting line breaks at paragraph boundaries.
  const out: string[] = [];
  const paraRe = new RegExp(`<${paraTag}[ >][\\s\\S]*?</${paraTag}>`, "g");
  const runRe = new RegExp(`<${tag}(?: [^>]*)?>([^<]*)</${tag}>`, "g");
  const paras = xml.match(paraRe) ?? [xml];
  for (const p of paras) {
    let line = "";
    let m: RegExpExecArray | null;
    runRe.lastIndex = 0;
    while ((m = runRe.exec(p))) line += m[1];
    if (line.trim()) out.push(decodeXml(line));
  }
  return out.join("\n");
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&");
}

async function openZip(name: string, bytes: Uint8Array): Promise<JSZip> {
  try {
    return await JSZip.loadAsync(bytes);
  } catch {
    throw new ExtractionError("corrupted", `"${name}" could not be opened. The file may be corrupted or password-protected.`);
  }
}

async function extractPptx(name: string, bytes: Uint8Array): Promise<ExtractionResult> {
  const zip = await openZip(name, bytes);
  const slideFiles = Object.keys(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]));
  if (!slideFiles.length) throw new ExtractionError("corrupted", `"${name}" contains no slides.`);
  const pages: DocPage[] = [];
  for (let i = 0; i < slideFiles.length; i++) {
    const xml = await zip.file(slideFiles[i])!.async("string");
    pages.push({ index: i + 1, text: normaliseText(xmlText(xml, "a:t", "a:p")) });
  }
  return { pages, method: "pptx-xml", warnings: [] };
}

async function extractDocx(name: string, bytes: Uint8Array): Promise<ExtractionResult> {
  const zip = await openZip(name, bytes);
  const doc = zip.file("word/document.xml");
  if (!doc) throw new ExtractionError("corrupted", `"${name}" is not a valid Word document.`);
  const xml = await doc.async("string");
  // Word has no fixed pages; split on explicit page breaks, otherwise one section.
  const parts = xml.split(/<w:br [^>]*w:type="page"[^>]*\/>|<w:lastRenderedPageBreak\/>/);
  const pages = parts
    .map((p, i) => ({ index: i + 1, text: normaliseText(xmlText(p, "w:t", "w:p")) }))
    .filter((p) => p.text.trim());
  return {
    pages: pages.map((p, i) => ({ ...p, index: i + 1 })),
    method: "docx-xml",
    warnings: parts.length === 1 ? ["Word files have no fixed pages; provenance is by section."] : [],
  };
}

async function extractXlsx(name: string, bytes: Uint8Array): Promise<ExtractionResult> {
  const zip = await openZip(name, bytes);
  const ss = zip.file("xl/sharedStrings.xml");
  const shared: string[] = [];
  if (ss) {
    const xml = await ss.async("string");
    for (const si of xml.match(/<si>[\s\S]*?<\/si>/g) ?? []) {
      shared.push(decodeXml((si.match(/<t[^>]*>([^<]*)<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, "")).join("")));
    }
  }
  const sheets = Object.keys(zip.files)
    .filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f))
    .sort();
  const pages: DocPage[] = [];
  for (let i = 0; i < sheets.length; i++) {
    const xml = await zip.file(sheets[i])!.async("string");
    const rows: string[] = [];
    for (const row of xml.match(/<row[\s\S]*?<\/row>/g) ?? []) {
      const cells: string[] = [];
      for (const c of row.match(/<c [^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) ?? []) {
        const isShared = /t="s"/.test(c);
        const inline = /<t[^>]*>([^<]*)<\/t>/.exec(c);
        const v = /<v>([^<]*)<\/v>/.exec(c);
        if (inline) cells.push(decodeXml(inline[1]));
        else if (v) cells.push(isShared ? shared[Number(v[1])] ?? "" : v[1]);
      }
      if (cells.some((x) => x.trim())) rows.push(cells.join(" "));
    }
    pages.push({ index: i + 1, text: normaliseText(rows.join("\n")) });
  }
  if (!pages.length) throw new ExtractionError("corrupted", `"${name}" contains no worksheets.`);
  return { pages, method: "xlsx-xml", warnings: ["Spreadsheet provenance is by sheet."] };
}

function extractPlain(bytes: Uint8Array, method: "csv" | "txt"): ExtractionResult {
  let text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (method === "csv") text = text.replace(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/g, " ").replace(/"/g, "");
  // Honour explicit page markers if present ("=== PAGE n ===" or form feed).
  const chunks = text.split(/\f|^=== ?(?:PAGE|SLIDE) \d+ ?===$/m).filter((c) => c.trim());
  const pages = (chunks.length ? chunks : [text]).map((t, i) => ({ index: i + 1, text: normaliseText(t) }));
  return { pages, method, warnings: [] };
}

export function pagesFromPastedText(text: string): DocPage[] {
  return extractPlain(new TextEncoder().encode(text), "txt").pages;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
