// @file: ReviewArtifact model — produced output fragments of a review run.
// @consumers: coverage/review-structural-validator
// @tasks: TSK-176

/** @purpose A single content fragment produced by a review run for one slot. */
export type ReviewArtifactFragment = {
  readonly fragmentId: string;
  readonly slotId: string;
  readonly content: string;
  readonly fields: Readonly<Record<string, unknown>>;
};

/** @purpose Aggregate artifact produced by a single review run. */
export type ReviewArtifact = {
  readonly artifactId: string;
  readonly fragments: readonly ReviewArtifactFragment[];
};
