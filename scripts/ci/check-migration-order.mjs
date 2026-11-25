// Static check of supabase/migrations before any database starts (CI and local).
// Fails on: a badly named file, a duplicate or missing version number, an empty file, or a version
// sequence with gaps (which usually means a migration was renamed, lost or added out of order).
// Prints the apply order, which is also the order the Supabase CLI uses (ascending version).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(process.cwd(), "supabase", "migrations");
const NAME = /^(\d{4})_[a-z0-9_]+\.sql$/;
const errors = [];
const files = readdirSync(dir).filter((f) => !f.startsWith("."));
const migrations = [];
for (const f of files) {
  const m = NAME.exec(f);
  if (!m) {
    errors.push(`"${f}" does not match NNNN_lower_snake_name.sql`);
    continue;
  }
  if (!readFileSync(join(dir, f), "utf8").trim()) errors.push(`"${f}" is empty`);
  migrations.push({ file: f, version: Number(m[1]) });
}
migrations.sort((a, b) => a.version - b.version);
const seen = new Map();
for (const m of migrations) {
  if (seen.has(m.version)) errors.push(`version ${String(m.version).padStart(4, "0")} is used by both "${seen.get(m.version)}" and "${m.file}"`);
  seen.set(m.version, m.file);
}
migrations.forEach((m, i) => {
  if (m.version !== i + 1) errors.push(`expected version ${String(i + 1).padStart(4, "0")} at position ${i + 1}, found "${m.file}" (gap or misnumbering)`);
});
if (!migrations.length) errors.push("no migrations found");

console.log(`Migration apply order (${migrations.length}):`);
for (const m of migrations) console.log(`  ${m.file}`);
if (errors.length) {
  console.error(`\nMigration order check FAILED:\n  - ${errors.join("\n  - ")}`);
  process.exit(1);
}
console.log("Migration order check passed.");
