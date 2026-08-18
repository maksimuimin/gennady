// @file: ReviewCompletenessVerdict — structural validation outcome.
// @consumers: coverage/review-structural-validator, coverage/review-repair-coordinator
// @tasks: TSK-176

import type { ReviewCoverage } from './review-coverage.type.ts';

/** @purpose Shared base fields present in every completeness verdict. */
type ReviewCompletenessVerdictBase = {
  readonly verdictId: string;
  readonly contractId: string;
  readonly contractVersion: string;
  readonly manifestRef: string;
  readonly coverage: ReviewCoverage;
  readonly validatorVersion: string;
  readonly evaluatedAt: string;
};

/** @purpose All required slots were satisfied. */
export type ReviewCompletenessVerdictPass = ReviewCompletenessVerdictBase & {
  readonly status: 'PASS';
  readonly fresh: boolean;
};

/** @purpose Some slots are missing or invalid but the repair budget is not exhausted. */
export type ReviewCompletenessVerdictRepairable = ReviewCompletenessVerdictBase & {
  readonly status: 'REPAIRABLE';
  readonly missingSlotIds: readonly string[];
  readonly invalidSlotIds: readonly string[];
  readonly reasons: Record<string, string>;
  readonly attempt: number;
  readonly maxAttempts: number;
};

/** @purpose Repair budget exhausted; manual intervention required. */
export type ReviewCompletenessVerdictBlocked = ReviewCompletenessVerdictBase & {
  readonly status: 'BLOCKED';
  readonly remainingSlotIds: readonly string[];
  readonly reasons: readonly string[];
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly provenance: readonly string[];
};

/** @purpose Union of all possible structural completeness outcomes. */
export type ReviewCompletenessVerdict =
  | ReviewCompletenessVerdictPass
  | ReviewCompletenessVerdictRepairable
  | ReviewCompletenessVerdictBlocked;
