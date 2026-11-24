// Committed annotations for the B6 exports. No record IDs, names or quotations: each annotated row is keyed by a
// one-way fingerprint of the private row (rowFingerprint in ./loops), so an entry can be matched only by someone who
// already holds the private export. The raw exports stay in data/private/ (git-ignored). Aggregate reasoning is in
// docs/B6_DATASET_AUDIT.md. Entries are sorted by fingerprint, so their order carries no information either.

/** Loop 2 rows excluded from ordinary evaluation/training (neutral exception codes). Kept in the audit suite. */
export const LOOP2_EXCEPTIONS: Record<string, string> = {
  "6ac9deab916ee7ba": "style-exception: formal greeting, no dated slots, no fund sign-off",
  "a67e78c9af483302": "style-exception: fund boilerplate added to the final (longest email; against the short, one-ask standard)",
  "fb6738a9d59c0bd7": "style-exception: diligence question replaced by an instruction (no question)",
};

/** Loop 1 overturn categories (interpretations assigned by reading the partner's reason; not export labels). */
export const LOOP1_CATEGORIES: Record<string, string> = {
  "0169d5158e051d0f": "thesis-drift",
  "0d30b2ed8534c24f": "credit-risk-ownership",
  "56686c1a45f20412": "deeptech-regulatory-path-undervalued",
  "7abbd8a0cca417cc": "credit-risk-ownership",
  "7bbca2f3086f4ca2": "missing-metric-should-count",
  "836083d63b41183c": "credentials-over-evidence",
  "86c078ef9dd12242": "capital-intensity",
  "86c9a4011143947b": "portfolio-conflict",
  "9a2519f56643e108": "founder-behaviour",
  "a128d9ba55c3b5e4": "outside-thesis-regulatory",
  "c0d58c2dc1887d2a": "thesis-drift",
  "e7cd3d671d642c33": "presentation-bias",
};

/** Loop 1 summaries that contain information gathered after the application (hindsight risk for replay). */
export const LOOP1_POST_APPLICATION_INFO = ["0d30b2ed8534c24f", "9a2519f56643e108"];
