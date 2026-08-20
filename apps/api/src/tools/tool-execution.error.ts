export const TOOL_ERROR_CODES = {
  notSupported: 'TOOL_NOT_SUPPORTED',
  invalidArguments: 'TOOL_ARGUMENTS_INVALID',
  executionFailed: 'TOOL_EXECUTION_FAILED',
} as const;

export type ToolErrorCode =
  (typeof TOOL_ERROR_CODES)[keyof typeof TOOL_ERROR_CODES];

export interface ToolArgumentIssue {
  path: string;
  message: string;
}

export class ToolExecutionError extends Error {
  constructor(
    public readonly code: ToolErrorCode,
    message: string,
    public readonly issues: ToolArgumentIssue[] = [],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = ToolExecutionError.name;
  }
}
