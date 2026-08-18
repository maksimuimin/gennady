// @file: ReviewRuntimeReceiptStorePort — read/write port for trusted receipts and consumptions.
// @consumers: coverage/review-structural-validator
// @tasks: TSK-176

import type { ReviewReceiptConsumption } from '../model/review-receipt-consumption.ts';
import type { ReviewRuntimeReceipt } from '../types/review-runtime-receipt.type.ts';

/** @purpose Context keys that scope all receipt and consumption operations. */
export type ReviewReceiptStoreContext = {
  readonly contractId: string;
  readonly manifestKeyDigest: string;
};

type ReadReceiptsResult =
  | { readonly status: 'READ'; readonly records: readonly ReviewRuntimeReceipt[] }
  | { readonly status: 'EMPTY' };

type ReadConsumptionsResult =
  | { readonly status: 'READ'; readonly records: readonly ReviewReceiptConsumption[] }
  | { readonly status: 'EMPTY' };

/** @purpose Port for reading and appending runtime receipts and their consumptions. */
export type ReviewRuntimeReceiptStorePort = {
  readReceipts(context: ReviewReceiptStoreContext): ReadReceiptsResult;
  readConsumptions(context: ReviewReceiptStoreContext): ReadConsumptionsResult;
  appendConsumption(
    context: ReviewReceiptStoreContext,
    consumption: ReviewReceiptConsumption
  ): void;
};
