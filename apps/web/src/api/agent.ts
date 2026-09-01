export type WriteApprovalMode = 'required' | 'auto';
export type ApprovalDecision = 'approve' | 'reject';

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
  mode: WriteApprovalMode;
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
  writeApprovalMode: WriteApprovalMode;
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

interface ApiErrorBody {
  message?: string | string[];
}

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '/api').replace(
  /\/$/,
  '',
);
const apiRequestTimeoutMs = 90_000;
const apiTimeoutMessage =
  'API 서버가 응답하지 않습니다. 무료 데모가 기동 중일 수 있으니 잠시 후 다시 시도해 주세요.';

async function requestAgent(
  path: string,
  body: Record<string, unknown>,
): Promise<AgentRunResponse> {
  const abortController = new AbortController();
  const timeoutId = window.setTimeout(() => {
    abortController.abort(
      new DOMException('요청 제한 시간 초과', 'TimeoutError'),
    );
  }, apiRequestTimeoutMs);
  let response: Response;

  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: abortController.signal,
    });
  } catch (error) {
    if (
      error instanceof DOMException &&
      ['AbortError', 'TimeoutError'].includes(error.name)
    ) {
      throw new Error(apiTimeoutMessage, { cause: error });
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }

  if (!response.ok) {
    let errorMessage = `요청 처리에 실패했습니다. (${response.status})`;

    try {
      const errorBody = (await response.json()) as ApiErrorBody;

      if (Array.isArray(errorBody.message)) {
        errorMessage = errorBody.message.join(' ');
      } else if (errorBody.message) {
        errorMessage = errorBody.message;
      }
    } catch {
      // JSON 오류 본문이 아니면 상태 코드 기반 메시지를 유지한다.
    }

    throw new Error(errorMessage);
  }

  return (await response.json()) as AgentRunResponse;
}

export function runAgent(
  message: string,
  writeApprovalMode: WriteApprovalMode,
): Promise<AgentRunResponse> {
  return requestAgent('/agent/runs', { message, writeApprovalMode });
}

export function resumeAgent(
  executionId: string,
  decision: ApprovalDecision,
): Promise<AgentRunResponse> {
  return requestAgent(`/agent/runs/${executionId}/approval`, { decision });
}
