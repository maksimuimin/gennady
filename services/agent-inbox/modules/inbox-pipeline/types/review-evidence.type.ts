// @file: ReviewEvidence — a claim that a source satisfies a slot with a trusted receipt.
// @consumers: coverage/review-structural-validator
// @tasks: TSK-176

/** @purpose A claim linking a source to a slot, backed by trusted receipt ids. */
export type ReviewEvidence = {
  readonly evidenceId: string;
  readonly slotId: string;
  readonly fragmentId: string;
  readonly sourceId: string;
  readonly sourceVersion: string;
  readonly sourceDigest: string;
  readonly receiptIds: readonly string[];
  readonly fields: Readonly<Record<string, unknown>>;
};
