// Rebuilds an evaluation Profile from stored records, so re-evaluation uses human-edited extraction values.
import type { Profile } from "@/lib/engine/pipeline";
import { stageKey } from "@/lib/engine/pipeline";
import { screenDocuments } from "@/lib/engine/safety/untrusted";
import { activeRestorationIds, getApp, type WorkspaceData } from "./workspace";

export function profileFromStore(d: WorkspaceData, appId: string): Profile {
  const app = getApp(d, appId);
  const docs = d.documents.filter((x) => x.applicationId === appId && x.status === "extracted");
  // P2 C2: identical screening to first-time processing, including any audited reviewer restorations.
  const screening = screenDocuments(docs.map((x) => ({ id: x.id, kind: x.kind, pages: x.pages })), activeRestorationIds(d, appId));
  const deckPages = docs.filter((x) => x.kind === "deck").flatMap((x) => screening.pagesByDoc[x.id] ?? x.pages);
  const formDoc = docs.find((x) => x.kind === "form");
  const formPages = formDoc ? (screening.pagesByDoc[formDoc.id] ?? formDoc.pages) : [];
  const fields: Record<string, string> = {};
  for (const f of d.fields.filter((x) => x.applicationId === appId)) if (f.value && !(f.field in fields)) fields[f.field] = f.value;
  const company = d.companies.find((c) => c.id === app.companyId);
  const founders = d.founders.filter((f) => f.companyId === app.companyId).map((f) => ({ name: f.name, role: f.role, background: f.background }));
  const deckText = deckPages.map((p) => p.text).join("\n");
  const formText = formPages.map((p) => p.text).join("\n");
  return {
    name: app.name,
    legalName: company?.legalName ?? null,
    oneLiner: fields.one_liner ?? app.oneLiner,
    sectorSelected: fields.sector ?? app.sectorSelected,
    sectorKey: app.sectorKey,
    tags: app.tags,
    stage: fields.stage ?? app.stage,
    stageKey: stageKey(fields.stage ?? app.stage),
    raiseInr: app.raiseInr,
    valuationInr: app.valuationInr,
    source: fields.heard_from ?? app.source,
    fields,
    founders,
    hasDeck: deckPages.length > 0,
    hasForm: formPages.length > 0,
    bundle: {
      deckPages,
      formPages,
      deckText,
      formText,
      formFounderText: Object.entries(fields).filter(([k]) => /^founder/.test(k)).map(([, v]) => v).join("\n"),
      allText: `${deckText}\n${formText}`,
    },
    screening: { spans: screening.spans, normalisedPages: screening.normalisedPages },
  };
}
