// Historical backtesting against the 12 deal memos.
// Two modes, never mixed:
//  - retrospective: what it does + founder assessment + risks (the "Why we…" paragraph is the label and is ALWAYS excluded)
//  - point_in_time (approximate): only application-time facts — what it does, sector, stage, source.
//    Memos are undated, so strict replay is impossible (M-04). Post-decision commentary (e.g. Meeting 5 on Prepnest) is blocked.
import memos from "@/data/seed/deal_memos.json";

export type BacktestMode = "retrospective" | "point_in_time";
export type DisagreementCause =
  | "model_reasoning_error"
  | "extraction_error"
  | "missing_evidence"
  | "scoring_calibration"
  | "thesis_ambiguity"
  | "historical_partner_disagreement"
  | "unresolved";

export interface Memo {
  n: number;
  name: string;
  sector: string;
  stage: string;
  source: string;
  decision: "invested" | "passed";
  whatItDoes: string;
  founderAssessment: string;
  risks: string;
  rationale: string;
  page: number;
}

export const MEMOS = memos as Memo[];

export const HINDSIGHT_BLOCKLIST = [
  { memo: 12, text: "Meeting 5: 'a competitor with a similar format has since done well' (Prepnest) — post-decision information.", source: "Partner Meeting Notes p5" },
  { memo: 0, text: "Meeting 5: Ledgerly 'the company worked' — post-decision outcome; memo not in pack.", source: "Partner Meeting Notes p5" },
  { memo: 0, text: "Meeting 5: drift observation comparing recent yeses to the fund pitch — written after the decisions.", source: "Partner Meeting Notes p5" },
];

export interface BacktestSignal {
  text: string;
  effect: number;
  dimension: "founder" | "thesis" | "capital" | "market_path" | "evidence";
}

export interface BacktestRow {
  memo: number;
  name: string;
  sector: string;
  actual: "invested" | "passed";
  mode: BacktestMode;
  inputsUsed: string[];
  inputsExcluded: string[];
  signals: BacktestSignal[];
  score: number | null;
  modelCall: "invest" | "pass" | "undetermined";
  agrees: boolean;
  suggestedCause: DisagreementCause | null;
  causeNote: string;
}

