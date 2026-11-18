import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ExtractionError, extractFile, validateFile } from "@/lib/engine/extraction/files";
import { parseForm, parseFounder } from "@/lib/engine/extraction/form";
import { analyseDocuments } from "@/lib/engine/pipeline";
import { prepareIntake, prepareTextIntake, groupKey } from "@/lib/domain/intake";
import { emptyWorkspace } from "@/lib/domain/workspace";
import { SEED, makeDocx, makePdf, makePptx, seedDocs, loadCaseBatch } from "../helpers";

const EXPECTED: Record<string, { name: string; raise: number; stage: string; founders: number }> = {
  StockSathi: { name: "StockSathi", raise: 2e7, stage: "pre_seed", founders: 2 },
  CAPilot: { name: "CAPilot", raise: 1.5e7, stage: "pre_seed", founders: 2 },
  CareCorner: { name: "CareCorner", raise: 3e7, stage: "pre_seed", founders: 2 },
  EarnWise: { name: "EarnWise", raise: 2e7, stage: "pre_seed", founders: 1 },
  GrainKind: { name: "GrainKind", raise: 2.5e7, stage: "pre_seed", founders: 2 },
  Pumpwise: { name: "Pumpwise", raise: 2.2e7, stage: "pre_seed", founders: 2 },
  RentRoute: { name: "RentRoute", raise: 1.8e7, stage: "pre_seed", founders: 2 },
  Settlr: { name: "Settlr", raise: 3e8, stage: "series_a_plus", founders: 2 },
  Talkbook: { name: "Talkbook", raise: 2e7, stage: "pre_seed", founders: 2 },
  Yatrika: { name: "Yatrika", raise: 1.2e7, stage: "pre_seed", founders: 2 },
};

describe("extraction on the 10 supplied applications", () => {
  for (const s of SEED) {
    it(`${s.key}: identity, raise, stage and founders with provenance`, () => {
      const a = analyseDocuments({ applicationId: s.key, cycleId: "c", actor: "riya", now: "2026-11-18T00:00:00Z", docs: seedDocs(s.key) });
      const e = EXPECTED[s.key];
      expect(a.company.name).toBe(e.name);
      expect(a.profile.raiseInr).toBe(e.raise);
      expect(a.profile.stageKey).toBe(e.stage);
      expect(a.founders.length).toBe(e.founders);
      expect(a.documents.map((d) => d.kind).sort()).toEqual(["deck", "form"]);
      // every parsed field keeps its page and original text
      for (const f of a.fields.filter((x) => x.value && x.method === "form-label")) {
        expect(f.page).toBeGreaterThan(0);
        expect(f.originalText.length).toBeGreaterThan(0);
      }
    });
  }

  it("StockSathi (alternate form layout) parses label-on-own-line values and founder background", () => {
    const fields = parseForm(seedDocs("StockSathi", (f) => /Form/.test(f.filename))[0].pages);
    const built = fields.find((f) => f.field === "built")!;
    expect(built.value).toMatch(/vernacular Android app/);
    const f1 = parseFounder(fields.find((f) => f.field === "founder_1")!.value);
    expect(f1).toMatchObject({ name: "Aarav Deshmukh", role: "CEO" });
    expect(f1.background).toMatch(/FMCG distribution/);
  });

  it("never invents values: missing core fields are recorded as missing", () => {
    const a = analyseDocuments({ applicationId: "y", cycleId: "c", actor: "riya", now: "n", docs: seedDocs("Yatrika", (f) => /Deck/.test(f.filename)) });
    const raise = a.fields.find((f) => f.field === "raise");
    expect(raise?.value ?? null).toBeNull();
    expect(raise?.validation).toBe("missing");
    expect(a.warnings.join(" ")).toMatch(/No application form/);
  });
});

