export const AGENT_ERROR_CODES = {
  invalidRequest: 'AGENT_REQUEST_INVALID',
  executionFailed: 'AGENT_EXECUTION_FAILED',
  llmFailed: 'AGENT_LLM_FAILED',
  timeout: 'AGENT_TIMEOUT',
} as const;

export type AgentErrorCode =
  (typeof AGENT_ERROR_CODES)[keyof typeof AGENT_ERROR_CODES];

export interface AgentErrorDetail {
  field?: string;
  reason: string;
}

export interface AgentErrorResponse {
  statusCode: number;
  code: AgentErrorCode;
  message: string;
  executionId?: string;
  details?: AgentErrorDetail[];
  timestamp: string;
}