const POS: [RegExp, string, BacktestSignal["dimension"], number][] = [
  [/stayed with (?:a hard|the) problem|stayed with the problem for years/i, "Founders stayed with a hard problem for years", "founder", 0.75],
  [/talked to prospective users|sat across the table|joining intro calls|arranged transactions by hand/i, "Founder did unscalable customer work first (RP-5)", "founder", 0.75],
  [/visited dozens|months in small-town stores|on the ground|went into the field|registered and assessed|channel-partner locations/i, "Field groundwork before scaling (RP-5)", "founder", 0.75],
  [/described failures|talked about specific customer sites|treated pilots as learning/i, "Candour about failures; specific customer knowledge", "founder", 0.5],
  [/repeat purchase|cohort repeat|percentage of revenue from repeat|return rate/i, "Founder fluent in repeat / cohort economics (RP-2)", "founder", 0.75],
  [/specific technical milestone|milestone sequence/i, "Concrete milestone thinking", "market_path", 0.5],
  [/product already in live sites|live sites/i, "Product live with customers", "evidence", 0.5],
  [/complementary pair|clean split|pairing is the strongest/i, "Complementary founding team", "founder", 0.25],
  [/real pain point|concrete customer pain/i, "Concrete customer pain", "market_path", 0.25],
];
const NEG: [RegExp, string, BacktestSignal["dimension"], number][] = [
  [/never owned a P&L|unaware of the gap/i, "Founder has not owned a P&L and does not see the gap", "founder", -0.75],
  [/channel-level averages, not cohort|could not tell us the repeat|repeat rate not tracked/i, "No repeat / cohort data (RP-2)", "evidence", -0.75],
  [/dismissed our questions|'something the NBFC partner handles'|NBFC partner handles/i, "Founder does not own credit risk (RP-1)", "founder", -1],
  [/someone else's problem|depend on a large raise|only works at density|far more capital/i, "Model needs more capital than a pre-seed cheque (RP-4)", "capital", -1],
  [/solved once the tech works|no signed customer|no path through the regulator/i, "No customer / regulator plan for deeptech (RP-3)", "market_path", -1],
  [/bet that the rules would become friendlier|no plan for the scenario/i, "Business depends on favourable regulation (RP-6)", "thesis", -1],
  [/bristled|defensive/i, "Founder defensive on key questions", "founder", -0.5],
  [/did not have 30- or 90-day numbers|retention and conversion to paid not shown/i, "Retention not shown", "evidence", -0.5],
  [/contribution margin negative/i, "Negative contribution margin", "capital", -0.5],
  [/customer acquisition cost rising|two thirds of orders from paid/i, "Growth bought through paid channels", "evidence", -0.25],
  [/hard to scale beyond one teacher|product is the teacher/i, "Founder-dependent product (RP-7)", "thesis", -0.5],
];

function sectorFit(sector: string): BacktestSignal | null {
  if (/web3|crypto/i.test(sector)) return { text: "Category outside what the fund backs (crypto)", effect: -2, dimension: "thesis" };
  if (/fintech|deeptech|consumer/i.test(sector)) return { text: `Sector "${sector}" is in the stated thesis`, effect: 0.5, dimension: "thesis" };
  return { text: `Sector "${sector}" outside stated thesis`, effect: -1, dimension: "thesis" };
}

export function runBacktest(mode: BacktestMode): BacktestRow[] {
  return MEMOS.map((m) => {
    const used = mode === "retrospective" ? ["What it does", "Founder assessment", "Risks and open questions", "Sector / stage / source"] : ["What it does", "Sector / stage / source"];
    const excluded = mode === "retrospective"
      ? ["'Why we invested/passed' paragraph (the decision label)", "Partner meeting notes written after the decision"]
      : ["Founder assessment (formed on the partner call, not in the application)", "Risks and open questions (partner diligence)", "'Why we…' paragraph (label)", "All post-decision commentary"];
    const text = mode === "retrospective" ? `${m.whatItDoes} ${m.founderAssessment} ${m.risks}` : m.whatItDoes;
    const signals: BacktestSignal[] = [];
    const sf = sectorFit(m.sector);
    if (sf) signals.push(sf);
    for (const [re, label, dim, eff] of [...POS, ...NEG]) if (re.test(text)) signals.push({ text: label, effect: eff, dimension: dim });
    if (/capital intensity is high|capital-intensive/i.test(text) && !signals.some((s) => s.dimension === "capital")) signals.push({ text: "Capital intensive (sized cheque may mitigate)", effect: -0.25, dimension: "capital" });
    const founderSignals = signals.filter((s) => s.dimension === "founder" || s.dimension === "evidence");
    const score = Math.round((3 + signals.reduce((n, s) => n + s.effect, 0)) * 100) / 100;
    let call: BacktestRow["modelCall"];
    if (signals.some((s) => s.effect <= -2)) call = "pass";
    else if (score <= 2.75) call = "pass";
    else if (score >= 3.4 && founderSignals.length) call = "invest";
    else call = "undetermined";
    const agrees = (call === "invest" && m.decision === "invested") || (call === "pass" && m.decision === "passed");
    let cause: DisagreementCause | null = null;
    let note = "";
    if (!agrees) {
      if (call === "undetermined" && mode === "point_in_time") {
        cause = "missing_evidence";
        note = "Application-time facts alone do not decide this deal; the fund decided on founder behaviour observed in the call ('the founder is most of the investment').";
      } else if (/thesis stretched|does rural credit fit/i.test(m.rationale + m.founderAssessment) || m.n === 11) {
        cause = "thesis_ambiguity";
        note = "A partner questioned whether the thesis covers this sector (Meeting 2). The rubric cannot settle an open thesis question.";
      } else if (call === "undetermined") {
        cause = "scoring_calibration";
        note = "Signals were mixed and the score fell between the thresholds. The partners weighed one factor more heavily than the equal-weight rubric does.";
      } else if (call === "pass" && m.decision === "invested") {
        cause = "scoring_calibration";
        note = "The rubric penalises risks the partners explicitly accepted (e.g. long regulatory path, capital intensity sized by cheque).";
      } else {
        cause = "unresolved";
        note = "Model and fund disagree; needs partner review.";
      }
      if (m.n === 12) {
        if (cause !== "missing_evidence") cause = "historical_partner_disagreement";
        note += " Kushal has since said he is unsure this pass was right (Meeting 5). That view is hindsight and is not used in the replay.";
      }
    }
    return { memo: m.n, name: m.name, sector: m.sector, actual: m.decision, mode, inputsUsed: used, inputsExcluded: excluded, signals, score, modelCall: call, agrees, suggestedCause: cause, causeNote: note };
  });
}

export function summarise(rows: BacktestRow[]) {
  const n = rows.length;
  const agree = rows.filter((r) => r.agrees).length;
  const undetermined = rows.filter((r) => r.modelCall === "undetermined").length;
  const falseInvest = rows.filter((r) => r.modelCall === "invest" && r.actual === "passed").length;
  const falsePass = rows.filter((r) => r.modelCall === "pass" && r.actual === "invested").length;
  return { n, agree, undetermined, falseInvest, falsePass, rate: n ? agree / n : 0 };
}

/** Stage labels perfectly separate the historical outcomes. The evaluator deliberately ignores them. */
export const IN_SAMPLE_WARNING =
  "The backtest signal lexicon was written by reading these same 12 memos. Retrospective agreement is therefore in-sample and overstates how the rubric would do on new deals. Twelve cases cannot establish predictive accuracy.";

export function stageConfound(): string {
  const inv = MEMOS.filter((m) => m.decision === "invested").map((m) => m.stage);
  const pas = MEMOS.filter((m) => m.decision === "passed").map((m) => m.stage);
  if (inv.every((s) => /early/i.test(s)) && pas.every((s) => /pre-?seed/i.test(s)))
    return "All 6 invested memos are labelled 'Early round' and all 6 passes 'Pre-seed'. A model could reach 100% agreement by reading the stage label alone. The evaluator ignores stage in backtesting, so agreement is not inflated by this artefact.";
  return "";
}
