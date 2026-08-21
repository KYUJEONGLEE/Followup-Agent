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

export type AgentTraceEntry = AgentNodeTrace | AgentToolTrace;

export interface AgentRunResponse {
  executionId: string;
  answer: string;
  trace: AgentTraceEntry[];
}
