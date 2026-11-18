// Regenerates src/data/seed/applications.json from the raw case PDFs in data/applications (git-ignored).
// Usage: npm run seed
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { getDocumentProxy, extractText } from "unpdf";

const dir = "data/applications";
if (!existsSync(dir)) { console.error("data/applications not found — place the case PDFs there first."); process.exit(1); }
const files = readdirSync(dir).filter((f) => /\.(pdf)$/i.test(f)).sort();
const groups = {};
for (const f of files) {
  const key = f.split(/[_ ]/)[0];
  const bytes = readFileSync(join(dir, f));
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  (groups[key] ??= []).push({
    filename: f,
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    pages: text.map((t, i) => ({ index: i + 1, text: t })),
  });
}
// StockSathi first: it is the example case referenced as "Application 1 of 10".
const order = ["StockSathi", ...Object.keys(groups).filter((k) => k !== "StockSathi")];
const out = order.filter((k) => groups[k]).map((k) => ({ key: k, files: groups[k] }));
writeFileSync("src/data/seed/applications.json", JSON.stringify(out, null, 1));
console.log(`Wrote ${out.length} applications, ${files.length} files.`);
