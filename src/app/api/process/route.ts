// Stateless processing API: send deck and/or form TEXT, receive the full structured assessment.
// Nothing is stored server-side. Body limit is kept small; large files are processed in the browser instead.
import { processApplication } from "@/lib/engine/process";
import { pagesFromPastedText } from "@/lib/engine/extraction/files";
import { THESIS_V1, CRITERIA_V1 } from "@/config/thesis";
import { PORTFOLIO_V1 } from "@/config/portfolio";
import type { DocInput } from "@/lib/engine/pipeline";

const MAX_CHARS = 200_000;

export async function POST(req: Request) {
  let body: { deckText?: unknown; formText?: unknown; companyName?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Body must be JSON: { deckText?: string, formText?: string }" }, { status: 400 });
  }
  const deck = typeof body.deckText === "string" ? body.deckText : "";
  const form = typeof body.formText === "string" ? body.formText : "";
  if (!deck.trim() && !form.trim()) return Response.json({ ok: false, error: "Provide deckText and/or formText (non-empty strings)." }, { status: 422 });
  if (deck.length + form.length > MAX_CHARS) return Response.json({ ok: false, error: `Text too long (max ${MAX_CHARS} characters).` }, { status: 413 });
  const docs: DocInput[] = [];
  if (deck.trim()) docs.push({ filename: "deck.txt", kind: "deck", pages: pagesFromPastedText(deck), method: "pasted", sha256: "api", size: deck.length });
  if (form.trim()) docs.push({ filename: "form.txt", kind: "form", pages: pagesFromPastedText(form), method: "pasted", sha256: "api", size: form.length });
  try {
    const r = await processApplication({ applicationId: "api", cycleId: "api", actor: "riya", docs, thesis: THESIS_V1, criteria: CRITERIA_V1, portfolio: PORTFOLIO_V1, learningRules: [] });
    const { analysis, overlap, research, evaluation } = r;
    return Response.json({
      ok: true,
      simulated: true,
      note: "Decision support only. Recommendation is not a decision. No external research was performed.",
      company: analysis.company,
      founders: analysis.founders,
      profile: { sector: analysis.profile.sectorKey, tags: analysis.profile.tags, stage: analysis.profile.stage, raiseInr: analysis.profile.raiseInr },
      fields: analysis.fields.map((f) => ({ field: f.field, value: f.value, page: f.page, state: f.validation })),
      conflicts: analysis.conflicts,
      warnings: analysis.warnings,
      overlap,
      researchTasks: research.map((t) => ({ workstream: t.workstream, question: t.question, priority: t.priority, status: t.status })),
      evaluation,
    });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
