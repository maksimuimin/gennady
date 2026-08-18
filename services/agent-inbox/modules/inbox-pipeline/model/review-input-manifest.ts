// @file: ReviewInputManifest model — sealed inputs for a review run.
// @consumers: coverage/review-structural-validator
// @tasks: TSK-176

/** @purpose Resolved and sealed manifest of inputs for one review run. */
export type ReviewInputManifestResult = {
  readonly manifestId: string;
  readonly manifestRef: string;
};
