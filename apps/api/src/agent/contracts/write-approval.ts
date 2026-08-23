export const WRITE_APPROVAL_MODES = ['required', 'auto'] as const;

export type WriteApprovalMode = (typeof WRITE_APPROVAL_MODES)[number];

export const APPROVAL_DECISIONS = ['approve', 'reject'] as const;

export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];
