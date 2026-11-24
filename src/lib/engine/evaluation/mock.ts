// MockAIProvider: a deterministic, rule-based evaluator. It reads only the submitted documents,
// cites the claim behind every signal, and never claims to have verified anything externally.
import type {
  Confidence,
  CriterionAssessment,
  CriterionId,
  Evaluation,
  EvidenceState,
  Flag,
  Recommendation,
  RevealedCheck,
  Signal,
} from "@/lib/shared/types";
import { qualifiesForThesisException, type EvaluationInput } from "./provider";
import { flat } from "../extraction/text";
import { formatInr } from "../evidence/metrics";
import { redactContactDetails, spanLocation } from "../safety/untrusted";

interface Acc {
  support: Signal[];
  oppose: Signal[];
  notes: Signal[];
  unknowns: string[];
  rules: string[];
  hasEvidence: boolean;
}
const acc = (): Acc => ({ support: [], oppose: [], notes: [], unknowns: [], rules: [], hasEvidence: false });

const DOMAINS: Record<string, RegExp> = {
  "tax & accounting": /\b(gst|tax|chartered accountant|ca firms?|accounting|notice repl)/i,
  "retail distribution": /\b(fmcg|distribut\w*|kirana|wholesale|retailers?|restock\w*)\b/i,
  healthcare: /\b(mbbs|medicine|clinics?|hospital|doctors?|patients?|diagnostics?|primary care)\b/i,
  "finance & payments": /\b(payments?|fintech|bank(?:ing)?|lending|credit|nbfc|invoice|wage|financ\w*|investment bank)\b/i,
  "packaged food": /\b(food|snacks?|breakfast|packaged|millets?|cereal)\b/i,
  "supply chain": /\b(supply chain|quick-commerce|quick commerce|co-packer|logistics)\b/i,
  "industrial engineering": /\b(reliability|engines?|motors?|pumps?|factor(?:y|ies)|embedded|sensors?|firmware|auto-components|mechanical|plants?)\b/i,
  "sales software": /\b(crm|sales teams?|sales reps?|speech|calls?|transcri\w*)\b/i,
  travel: /\b(travel|trips?|tour\w*|itinerar\w*|guides?)\b/i,
  "rent & housing": /\b(rent|landlords?|real estate|housing)\b/i,
  "aerospace & robotics": /\b(aerospace|aircraft|drones?|robot\w*|uav)\b/i,
};

function domainsOf(text: string): Set<string> {
  const s = new Set<string>();
  for (const [d, re] of Object.entries(DOMAINS)) if (re.test(text)) s.add(d);
  return s;
}

