// Shared test helpers: load the case batch into a workspace exactly as the UI does.
import JSZip from "jszip";
import seed from "@/data/seed/applications.json";
import { normaliseText } from "@/lib/engine/extraction/text";
import { emptyWorkspace, type WorkspaceData } from "@/lib/domain/workspace";
import { drain, enqueueGroups } from "@/lib/domain/runner";
import type { IntakeGroup } from "@/lib/domain/intake";
import type { DocInput } from "@/lib/engine/pipeline";

export type SeedApp = { key: string; files: { filename: string; size: number; sha256: string; pages: { index: number; text: string }[] }[] };
export const SEED = seed as SeedApp[];

export function seedDocs(key: string, filter?: (f: SeedApp["files"][number]) => boolean): DocInput[] {
  const s = SEED.find((x) => x.key === key)!;
  return s.files.filter(filter ?? (() => true)).map((f) => ({ filename: f.filename, size: f.size, sha256: f.sha256, method: "pdf-text" as const, pages: f.pages.map((p) => ({ index: p.index, text: normaliseText(p.text) })) }));
}

export function harness(initial?: WorkspaceData) {
  let d = initial ?? emptyWorkspace();
  const mutate = (fn: (w: WorkspaceData) => void) => {
    const c = structuredClone(d);
    fn(c);
    d = c;
  };
  const read = () => d;
  const pending = new Map<string, DocInput[]>();
  return {
    get d() {
      return d;
    },
    mutate,
    read,
    pending,
    async load(groups: IntakeGroup[]) {
      const ids = enqueueGroups(mutate, "riya", groups, "batch_test", pending);
      await drain(mutate, read, pending, "riya");
      return ids;
    },
  };
}

export async function loadCaseBatch() {
  const h = harness();
  const groups: IntakeGroup[] = SEED.map((s) => ({ key: s.key, label: s.key, docs: seedDocs(s.key), failures: [], duplicates: [] }));
  await h.load(groups);
  return h;
}

export const appByName = (d: WorkspaceData, name: string) => d.applications.find((a) => a.name === name)!;

/** Minimal valid one-page PDF with a text layer. */
export function makePdf(lines: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const content = `BT /F1 11 Tf 50 750 Td 14 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(" ")} ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(out);
}

export async function makePptx(slides: string[][]): Promise<Uint8Array> {
  const z = new JSZip();
  z.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  slides.forEach((lines, i) => {
    z.file(`ppt/slides/slide${i + 1}.xml`, `<p:sld xmlns:a="a" xmlns:p="p"><p:cSld><p:spTree>${lines.map((l) => `<a:p><a:r><a:t>${l.replace(/&/g, "&amp;")}</a:t></a:r></a:p>`).join("")}</p:spTree></p:cSld></p:sld>`);
  });
  return new Uint8Array(await z.generateAsync({ type: "uint8array" }));
}

export async function makeDocx(paragraphs: string[]): Promise<Uint8Array> {
  const z = new JSZip();
  z.file("word/document.xml", `<w:document xmlns:w="w"><w:body>${paragraphs.map((p) => `<w:p><w:r><w:t>${p.replace(/&/g, "&amp;")}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`);
  return new Uint8Array(await z.generateAsync({ type: "uint8array" }));
}
