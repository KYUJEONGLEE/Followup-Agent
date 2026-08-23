export interface AgentNodeTrace {
  sequence: number;
  type: 'node';
  name: string;
}

export interface AgentToolTrace {
  sequence: number;
  type: 'tool';
  name: string;
  arguments: Record<string, unknown>;
}

export interface AgentApprovalTrace {
  sequence: number;
  type: 'approval';
  decision: 'requested' | 'approved' | 'rejected';
  mode: 'required' | 'auto';
  toolName: string;
}

export type AgentTraceEntry =
  | AgentNodeTrace
  | AgentToolTrace
  | AgentApprovalTrace;

export interface PendingApproval {
  toolName: string;
  arguments: Record<string, unknown>;
}

interface AgentRunResponseBase {
  executionId: string;
  writeApprovalMode: 'required' | 'auto';
  trace: AgentTraceEntry[];
}

export interface CompletedAgentRunResponse extends AgentRunResponseBase {
  status: 'completed';
  answer: string;
  approval: null;
}

export interface AwaitingApprovalAgentRunResponse extends AgentRunResponseBase {
  status: 'awaiting_approval';
  answer: null;
  approval: PendingApproval;
}

export interface RejectedAgentRunResponse extends AgentRunResponseBase {
  status: 'rejected';
  answer: string;
  approval: null;
}

export type AgentRunResponse =
  | CompletedAgentRunResponse
  | AwaitingApprovalAgentRunResponse
  | RejectedAgentRunResponse;
