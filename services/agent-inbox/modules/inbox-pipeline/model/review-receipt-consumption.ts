// @file: ReviewReceiptConsumption model — durable record of a receipt reuse event.
// @consumers: coverage/review-structural-validator
// @tasks: TSK-176

/** @purpose Durable record that a trusted receipt was consumed for one slot+evidence pair. */
export type ReviewReceiptConsumption = {
  readonly consumptionId: string;
  readonly receiptId: string;
  readonly contractId: string;
  readonly contractVersion: string;
  readonly manifestKeyDigest: string;
  readonly slotId: string;
  readonly evidenceId: string;
  readonly reusePolicy: string;
  readonly sequence: number;
  readonly recordedAt: string;
  readonly digest: string;
};