export async function mockEvaluate(input: EvaluationInput, providerId: string, providerLabel: string): Promise<Evaluation> {
  const { profile: p, claims, conflicts, criteria, thesis, overlap } = input;
  const F = (k: string) => p.fields[k] ?? "";
  const all = flat(p.bundle.allText);
  const deck = flat(p.bundle.deckText);
  const form = flat(p.bundle.formText);
  const founderText = p.founders.map((f) => `${f.role}. ${f.background}`).join(" ");

  // P2 · C4: cite the exact passage that triggered a signal. The same regex that decided the signal is run
  // page by page over the screened text (founder pages in preference order); the citation is that page and
  // the sentence containing the match. A citation is never taken from a different, merely similar passage.
  // The quoted passage is the line(s) the match sits on (forms are one answer per line), narrowed to the
  // sentence when a line is long. `t` is the page flattened line by line, identical to flat(page.text).
  const passageAt = (lines: string[], starts: number[], idx: number, len: number) => {
    let first = 0;
    while (first + 1 < lines.length && starts[first + 1] <= idx) first++;
    let last = first;
    while (last + 1 < lines.length && starts[last + 1] < idx + len) last++;
    const text = lines.slice(first, last + 1).join(" ");
    if (text.length <= 320) return text;
    const rel = idx - starts[first];
    const from = Math.max(...[". ", "? ", "! "].map((sep) => text.lastIndexOf(sep, rel - 1)).filter((x) => x >= 0).map((x) => x + 2), 0);
    const ends = [". ", "? ", "! "].map((sep) => text.indexOf(sep, rel + len)).filter((x) => x >= 0);
    const to = ends.length ? Math.min(...ends) + 1 : text.length;
    const sentence = text.slice(from, to).trim();
    return sentence.length <= 320 ? sentence : text.slice(Math.max(0, rel - 150), Math.min(text.length, rel + len + 150)).trim();
  };
  const cite = (re: RegExp, prefer: "form" | "deck" | "any" = "any"): { claimId?: string; ref: string; excerpt: string } | null => {
    const rx = new RegExp(re.source, re.flags.replace("g", ""));
    const form = p.bundle.formPages.map((x) => ({ ...x, k: "Form" as const, kind: "form" as const }));
    const deck = p.bundle.deckPages.map((x) => ({ ...x, k: "Deck" as const, kind: "deck" as const }));
    for (const pg of prefer === "deck" ? [...deck, ...form] : [...form, ...deck]) {
      const lines = pg.text.split("\n").map(flat).filter(Boolean);
      const starts: number[] = [];
      lines.reduce((off, l) => (starts.push(off), off + l.length + 1), 0);
      const t = lines.join(" ");
      const m = rx.exec(t);
      if (!m) continue;
      const claim = claims.find((c) => c.sourceKind === pg.kind && c.page === pg.index && (flat(c.excerpt).includes(m[0]) || flat(c.text).includes(m[0])));
      return { claimId: claim?.id, ref: `${pg.k} p${pg.index}`, excerpt: passageAt(lines, starts, m.index, m[0].length) };
    }
    return null;
  };
  const sig = (a: Acc, kind: Signal["kind"], text: string, effect: number, re?: RegExp, prefer: "form" | "deck" | "any" = "any") => {
    const c = re ? cite(re, prefer) : null;
    const s: Signal = { text, effect, kind, claimId: c?.claimId, ref: c?.ref, excerpt: c?.excerpt };
    a.hasEvidence = a.hasEvidence || kind === "support" || kind === "oppose";
    if (kind === "support") a.support.push(s);
    else if (kind === "oppose") a.oppose.push(s);
    else a.notes.push(s);
  };
  const metric = (m: string) => claims.filter((c) => c.metric === m && c.value != null);
  const anyMetric = (re: RegExp) => claims.filter((c) => c.metric && re.test(c.metric) && !c.metric.startsWith("projection:"));
  const conflictsFor = (cr: CriterionId) => conflicts.filter((c) => c.criteria.includes(cr) && c.status !== "explained");
  const isLending = p.tags.includes("lending");
  const isDeeptech = p.tags.includes("deeptech") || p.sectorKey === "deeptech";
  const A: Record<CriterionId, Acc> = {
    founder_quality: acc(),
    founder_market_fit: acc(),
    market: acc(),
    traction: acc(),
    business_model: acc(),
    product_tech: acc(),
    path_to_market: acc(),
    capital_fit: acc(),
    thesis_fit: acc(),
  };
  const revealed: RevealedCheck[] = [];

  // ---------------- Founder quality (execution evidence only; credentials never scored)
  {
    const a = A.founder_quality;
    if (p.founders.length) {
      a.hasEvidence = true;
      const creds = [...new Set((founderText + " " + deck).match(/\b(IIT [A-Z][a-z]+|IIM [A-Z][a-z]+|MBA[^.,]{0,25}|PhD|Ex-[A-Z][\w]+(?: [A-Z]\w+)?|Qualified Chartered Accountant|MBBS)\b/g) ?? [])];
      if (creds.length) sig(a, "note", `Credentials recorded but not scored: ${creds.slice(0, 5).join("; ")} (Meeting 3: "score the evidence, not the pedigree").`, 0);
      const builtRe = /\b(built|designed|wrote|developed)\b[^.]{0,50}\b(engine|app|sensor|firmware|model|rules|board|product|platform)/i;
      if (builtRe.test(founderText)) sig(a, "support", "A founder personally built the core product (named in the founder description).", 0.5, builtRe, "form");
      const discRe = /\b\d[\d,]*\s+(?:owner |customer |user |household )?(?:interviews|visits|plants|households?|parents)\b|survey of \d+|visits to \d+|\d+-household survey/i;
      if (discRe.test(all)) sig(a, "support", "First-hand customer discovery is documented (interviews, site visits or surveys) — the 'go to the customer first' pattern (RP-5).", 0.5, discRe);
      const fluency = [/repeat|cohort|retention|reorder/i, /\bCAC\b|acquisition cost|cost per/i, /gross margin/i, /payback/i, /contribution/i, /LTV/i].filter((re) => re.test(form)).length;
      if (fluency >= 3) sig(a, "support", `The founders report their own unit economics in the form (${fluency} of 6 core metrics) — operator fluency (Memo 7 Giva).`, 0.5, /gross margin|payback|repeat/i, "form");
      const candourRe = /not measured|have not measured|not audited|customer-reported|excludes founder time|including founder time|small sample|have churned|firms churned|we do not know/i;
      if (candourRe.test(all)) sig(a, "support", "Founders volunteer weaknesses or caveats unprompted (candour; Memo 3 Unbox 'described failures before we asked').", 0.5, candourRe);
      if (/co-founder left|co-founder has left|left in \w+ 20\d\d/i.test(form)) sig(a, "oppose", "A co-founder has left the company.", -0.75, /co-founder left|left in/i, "form");
      if (p.founders.length === 1) {
        sig(a, "oppose", "Solo founder: no co-founder covers technology or operations (cf. Memo 2 Petalry).", -0.25, /Founder/i, "form");
        a.unknowns.push("Who covers the functions the solo founder does not?");
      }
      const outsourcedRe = /led by an advisor|outsourced developers|contract developers|handled by contract/i;
      if (outsourcedRe.test(all)) sig(a, "oppose", "Core technology is outsourced or led by an advisor rather than a founder.", -0.5, outsourcedRe);
      const cred = conflicts.find((c) => c.type === "credential");
      if (cred) sig(a, "oppose", `Founder background is presented inconsistently across documents: ${cred.label}.`, -1, undefined);
      const mag = conflicts.find((c) => c.type === "magnitude");
      if (mag) sig(a, "oppose", `Deck overstates a figure the form quantifies lower: ${mag.label}.`, -0.5);
      if (isLending) {
        const ownsRe = /first-loss|follow up personally|credit-scoring rules|our credit rules|we bear|credit lead|risk team|defaults to date/i;
        const pushRe = /NBFC partner'?s? balance sheet|NBFC handles|partner handles|the NBFC'?s? problem|founder'?s? savings/i;
        if (ownsRe.test(all) && !/founder'?s? savings/i.test(all)) {
          sig(a, "support", "Founders show ownership of credit risk (first-loss, personal collections or own credit rules) — RP-1.", 0.5, ownsRe);
        } else if (pushRe.test(all)) {
          sig(a, "oppose", "Credit risk sits with a partner NBFC or the founder's personal savings, with no credit-risk owner named — RP-1 (Memo 6 CampusCredit).", -0.75, pushRe);
          a.unknowns.push("Who owns underwriting, defaults and collections?");
        } else a.unknowns.push("How do the founders manage credit risk and defaults?");
      }
      const fluffRe = /passion|with heart|love for|strong love|moving fast|we have a strong market/i;
      if (fluffRe.test(all) && fluency < 2) sig(a, "oppose", "Narrative relies on enthusiasm rather than numbers.", -0.25, fluffRe);
      if (/both full-time/i.test(form)) sig(a, "note", "Both founders full-time.", 0, /full-time/i, "form");
      a.unknowns.push("How founders respond when pressed on weak spots (observable only on a call).");
    } else a.unknowns.push("No founder information supplied.");
  }

  // ---------------- Founder-market fit
  {
    const a = A.founder_market_fit;
    const company = domainsOf(`${p.oneLiner ?? ""} ${F("built")} ${p.bundle.deckPages[0]?.text ?? ""}`);
    if (p.founders.length && p.founders.some((f) => f.background)) {
      a.hasEvidence = true;
      let matched = 0;
      let senior = false;
      for (const f of p.founders) {
        const d = domainsOf(`${f.role} ${f.background}`);
        const overlap = [...d].filter((x) => company.has(x));
        if (overlap.length) {
          matched++;
          const yrs = Number(/(\d+)\s+years/.exec(f.background)?.[1] ?? 0);
          if (yrs >= 5) senior = true;
          if (matched <= 2) sig(a, "support", `${f.name}: prior experience in ${overlap.join(", ")}${yrs ? ` (${yrs} years)` : ""} matches the problem.`, 0.75, new RegExp(f.name.split(" ")[0]), "form");
        }
      }
      if (senior) sig(a, "support", "At least one founder has 5+ years in the specific domain.", 0.25);
      if (!matched) sig(a, "oppose", `No founder background overlaps the company's domain (${[...company].join(", ") || "unclassified"}).`, -0.75);
      if (!company.size) a.unknowns.push("Company domain could not be classified from the submission.");
    } else a.unknowns.push("Founder backgrounds not supplied.");
  }

  // ---------------- Market
  {
    const a = A.market;
    const marketPage = p.bundle.deckPages.find((pg) => /\b(TAM|market)\b/i.test(pg.text.split("\n")[0] ?? "") || /\bTAM\b/.test(pg.text));
    const mText = marketPage ? flat(marketPage.text) : "";
    if (marketPage) {
      a.hasEvidence = true;
      const bottomUp = /\bTAM\b/.test(mText) && /\bSAM\b/.test(mText) && /\s[x×]\s/.test(mText);
      if (bottomUp) sig(a, "support", "Bottom-up sizing (TAM → SAM → SOM) with the multiplication shown.", 1, /\bSOM\b|\bTAM\b/, "deck");
      if (bottomUp && /based on|from our|survey|interviews|panel|our estimate|estimates/i.test(mText)) sig(a, "support", "Sizing assumptions and their source are stated.", 0.25, /based on|from our|survey|estimate/i, "deck");
      if (/(?:even|just|capturing)\s+(?:just\s+)?1%|1% of this market/i.test(mText)) sig(a, "oppose", "Top-down '1% of a large market' sizing — aspirational rather than evidenced (Memo 1).", -1, /1%/, "deck");
      else if (!bottomUp) sig(a, "oppose", "A single headline market figure with no build-up.", -0.5, /lakh Cr|market/i, "deck");
      if (!/assum|based on|survey|panel|estimate/i.test(mText)) a.unknowns.push("Source of market-size assumptions.");
    } else if (/\bTAM\b|market size/i.test(all)) {
      a.hasEvidence = true;
      sig(a, "note", "Market size mentioned outside a sizing slide.", 0, /TAM|market size/i);
    } else a.unknowns.push("No market sizing provided.");
    if (/no direct competitors/i.test(all)) sig(a, "oppose", "Claims 'no direct competitors' — unverified; competition research required.", -0.5, /no direct competitors/i);
    a.unknowns.push("Independent market data (not yet researched).");
  }

  // ---------------- Traction
  {
    const a = A.traction;
    const paying = anyMetric(/^count:\w+\|(paying|live|onboarded|active|open)$/);
    const customersField = F("customers") || F("users") || F("workers");
    if (paying.length || customersField) sig(a, "support", `Customers in hand: ${paying[0]?.text ?? customersField.slice(0, 80)}.`, 0.5, paying[0] ? new RegExp(paying[0].excerpt.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) : /customers/i);
    const rev = anyMetric(/^(mrr|arr|revenue|revenue_net|revenue_gross|gmv|volume|disbursed)$/);
    if (rev.length) sig(a, "support", `Revenue or volume reported: ${rev.slice(0, 2).map((r) => `${r.text} (${r.sourceLabel})`).join("; ")}.`, 0.5, /revenue|MRR|GMV|volume/i);
    const months = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b[\s\S]*\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b[\s\S]*\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/;
    const seriesPage = p.bundle.deckPages.find((pg) => months.test(pg.text) && /traction/i.test(pg.text));
    if (seriesPage) {
      const nums = (seriesPage.text.match(/^\d+(?:\.\d+)?$/gm) ?? []).map(Number);
      const growing = nums.length >= 3 && nums.slice(0, 5).every((n, i, arr) => i === 0 || n >= arr[i - 1]);
      if (growing) sig(a, "support", `Month-on-month series shows consistent growth (${nums.slice(0, 5).join(" → ")}).`, 0.5, /Traction/i, "deck");
    }
    const repeatNumRe = /(\d+%[^.]{0,40}(repeat|cohort|second trip|retention))|((repeat|retention|cohort)[^.]{0,40}\d+%)|net revenue retention \d+|\d+ of \d+ have ordered more than once|\d+ of whom have ordered more than once/i;
    const repeatHasNumber = repeatNumRe.test(all);
    if (repeatHasNumber) {
      const cohort = /cohort/i.test(all) && (all.match(/\d+%\s*\((?:\w+ )?cohort\)|\(\w+\)/g) ?? []).length >= 2;
      sig(a, "support", cohort ? "Repeat behaviour reported by cohort — the test the fund applies to every brand (Memo 7)." : "A repeat / retention figure is reported.", cohort ? 1 : 0.75, repeatNumRe); // cite the figure, not any mention of "retention"
    } else {
      const pol = criteria.criteria.find((c) => c.id === "traction")?.missingMetricPolicy.find((x) => x.sector === p.sectorKey && x.metric === "repeat");
      if (pol) {
        sig(a, "oppose", `No repeat rate reported. Criteria v${criteria.version} policy for ${p.sectorKey.replace("_", " ")}s lowers the score. ${pol.citation}`, -pol.penalty);
        a.rules.push(`Missing-metric policy: ${p.sectorKey}/repeat (−${pol.penalty})`);
      }
      a.unknowns.push("Repeat / retention rate not reported.");
    }
    if (/pilot-to-paid|pilot to paid|converted to paid|pilots? converted/i.test(all)) sig(a, "support", "Pilot-to-paid conversion is reported.", 0.25, /pilot-to-paid|converted to paid|pilots converted/i);
    const tc = conflictsFor("traction");
    tc.slice(0, 3).forEach((c) => sig(a, "oppose", `Conflicting figures: ${c.label}.`, -0.5));
    const vagueRe = /thousands of \w+|many 5-star|\b\d+x growth\b/i;
    if (vagueRe.test(deck) && !/\d+%/.test(deck)) sig(a, "oppose", "Traction stated vaguely (e.g. 'thousands', '3x growth') without base numbers.", -0.75, vagueRe, "deck");
    if (/customer-reported|not audited/i.test(all)) sig(a, "note", "Customer value figures are self-reported by customers and unaudited.", 0, /customer-reported|not audited/i);
    const regPaid = /(\d[\d,]*) registered\.? (\d[\d,]*) have paid/i.exec(all);
    if (regPaid) sig(a, "note", `${regPaid[2]} of ${regPaid[1]} registered users have paid at least once.`, 0, /have paid/i);
    if (!paying.length && !customersField && !rev.length) a.unknowns.push("No customer or revenue figures supplied.");
    a.hasEvidence = a.hasEvidence || !!(paying.length || customersField || rev.length);
  }

  // ---------------- Business model & economics
  {
    const a = A.business_model;
    const gmRe = /gross margin[^.\d]{0,30}(\d+)%|(\d+)% gross margin|about (\d+)% gross margin/i;
    const gm = gmRe.exec(all);
    if (gm) sig(a, "support", `Gross margin stated (${gm[1] ?? gm[2] ?? gm[3]}%).`, 0.5, gmRe);
    const cac = metric("cac");
    if (cac.length) sig(a, "support", `CAC stated: ${cac.map((c) => `${c.text} (${c.sourceLabel})`).slice(0, 2).join("; ")}.`, 0.25, /CAC|cost per|acquisition/i);
    else if (/not measured|have not measured/i.test(all)) a.unknowns.push("CAC not yet measured (founders say so).");
    else a.unknowns.push("CAC not reported.");
    if (/payback/i.test(all)) sig(a, "support", "Payback period stated.", 0.25, /payback/i);
    const ltv = /(\d+(?:\.\d+)?)x\s*(?:12-month )?LTV|LTV to CAC is about (\d+(?:\.\d+)?)x|LTV to CAC[^.]{0,20}(\d+(?:\.\d+)?)x/i.exec(all);
    if (ltv) {
      const v = Number(ltv[1] ?? ltv[2] ?? ltv[3]);
      sig(a, v >= 3 ? "support" : "note", `LTV:CAC ${v}x${v < 3 ? " — below the common 3x benchmark, though early cohorts" : ""}.`, v >= 3 ? 0.25 : 0, /LTV/i);
    }
    if (/contribution[^.]{0,40}(positive|\d+%)|positive contribution/i.test(all) && !/contribution margin negative|negative contribution/i.test(all)) sig(a, "support", "Positive contribution reported.", 0.25, /contribution/i);
    if (/negative contribution|contribution margin negative/i.test(all)) sig(a, "oppose", "Negative contribution margin.", -0.75, /negative/i);
    const nrr = /net revenue retention (\d+)%|(\d+)%\s*net revenue retention/i.exec(all);
    if (nrr && Number(nrr[1] ?? nrr[2]) > 100) sig(a, "support", `Net revenue retention ${nrr[1] ?? nrr[2]}%.`, 0.25, /net revenue retention/i);
    for (const c of conflicts.filter((x) => x.type === "definition")) sig(a, "oppose", `${c.label}: ${c.note}`, -0.5);
    if (/capex|per clinic|dark store/i.test(all) && p.tags.includes("capital_intensive")) sig(a, "oppose", "Capital-intensive unit build-out (capex per unit) — RP-4 (Memo 4 HopBox).", -0.5, /capex/i);
    const hw = /hardware INR ([\d.]+) L/i.exec(all);
    if (hw) sig(a, "note", `Most revenue to date is one-off hardware (INR ${hw[1]} L); recurring revenue is the smaller part.`, -0.25, /hardware/i);
    if (/founder'?s? savings/i.test(all) && isLending) sig(a, "oppose", "Part of the lending book is funded from the founder's personal savings.", -0.5, /savings/i);
    if (/single payment aggregator|rely on a single|single co-packer|one co-packer/i.test(all)) sig(a, "note", "Single-supplier or single-partner dependency.", -0.25, /single|one co-packer/i);
    const price = metric("price");
    if (price.length) sig(a, "note", `Pricing stated: ${price[0].text}.`, 0, /per seat|a month|per sensor|per firm/i);
    a.hasEvidence = a.hasEvidence || !!(gm || cac.length || price.length || /fee|commission|margin|subscription/i.test(all));
    if (/commission|fee/i.test(all) && !gm && !cac.length) sig(a, "note", "Revenue model stated (fee/commission) but no margin or CAC data.", 0, /commission|fee/i);
    if (!a.hasEvidence) a.unknowns.push("No business-model economics supplied.");
  }

  // ---------------- Product & technology
  {
    const a = A.product_tech;
    const built = F("built");
    const howPage = p.bundle.deckPages.find((pg) => /\b1\b[\s\S]*\b2\b[\s\S]*\b3\b/.test(pg.text) && pg.index > 1);
    if (built || howPage) sig(a, "support", "The product and how it works are described concretely.", 0.25, built ? /What have you built/i : /\b1\b/, built ? "form" : "deck");
    if (/\b(live|deployed|in production|paying)\b/i.test(all)) sig(a, "support", "Product is live with paying users.", 0.25, /live|paying|deployed/i);
    const propRe = /\b(matching engine|sensor board|firmware|credit-scoring|speech ML|transcription|small-data model|learns each motor|anomaly)/i;
    if (propRe.test(all)) sig(a, "support", "Proprietary technology built in-house is described.", 0.5, propRe);
    const manualRe = /hand-built|route templates|confirmed manually|manually on WhatsApp|run almost manually|manual operations/i;
    if (manualRe.test(all)) sig(a, "oppose", "Core delivery is still manual or template-based behind the AI claim.", -0.25, manualRe);
    if (p.tags.includes("ai") && !built && !howPage) sig(a, "oppose", "AI is claimed but the product is not described.", -0.5, /\bAI\b/);
    if (/reviewed by the CA|responsibility sits/i.test(all)) sig(a, "note", "Liability for AI output is assigned (human review before filing).", 0, /responsibility|reviewed/i);
    if (isDeeptech) {
      a.unknowns.push("Technical validation (accuracy across conditions, calibration) — for Aditya's technical review.");
      sig(a, "note", "Deeptech: technical feasibility review by Aditya required before a decision (Meeting 3).", 0);
    }
    a.hasEvidence = a.hasEvidence || !!(built || howPage);
    if (!built && !howPage) a.unknowns.push("Product not described.");
  }

  // ---------------- Path to market (scored separately from founder quality — Meeting 3)
  {
    const a = A.path_to_market;
    const acq = `${F("acquisition")} ${F("channel_mix")}`;
    const gtmPage = p.bundle.deckPages.find((pg) => /go-to-market|acquisition|distribution/i.test(pg.text.split("\n")[0] ?? ""));
    const gtm = flat(`${acq} ${gtmPage?.text ?? ""}`);
    const channelCount = (gtm.match(/\d+%|\d+ of \d+/g) ?? []).length;
    if (channelCount >= 2) sig(a, "support", "Acquisition is broken down by channel with numbers.", 0.75, /\d+% of new|of \d+ (paid )?customers|of \d+ (teams|stores)|referrals \d+%|\d+% of new/i);
    if ((gtm.match(/CAC|INR \d/g) ?? []).length >= 3) sig(a, "support", "Acquisition cost is reported per channel.", 0.25, /CAC by channel|per channel|nutritionist/i);
    const partnerRe = /association|distributor|accountant partners|CA and accountant|nutritionist|consultants|channel partner|cluster/i;
    if (partnerRe.test(gtm)) sig(a, "support", "A partner or intermediary channel is working (scalable beyond founders).", 0.25, partnerRe);
    const networkRe = /mostly (?:the )?founders'? network|mostly organic|word of mouth|direct outreach by the founder/i;
    if (networkRe.test(gtm) && !/\d+%/.test(F("acquisition"))) sig(a, "oppose", "Acquisition relies on founder network or word of mouth with no measured cost.", -0.5, networkRe, "form");
    const regRe = /changed rules|rules on rent|recording restrictions|regulation of digital lending|not registered as an NBFC|regulatory scrutiny|card networks/i;
    if (regRe.test(all)) sig(a, "oppose", "Distribution depends on a regulatory or partner permission that could change.", -0.5, regRe);
    if (/not registered as an NBFC/i.test(all) && isLending) {
      sig(a, "oppose", "Lends without an NBFC registration; the partner arrangement is inconsistent across documents.", -0.5, /not registered/i);
      a.unknowns.push("Regulatory structure of the credit product (RBI digital lending directions).");
    }
    if (isDeeptech || p.tags.includes("hardware")) {
      const milestoneRe = /milestone|certif\w+ (?:by|in|within) (?:Q\d|20\d\d|\d+ months)|approval timeline|regulator-facing|DGCA|BIS cert|type approval/i;
      if (milestoneRe.test(all)) sig(a, "support", "A regulatory / certification milestone sequence is given (RP-3, Memo 1 ePlane).", 0.5, milestoneRe);
      else if (/certification/i.test(all)) {
        sig(a, "oppose", "Certification is budgeted but no milestone sequence or timeline is given (RP-3, Memo 8 AeroDrop).", -0.25, /certification/i);
        a.unknowns.push("Certification / regulatory milestone sequence and timeline.");
      } else {
        sig(a, "oppose", "No regulatory or certification plan for a hardware/deeptech product (RP-3).", -0.5);
        a.unknowns.push("Regulatory and certification path.");
      }
    }
    if (/no direct competitors/i.test(all)) sig(a, "oppose", "Claims no direct competitors — competitive path unexamined.", -0.25, /no direct competitors/i);
    const mk = /(\d+)%\s*Marketing/i.exec(deck);
    if (mk && Number(mk[1]) >= 50) sig(a, "oppose", `${mk[1]}% of the raise goes to marketing — growth is planned to be bought.`, -0.25, /Marketing/i, "deck");
    a.hasEvidence = a.hasEvidence || !!(acq.trim() || gtmPage);
    if (!acq.trim() && !gtmPage) a.unknowns.push("Go-to-market and acquisition channels not described.");
  }

  // ---------------- Capital & fund fit
  {
    const a = A.capital_fit;
    if (p.stageKey === "pre_seed") sig(a, "support", `Stage: ${p.stage} — matches the pre-seed mandate.`, 1, /Stage|Pre-seed/i);
    else if (p.stageKey === "seed") sig(a, "support", `Stage: ${p.stage} — adjacent to the pre-seed mandate.`, 0.25, /Stage|Seed/i);
    else if (p.stageKey === "series_a_plus") sig(a, "oppose", `Stage: ${p.stage} — outside a pre-seed fund's mandate; the company is seeking a lead for a priced round.`, -2, /Series/i);
    else a.unknowns.push("Stage not stated.");
    if (p.raiseInr != null) {
      a.hasEvidence = true;
      if (p.raiseInr <= 3.5e7) sig(a, "support", `Round size ${formatInr(p.raiseInr)} is consistent with a pre-seed round.`, 0.5, /raising|Amount raising/i);
      else if (p.raiseInr > 1e8) sig(a, "oppose", `Round size ${formatInr(p.raiseInr)} is far above a pre-seed round.`, -1, /raising|Amount raising/i);
    } else a.unknowns.push("Amount being raised not stated.");
    const uof = `${F("use_of_funds")} ${deck}`;
    const heavy = /(\d+)%\s*(?:Inventory|Credit book|Advances book|Financing book|Five new clinics|new clinics|Working capital)/gi;
    const heavyShare = [...uof.matchAll(heavy)].reduce((n, m) => n + Number(m[1]), 0);
    if (heavyShare >= 40) sig(a, "oppose", `${heavyShare}% of the raise funds inventory, a loan book or physical build-out — equity used as working capital (RP-4).`, -0.5, /book|inventory|clinics|working capital/i, "deck");
    if (p.valuationInr) sig(a, "note", `Valuation expectation: ${formatInr(p.valuationInr)} post-money.`, 0, /post-money/i);
    if (/series a|lead investor/i.test(all) && p.stageKey !== "series_a_plus") a.unknowns.push("Round structure unclear.");
  }

  // ---------------- Thesis fit: stated vs revealed (never merged)
  let stated: Evaluation["statedThesis"];
  {
    const a = A.thesis_fit;
    a.hasEvidence = p.sectorKey !== "unknown";
    if (thesis.stated.sectors.includes(p.sectorKey)) {
      stated = { fit: "in_scope", detail: `${p.sectorSelected ?? p.sectorKey} is within the stated focus (${thesis.stated.text})` };
      sig(a, "support", `Stated thesis: ${p.sectorKey.replace("_", " ")} is in the public focus list.`, 1, /Sector/i, "form");
    } else if (p.sectorKey === "web3") {
      stated = { fit: "anti_thesis", detail: "Crypto/web3 — passed on category alone in Memo 10 Coinlane." };
      sig(a, "oppose", "Category passed on by the fund regardless of founder (Memo 10 Coinlane).", -2.5, /crypto|web3/i);
    } else if (p.sectorKey === "unknown") {
      stated = { fit: "unknown", detail: "Sector could not be determined." };
      a.unknowns.push("Sector not stated.");
    } else {
      stated = { fit: "out_of_scope", detail: `${p.sectorSelected ?? p.sectorKey} is not in the stated focus list (fintech, deeptech, consumer tech, consumer brands).` };
      sig(a, "oppose", `Stated thesis: ${p.sectorSelected ?? p.sectorKey} is outside the public focus list.`, -1.5, /Sector/i, "form");
    }
    if (p.sectorSelected && /consumer tech/i.test(p.sectorSelected) && p.tags.includes("b2b")) {
      sig(a, "note", `Applicant selected "${p.sectorSelected}" but sells to businesses — sector label and model differ.`, 0, /Sector/i, "form");
    }
    const push = (patternId: string, result: RevealedCheck["result"], detail: string, effect: number) => {
      revealed.push({ patternId, result, detail });
      if (result === "consistent") sig(a, "support", `Revealed ${patternId}: ${detail}`, effect);
      else if (result === "concern") sig(a, "oppose", `Revealed ${patternId}: ${detail}`, effect);
    };
    // RP-1 risk ownership
    if (isLending) {
      const fq = A.founder_quality;
      if (fq.support.some((s) => /ownership of credit risk/.test(s.text))) push("RP-1", "consistent", "Founders take first-loss / manage defaults themselves.", 0.5);
      else if (fq.oppose.some((s) => /Credit risk sits/.test(s.text))) push("RP-1", "concern", "Credit risk sits with a partner or personal savings; no risk owner named.", -0.75);
      else push("RP-1", "unknown", "Lending model; risk ownership not evidenced either way.", 0);
    } else push("RP-1", "not_applicable", "Not a lending business.", 0);
    // RP-2 consumer brand repeat
    if (p.sectorKey === "consumer_brand") {
      const hasRepeat = A.traction.support.some((s) => /Repeat|repeat/.test(s.text));
      push("RP-2", hasRepeat ? "consistent" : "concern", hasRepeat ? "Cohort repeat data is reported." : "No repeat rate for a consumer brand.", hasRepeat ? 0.5 : -0.75);
    } else push("RP-2", "not_applicable", "Not a consumer brand.", 0);
    // RP-3 deeptech
    if (isDeeptech) {
      const hasMilestone = A.path_to_market.support.some((s) => /milestone/.test(s.text));
      const hasCustomer = A.traction.support.some((s) => /Customers in hand/.test(s.text));
      push("RP-3", hasMilestone && hasCustomer ? "consistent" : hasCustomer ? "unknown" : "concern", `${hasCustomer ? "Paying customers exist" : "No paying customer"}; ${hasMilestone ? "milestone plan given" : "no regulator/certification milestone sequence"}. Aditya to run the second call.`, hasMilestone && hasCustomer ? 0.5 : hasCustomer ? 0 : -0.75);
    } else push("RP-3", "not_applicable", "Not deeptech.", 0);
    // RP-4 capital intensity
    if (A.capital_fit.oppose.some((s) => /working capital|build-out/.test(s.text)) || A.business_model.oppose.some((s) => /Capital-intensive/.test(s.text)))
      push("RP-4", "concern", "Model needs capital beyond a pre-seed cheque (inventory, loan book or physical build-out).", -0.25);
    else push("RP-4", "consistent", "No sign the model needs more capital than a pre-seed cheque can carry.", 0);
    // RP-5 field first
    if (A.founder_quality.support.some((s) => /customer discovery/.test(s.text))) push("RP-5", "consistent", "Documented field work with customers before scaling.", 0.25);
    else push("RP-5", "unknown", "No documented customer discovery in the submission.", 0);
    // RP-6 regulatory dependence of the category
    if (/changed rules on|depends on (?:favourable )?regulat|crypto/i.test(all)) push("RP-6", "concern", "The category's viability depends on rules set by banks, card networks or regulators.", -0.5);
    else push("RP-6", "not_applicable", "No category-level regulatory dependence identified.", 0);
    // RP-7 founder-dependent product
    if (/our teacher|content-led|influencer|following/i.test(all)) push("RP-7", "concern", "Product may depend on the founder's personal audience.", -0.25);
    else push("RP-7", "not_applicable", "Not a founder-dependent content product.", 0);
    // RP-8 portfolio conflict
    const direct = overlap?.results.filter((r) => r.relationship === "direct_competitor") ?? [];
    if (direct.length) push("RP-8", "concern", `Possible direct overlap with portfolio company ${direct.map((d) => d.portfolioName).join(", ")} — default is no unless both founders are told.`, -0.5);
    else push("RP-8", overlap?.datasetVerified ? "consistent" : "unknown", overlap?.datasetVerified ? "No overlap found." : "No overlap found in an incomplete portfolio dataset.", 0);
    revealed.push({ patternId: "RP-9", result: "unknown", detail: "Contested drift observation (Meeting 5). Shown for transparency; not scored." });
  }

  // ---------------- Learning rules (approved only)
  const appliedLearning: string[] = [];
  const ruleAdj: Partial<Record<CriterionId, number>> = {};
  for (const r of input.learningRules.filter((x) => x.status === "approved")) {
    const sectorOk = !r.condition.sectors.length || r.condition.sectors.includes(p.sectorKey);
    const kwOk = !r.condition.keywords.length || r.condition.keywords.some((k) => all.toLowerCase().includes(k.toLowerCase()));
    if (sectorOk && kwOk) {
      ruleAdj[r.criterion] = (ruleAdj[r.criterion] ?? 0) + r.adjustment;
      A[r.criterion].rules.push(`Learning rule ${r.id} v${r.version}: ${r.adjustment > 0 ? "+" : ""}${r.adjustment} — ${r.note}`);
      appliedLearning.push(r.id);
    }
  }

  // ---------------- Conflicts lower credibility on every criterion they touch (traction handled above)
  for (const id of Object.keys(A) as CriterionId[]) {
    if (id === "traction") continue;
    const cf = conflictsFor(id).filter((c) => !(id === "founder_quality" && (c.type === "credential" || c.type === "magnitude")));
    let pen = 0;
    for (const c of cf) {
      const e = c.severity === "high" ? -0.5 : c.severity === "medium" ? -0.25 : 0;
      if (pen + e < -1) break;
      pen += e;
      sig(A[id], "oppose", `Unresolved conflict reduces credibility: ${c.label}.`, e);
    }
  }

  // ---------------- Assemble
  const assessments: CriterionAssessment[] = criteria.criteria.map((def) => {
    const a = A[def.id];
    const effects = [...a.support, ...a.oppose, ...a.notes].reduce((n, s) => n + s.effect, 0) + (ruleAdj[def.id] ?? 0);
    const score = a.hasEvidence ? Math.max(1, Math.min(5, Math.round((3 + effects) * 2) / 2)) : null;
    const cf = conflictsFor(def.id);
    // Conflicting evidence caps a score at 4 until a reviewer resolves the conflict.
    const capped = score !== null && cf.length && score > 4 ? 4 : score;
    let state: EvidenceState;
    if (score === null) state = "insufficient";
    else if (cf.length) state = "conflicting";
    else if (a.support.length && a.oppose.length) state = "mixed";
    else if (a.support.length >= 2) state = "strong";
    else state = "weak";
    // Confidence is capped at medium until independent evidence exists (nothing is verified in demo mode).
    let confidence: Confidence = state === "strong" ? "medium" : state === "mixed" ? "medium" : "low";
    if (state === "conflicting" || state === "insufficient") confidence = "low";
    const name = def.name;
    const rationale =
      score === null
        ? `${name}: insufficient evidence in the submission to score. Unknown is not treated as zero.`
        : `${name} scored ${capped}/5${capped !== score ? " (capped at 4 by unresolved conflicts)" : ""} from ${a.support.length} supporting and ${a.oppose.length} opposing signals${cf.length ? `, with ${cf.length} unresolved conflict(s)` : ""}. All evidence is applicant-provided; nothing has been independently verified.`;
    return {
      criterion: def.id,
      score: capped,
      evidenceState: state,
      confidence,
      supporting: a.support,
      opposing: a.oppose,
      notes: a.notes,
      unknowns: [...new Set(a.unknowns)],
      rationale,
      appliedRules: a.rules,
      reviewerComments: [],
    };
  });

  const scored = assessments.filter((x) => x.score !== null);
  const wsum = scored.reduce((n, x) => n + (criteria.criteria.find((c) => c.id === x.criterion)?.weight ?? 1), 0);
  const overall = scored.length ? Math.round((scored.reduce((n, x) => n + x.score! * (criteria.criteria.find((c) => c.id === x.criterion)?.weight ?? 1), 0) / wsum) * 100) / 100 : null;
  const coverage = assessments.length ? scored.length / assessments.length : 0;

  // ---------------- Flags
  const flags: Flag[] = [];
  const highConf = conflicts.filter((c) => c.severity === "high");
  if (conflicts.length) flags.push({ level: highConf.length ? "critical" : "warning", text: `${conflicts.length} conflicting claim(s) between documents — shown side by side, none resolved automatically.` });
  if (overlap) {
    if (overlap.results.length) flags.push({ level: "critical", text: `Possible portfolio conflict: ${overlap.results.map((r) => `${r.portfolioName} (${r.relationship.replace(/_/g, " ")})`).join(", ")}. Not confirmed — requires review.` });
    if (!overlap.datasetVerified) flags.push({ level: "warning", text: overlap.statusText });
  } else flags.push({ level: "warning", text: "Portfolio overlap check has not run." });
  if (isDeeptech) flags.push({ level: "info", text: "Deeptech: Kushal may share this application with Aditya for technical review (Meeting 3). Access is granted explicitly, never from document content." });
  if (isLending) flags.push({ level: "info", text: "Lending model: risk-ownership check applied (RP-1)." });
  if (!p.hasDeck) flags.push({ level: "warning", text: "No deck supplied — deck/form cross-checks not possible." });
  if (!p.hasForm) flags.push({ level: "warning", text: "No application form supplied — fields inferred from the deck." });
  // P2 · C6: every passage set aside by screening is visible to the reviewer. A flag is a prompt for review,
  // not a judgement about the founder.
  for (const s of p.screening?.spans ?? []) {
    const loc = spanLocation(s);
    if (s.restored) flags.push({ level: "info", text: `Reviewer restored the set-aside passage [${s.id}] on ${loc}; it is scored as an unverified founder claim.` });
    else if (s.kind === "suspected_instruction") flags.push({ level: "critical", text: `Possible instruction to the evaluator on ${loc} [${s.id}] (${s.reasons.map((r) => r.replace(/_/g, " ")).join(", ")}) was set aside and not scored. This prompts human review; it is not proof of bad faith.` });
    else flags.push({ level: "warning", text: `Hypothetical figures on ${loc} [${s.id}] were set aside and not scored as reported results.` });
  }
  flags.push({ level: "info", text: "No external research performed. All evidence is applicant-provided (MockAIProvider does not research)." });

  // ---------------- Recommendation (never a decision)
  const reasons: string[] = [];
  const score = (id: CriterionId) => assessments.find((x) => x.criterion === id)?.score ?? null;
  const integrity = conflicts.some((c) => c.type === "credential" || c.type === "magnitude");
  let rec: Recommendation;
  const capital = score("capital_fit");
  if (capital !== null && capital <= 1.5) {
    rec = "pass_for_consideration";
    reasons.push("Stage or round size is outside the pre-seed mandate (capital fit ≤ 1.5).");
  } else if (stated.fit === "anti_thesis") {
    rec = "pass_for_consideration";
    reasons.push("Category the fund has passed on regardless of founder (Memo 10).");
  } else if (overall === null || coverage < 0.5) {
    rec = "request_info";
    reasons.push("Too little evidence to assess: fewer than half the criteria could be scored.");
  } else if (stated.fit === "out_of_scope" && overall < 3.8) {
    rec = "pass_for_consideration";
    reasons.push(`Outside the stated thesis (${p.sectorSelected ?? p.sectorKey}) and overall ${overall} is not strong enough to argue for an exception.`);
  } else if (overall < 2.75) {
    rec = "pass_for_consideration";
    reasons.push(`Overall ${overall}/5 is below the call threshold (2.75).`);
  } else if (integrity) {
    rec = overall >= 3 ? "request_info" : "pass_for_consideration";
    reasons.push("The deck and form present the company or founder inconsistently; resolve before spending partner time.");
  } else if (overall >= 3.4 && highConf.length <= 1) {
    rec = "take_call";
    reasons.push(`Overall ${overall}/5 with ${Math.round(coverage * 100)}% criteria coverage.`);
    if (highConf.length) reasons.push(`Use the call to resolve: ${highConf[0].label}.`);
  } else {
    rec = "request_info";
    reasons.push(`Overall ${overall}/5; ${highConf.length} high-severity conflict(s) and ${assessments.reduce((n, a) => n + a.unknowns.length, 0)} open unknowns.`);
  }
  if (rec === "take_call" && overlap?.results.some((r) => r.relationship === "direct_competitor")) {
    rec = "request_info";
    reasons.push("Possible direct overlap with a portfolio company — Kushal to speak to the portfolio founder before any call (RP-8, Meeting 4).");
  }
  // P4 · P-B (strict): an out-of-thesis "take a call" needs independent evidence that a person logged and reviewed.
  // Applicant figures alone (however often repeated across form and deck) hold it at "request info". Scores,
  // weights and thresholds are unchanged; this only constrains the recommendation and never passes or rejects.
  if (rec === "take_call" && stated.fit === "out_of_scope") {
    const support = (input.reviewedEvidence ?? []).filter(qualifiesForThesisException);
    if (!support.length) {
      rec = "request_info";
      reasons.length = 0;
      reasons.push(
        `Thesis exception not supported (P-B): ${p.sectorSelected ?? p.sectorKey} is outside the stated thesis, and the case for a call (overall ${overall}/5) rests only on applicant-provided figures. Repeating a claim in the form and the deck is not independent corroboration. Held at "request info" until a reviewer logs independent supporting evidence.`,
      );
      flags.push({ level: "warning", text: "Thesis exception held at request info: no independent evidence has been logged by a reviewer (P-B). The score is unchanged." });
    } else {
      reasons.push(`Thesis exception supported by independent evidence logged by a reviewer (P-B): ${support.map((e) => `"${e.title}" (${e.sourceType.replace(/_/g, " ")}, ${e.publisher}; logged by ${e.addedBy} on ${e.loggedAt.slice(0, 10)}; criteria: ${e.criteria.join(", ")})`).join("; ")}.`);
    }
  }
  if (rec !== "pass_for_consideration" && highConf.length) reasons.push(`Ask about: ${highConf.map((c) => c.label).join("; ")}.`);
  // P2 · C5 (wording only): name a thesis exception explicitly. Thresholds and rules are unchanged.
  if (rec === "take_call" && stated.fit === "out_of_scope") reasons.push(`Thesis exception: ${p.sectorSelected ?? p.sectorKey} is outside the stated thesis. This call rests on applicant-provided figures that have not been independently verified.`);

  const criticalUnknowns = [
    ...assessments.filter((a) => a.score === null).map((a) => `${criteria.criteria.find((c) => c.id === a.criterion)?.name}: insufficient evidence`),
    ...A.founder_quality.unknowns.filter((u) => /credit risk|Who owns/i.test(u)),
    ...A.path_to_market.unknowns.filter((u) => /Regulatory|regulatory|Certification/i.test(u)),
    ...A.traction.unknowns.filter((u) => /Repeat/i.test(u) && p.sectorKey === "consumer_brand"),
  ];

  // P2 · C7: generated result text never carries phone numbers, email addresses or links from founder text.
  const R = redactContactDetails;
  const redactSignal = (s: Signal): Signal => ({ ...s, text: R(s.text), excerpt: s.excerpt === undefined ? undefined : R(s.excerpt) });
  for (const a of assessments) {
    a.supporting = a.supporting.map(redactSignal);
    a.opposing = a.opposing.map(redactSignal);
    a.notes = a.notes.map(redactSignal);
    a.unknowns = a.unknowns.map(R);
    a.rationale = R(a.rationale);
  }
  return {
    id: `ev_${input.applicationId}_${Date.now().toString(36)}`,
    applicationId: input.applicationId,
    cycleId: input.cycleId,
    thesisVersionId: thesis.id,
    criteriaVersionId: criteria.id,
    portfolioDatasetVersion: overlap?.datasetVersion ?? "none",
    provider: providerId,
    providerLabel,
    simulated: true,
    createdAt: input.now,
    assessments,
    overall,
    coverage,
    recommendation: rec,
    recommendationReasons: reasons.map(R),
    flags: flags.map((f) => ({ ...f, text: R(f.text) })),
    statedThesis: stated,
    revealedThesis: revealed,
    appliedLearningRules: appliedLearning,
    criticalUnknowns: criticalUnknowns.map(R),
  };
}