describe("file formats", () => {
  it("extracts a text PDF page by page", async () => {
    const r = await extractFile("Acme_Deck.pdf", makePdf(["Acme", "Raising INR 1 Cr", "Pre-seed | Pune"]));
    expect(r.method).toBe("pdf-text");
    expect(r.pages[0].text).toMatch(/Raising INR 1 Cr/);
  });
  it("extracts PPTX slide by slide", async () => {
    const r = await extractFile("Acme_Deck.pptx", await makePptx([["Acme", "Pre-seed | Raising INR 1 Cr | Pune"], ["The team", "Asha Rao, CEO. 7 years in logistics."]]));
    expect(r.pages).toHaveLength(2);
    expect(r.pages[1].text).toMatch(/Asha Rao, CEO/);
  });
  it("extracts DOCX forms", async () => {
    const r = await extractFile("Acme_Form.docx", await makeDocx(["Company name Acme (Acme Pvt. Ltd.)", "Sector (as selected) Fintech", "Amount raising INR 1 Cr"]));
    expect(parseForm(r.pages).find((f) => f.field === "raise")?.value).toBe("INR 1 Cr");
  });
  it("accepts TXT and CSV", async () => {
    expect((await extractFile("a.txt", new TextEncoder().encode("Company name Acme\nStage (as selected) Pre-seed"))).pages[0].text).toMatch(/Acme/);
    expect((await extractFile("a.csv", new TextEncoder().encode('label,value\n"Company name","Acme"'))).pages[0].text).toMatch(/Company name Acme/);
  });
});

describe("Test 17 — unreadable documents generate visible errors", () => {
  const code = async (name: string, bytes: Uint8Array) => {
    try {
      await extractFile(name, bytes);
      return "ok";
    } catch (e) {
      return (e as ExtractionError).code;
    }
  };
  it("rejects empty, corrupted, mislabelled, legacy, unsupported, encrypted and image-only files", async () => {
    expect(await code("x.pdf", new Uint8Array())).toBe("empty_file");
    expect(await code("x.pdf", new TextEncoder().encode("not a pdf"))).toBe("corrupted");
    expect(await code("x.pptx", new TextEncoder().encode("not a zip"))).toBe("corrupted");
    expect(await code("x.ppt", new Uint8Array([1]))).toBe("legacy_office_format");
    expect(await code("x.exe", new Uint8Array([1]))).toBe("unsupported_type");
    expect(await code("x.pdf", new Uint8Array(readFileSync("tests/fixtures/encrypted.pdf")))).toBe("encrypted");
    expect(await code("x.pdf", new Uint8Array(readFileSync("tests/fixtures/blank.pdf")))).toBe("no_text");
    expect(() => validateFile("big.pdf", new Uint8Array(26 * 1024 * 1024))).toThrow(/limit/);
  });
  it("records failed files on the application with Failed processing and an unchanged decision", async () => {
    const d = emptyWorkspace();
    const groups = await prepareIntake(d, [{ name: "Broken_Deck.pdf", bytes: new TextEncoder().encode("garbage") }]);
    expect(groups[0].failures[0].error).toMatch(/not a valid PDF/);
    const { harness } = await import("../helpers");
    const h = harness(d);
    await h.load(groups);
    const app = h.d.applications[0];
    expect(app.processingStatus).toBe("failed");
    expect(app.decisionStatus).toBe("not_reviewed");
    expect(app.errors[0]).toMatch(/not a valid PDF/);
  });
});

describe("Test 16 — duplicate uploads are handled safely", () => {
  it("skips files already received and identical files within one upload", async () => {
    const h = await loadCaseBatch();
    const pdf = makePdf(["Acme — pitch deck", "Pre-seed | Raising INR 1 Cr | Pune"]);
    const g = await prepareIntake(h.d, [
      { name: "Acme_Deck.pdf", bytes: pdf },
      { name: "Acme_Deck copy.pdf", bytes: pdf },
    ]);
    expect(g[0].docs).toHaveLength(1);
    expect(g[0].failures[0].code).toBe("duplicate_in_batch");
    // a document whose hash matches a stored document is reported, not re-created
    const stored = h.d.documents.find((x) => x.sha256)!;
    h.mutate((w) => {
      w.documents.push({ ...stored, id: "doc_probe", sha256: "f".repeat(64) });
    });
    const { findDuplicate } = await import("@/lib/domain/workspace");
    expect(findDuplicate(h.d, "f".repeat(64))?.app.id).toBe(stored.applicationId);
  });
  it("groups a batch by company name in filenames", () => {
    expect(groupKey("StockSathi_Form Response.pdf")).toBe("stocksathi");
    expect(groupKey("Application_01_StockSathi_Deck.pptx")).toBe("stocksathi");
  });
  it("pasted text intake rejects near-empty input", async () => {
    const g = await prepareTextIntake({ deckText: "short", formText: "" });
    expect(g.docs).toHaveLength(0);
    expect(g.failures[0].error).toMatch(/too short/);
  });
});
