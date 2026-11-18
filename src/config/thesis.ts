import type { CriteriaVersion, ThesisVersion } from "@/lib/shared/types";

// Thesis v1. Stated layer = only what the case says is public. Revealed layer = patterns in the memos
// and partner notes, each cited. Status "proposed": nothing here is approved fund policy.

export const THESIS_V1: ThesisVersion = {
  id: "thesis-v1",
  version: 1,
  status: "proposed",
  createdBy: "system",
  createdAt: "2026-11-18T00:00:00.000Z",
  stated: {
    text: "Pre-seed investing across fintech, deeptech, consumer tech and consumer brands.",
    sectors: ["fintech", "deeptech", "consumer_tech", "consumer_brand"],
    stage: "Pre-seed",
    source: "Case brief p1 (All In Capital — The Firm). The fund publishes no rubric, ownership target or exclusion list.",
  },
  revealed: [
    {
      id: "RP-1",
      title: "Lending founders must own credit risk",
      description:
        "Credit businesses are backed when the founders treat default and collections risk as theirs, and passed when risk is pushed to a partner.",
      citations: ["Memo 6 CampusCredit (passed)", "Memo 11 Jai Kisan (invested)", "Meeting 2"],
      status: "observed",
    },
    {
      id: "RP-2",
      title: "Consumer brands need repeat and cohort fluency",
      description:
        "Consumer-brand cheques depend on the founder knowing repeat rate, cohorts and margin. A missing repeat number lowers the score.",
      citations: ["Memo 2 Petalry (passed)", "Memo 7 Giva (invested)", "Meeting 1"],
      status: "observed",
    },
    {
      id: "RP-3",
      title: "Deeptech needs a regulator-facing milestone plan and a customer",
      description:
        "Long regulatory paths are acceptable when the founders have a concrete milestone sequence. Aditya runs deeptech second calls.",
      citations: ["Memo 1 ePlane (invested)", "Memo 8 AeroDrop (passed)", "Meeting 3"],
      status: "observed",
    },
    {
      id: "RP-4",
      title: "Avoid models that need more capital than a pre-seed cheque",
      description: "Density- or capex-driven models that only work with large raises are passed on structure, not people.",
      citations: ["Memo 4 HopBox (passed)", "Meeting 1"],
      status: "observed",
    },
    {
      id: "RP-5",
      title: "Founders who go to the customer first",
      description: "Field groundwork, manual early operations and direct customer contact are read as strong founder signals.",
      citations: ["Memo 5 Wint Wealth", "Memo 9 SuperK", "Memo 11 Jai Kisan", "Memo 3 Unbox Robotics"],
      status: "observed",
    },
    {
      id: "RP-6",
      title: "No categories that depend on favourable regulatory change",
      description: "A business whose existence depends on rules becoming friendlier is outside what the fund backs.",
      citations: ["Memo 10 Coinlane (passed)"],
      status: "observed",
    },
    {
      id: "RP-7",
      title: "Defensibility beyond the founder",
      description: "Products that are the founder (content-led, copyable) are passed when data does not show them travelling.",
      citations: ["Memo 12 Prepnest (passed)"],
      status: "observed",
    },
    {
      id: "RP-8",
      title: "Default no on portfolio competitors",
      description: "The fund sometimes backs competitors, but only if both founders know. The default is no.",
      citations: ["Meeting 4"],
      status: "observed",
    },
    {
      id: "RP-9",
      title: "Drift toward commerce infrastructure and consumer plays with repeat",
      description:
        "Riya's observation that recent yeses differ from the fund-pitch wording. Aditya disagreed. Unresolved. Shown for transparency, never scored.",
      citations: ["Meeting 5"],
      status: "contested",
    },
  ],
  changeNote: "Initial reconstruction from case materials. Proposed, not approved.",
};

export const CRITERIA_V1: CriteriaVersion = {
  id: "criteria-v1",
  version: 1,
  status: "proposed",
  createdBy: "system",
  createdAt: "2026-11-18T00:00:00.000Z",
  changeNote: "Initial proposed rubric. Equal weights pending partner calibration (D-09).",
  criteria: [
    {
      id: "founder_quality",
      name: "Founder quality",
      definition:
        "Evidence of execution, candour, ownership of risk and commitment. Credentials (school, employer brand) are recorded but never scored.",
      weight: 1,
      missingMetricPolicy: [],
    },
    {
      id: "founder_market_fit",
      name: "Founder-market fit",
      definition: "Depth of the founders' first-hand experience in the specific problem, customer or industry.",
      weight: 1,
      missingMetricPolicy: [],
    },
    {
      id: "market",
      name: "Market opportunity",
      definition: "Size and credibility of the opportunity. Bottom-up sizing with stated assumptions beats a top-down '1% of' claim.",
      weight: 1,
      missingMetricPolicy: [],
    },
    {
      id: "traction",
      name: "Traction and validation",
      definition: "Paying customers, revenue, growth and, above all, repeat or retention behaviour. Conflicting figures reduce credibility.",
      weight: 1,
      missingMetricPolicy: [
        {
          sector: "consumer_brand",
          metric: "repeat",
          penalty: 1,
          citation: "Meeting 1: 'a missing number should drag the score, not be skipped' (Petalry, repeat rate).",
        },
      ],
    },
    {
      id: "business_model",
      name: "Business model and economics",
      definition: "Gross margin, CAC, payback, contribution and how revenue is defined (gross vs net).",
      weight: 1,
      missingMetricPolicy: [],
    },
    {
      id: "product_tech",
      name: "Product and technology",
      definition: "What is built and live, what is proprietary, and what is still manual.",
      weight: 1,
      missingMetricPolicy: [],
    },
    {
      id: "path_to_market",
      name: "Path to market",
      definition:
        "Distribution channels, acquisition cost by channel, and the regulatory or certification path. Scored separately from founder quality (Meeting 3).",
      weight: 1,
      missingMetricPolicy: [],
    },
    {
      id: "capital_fit",
      name: "Capital and fund fit",
      definition: "Stage, round size and capital intensity relative to a pre-seed cheque.",
      weight: 1,
      missingMetricPolicy: [],
    },
    {
      id: "thesis_fit",
      name: "Strategic thesis fit",
      definition: "Fit with the stated thesis and with the revealed patterns in past decisions. Disagreements between the two are shown, not merged.",
      weight: 1,
      missingMetricPolicy: [],
    },
  ],
};
