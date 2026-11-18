// Portfolio overlap: compares an application with EVERY company in the portfolio dataset.
// False alarms are preferred to misses, but results are always "possible", never "confirmed".
import type { OverlapCheck, OverlapResult, OverlapRelationship, PortfolioDataset } from "@/lib/shared/types";
import { INCOMPLETE_PORTFOLIO_WARNING } from "@/config/portfolio";
import type { Profile } from "../pipeline";
import { flat } from "../extraction/text";

function termHits(text: string, terms: string[]): string[] {
  const t = ` ${text.toLowerCase()} `;
  return terms.filter((term) => {
    const esc = term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z])${esc}(s|es)?([^a-z]|$)`).test(t);
  });
}

export function checkOverlap(appId: string, profile: Profile, dataset: PortfolioDataset, now: string): OverlapCheck {
  // Use what the company does, not who it pitched to, so the comparison is about the business.
  const text = flat([profile.oneLiner, profile.fields.built, profile.fields.competition, profile.fields.acquisition, profile.bundle.deckText].filter(Boolean).join(" "));
  const results: OverlapResult[] = [];
  for (const pc of dataset.companies) {
    const cat = termHits(text, pc.categoryTerms);
    const cust = termHits(text, pc.customerTerms);
    const chan = termHits(text, pc.channelTerms);
    let rel: OverlapRelationship | null = null;
    let confidence: OverlapResult["confidence"] = "low";
    if (cat.length >= 2 && cust.length >= 1) {
      rel = "direct_competitor";
      confidence = cat.length >= 3 ? "medium" : "low";
    } else if (cat.length >= 2 || (cat.length === 1 && cust.length >= 1)) {
      rel = "adjacent_competitor";
    } else if (cust.length >= 2) {
      rel = "shared_customers";
    } else if (cust.length === 1 && chan.length >= 1) {
      rel = "shared_channels";
    }
    if (rel) {
      const matched = [...cat, ...cust, ...chan];
      results.push({
        portfolioId: pc.id,
        portfolioName: pc.name,
        relationship: rel,
        matchedTerms: matched,
        evidence: `Application text matches ${pc.name}'s ${cat.length ? `category terms (${cat.join(", ")})` : ""}${cust.length ? `${cat.length ? "; " : ""}customer terms (${cust.join(", ")})` : ""}${chan.length ? `; channel terms (${chan.join(", ")})` : ""}. Portfolio record source: ${pc.source}.`,
        confidence,
      });
    }
  }
  const order: OverlapRelationship[] = ["direct_competitor", "adjacent_competitor", "shared_customers", "strategic_conflict", "shared_channels"];
  results.sort((a, b) => order.indexOf(a.relationship) - order.indexOf(b.relationship));
  const status: OverlapCheck["status"] = results.length ? "possible_conflicts" : dataset.verified ? "no_match_verified" : "no_match_incomplete";
  const statusText = results.length
    ? `${results.length} possible overlap(s) found against ${dataset.companies.length} portfolio companies. ${dataset.verified ? "" : INCOMPLETE_PORTFOLIO_WARNING}`
    : dataset.verified
      ? `No overlap found against all ${dataset.companies.length} portfolio companies (verified dataset).`
      : `No overlap found against the ${dataset.companies.length} known portfolio companies. ${INCOMPLETE_PORTFOLIO_WARNING}`;
  return {
    id: `ov_${appId}_${Date.now().toString(36)}`,
    applicationId: appId,
    datasetVersion: dataset.version,
    datasetVerified: dataset.verified,
    comparedCount: dataset.companies.length,
    comparedNames: dataset.companies.map((c) => c.name),
    results,
    status,
    statusText: statusText.trim(),
    reviewerDecision: "pending",
    checkedAt: now,
  };
}
