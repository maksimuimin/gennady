// @file: ReviewRuntimeReceipt — trusted source provenance record.
// @consumers: coverage/review-structural-validator
// @tasks: TSK-176

/** @purpose Trusted provenance record for one source version used in a review run. */
export type ReviewRuntimeReceipt = {
  readonly receiptId: string;
  readonly contractId: string;
  readonly contractVersion: string;
  readonly manifestKeyDigest: string;
  readonly sourceId: string;
  readonly sourceVersion: string;
  readonly sourceDigest: string;
};
