// @file: ReviewCoverage — slot coverage summary from one validation run.
// @consumers: coverage/review-structural-validator, types/review-completeness-verdict.type
// @tasks: TSK-176

/** @purpose Slot coverage summary produced by one structural validation run. */
export type ReviewCoverage = {
  readonly requiredSlotIds: readonly string[];
  readonly completeSlotIds: readonly string[];
  readonly missingSlotIds: readonly string[];
  readonly invalidSlotIds: readonly string[];
  readonly notApplicableSlotIds: readonly string[];
  readonly sourceCoverage: Readonly<Record<string, readonly string[]>>;
  readonly lensCoverage: Readonly<Record<string, readonly string[]>>;
  readonly entityCoverage: Readonly<Record<string, readonly string[]>>;
  readonly fileCoverage: Readonly<Record<string, readonly string[]>>;
  readonly diagramCoverage: Readonly<Record<string, readonly string[]>>;
  readonly receiptMappings: Readonly<Record<string, readonly string[]>>;
};
