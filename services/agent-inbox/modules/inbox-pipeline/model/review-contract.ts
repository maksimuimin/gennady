// @file: ReviewContract model — describes the set of slots a review run must cover.
// @consumers: coverage/review-structural-validator, coverage/review-repair-coordinator
// @tasks: TSK-176

/** @purpose A single slot requirement within a review contract. */
export type ReviewContractSlot = {
  readonly slotId: string;
  readonly obligation: string;
  readonly requiredFields: readonly string[];
  readonly sourceAnchors: readonly string[];
  readonly reusePolicy: string;
  readonly minCardinality: number;
  readonly maxCardinality: number;
};

/** @purpose Immutable description of what a review run must produce. */
export type ReviewContract = {
  readonly contractId: string;
  readonly contractVersion: string;
  readonly manifestRef: string;
  readonly slots: readonly ReviewContractSlot[];
};
