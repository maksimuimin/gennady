// @file: ReviewRepairTask model — a dispatched targeted repair unit.
// @consumers: coverage/review-repair-coordinator
// @tasks: TSK-176

/** @purpose A single targeted repair task dispatched to close structural gaps. */
export type ReviewRepairTask = {
  readonly repairTaskId: string;
  readonly contractId: string;
  readonly contractVersion: string;
  readonly manifestRef: string;
  readonly slotIds: readonly string[];
  readonly expectedEvidenceTypes: Readonly<Record<string, readonly string[]>>;
  readonly sourceAnchors: Readonly<Record<string, readonly string[]>>;
  readonly attempt: number;
  readonly provenance: readonly string[];
  readonly state: 'PERSISTED';
};
