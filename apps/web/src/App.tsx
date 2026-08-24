import { useState, type FormEvent } from 'react';
import {
  resumeAgent,
  runAgent,
  type ApprovalDecision,
  type AgentRunResponse,
  type WriteApprovalMode,
} from './api/agent';
import { TraceTimeline } from './components/TraceTimeline';

const quickPrompts = [
  {
    label: '고객과 상담 조회',
    message: '김민수 고객의 기본 정보와 최근 상담 내용을 같이 알려줘.',
  },
  {
    label: '후속 업무 생성',
    message:
      '김민수 고객의 상담 내용을 확인하고 다음 상담 전 생활 습관을 확인하는 후속 업무를 생성해줘.',
  },
  {
    label: 'Tool 없이 답변',
    message: '안녕하세요.',
  },
] as const;

type PendingAction = 'run' | ApprovalDecision | null;

const statusCopy = {
  completed: { label: '실행 완료', tone: 'success' },
  awaiting_approval: { label: '승인 대기', tone: 'warning' },
  rejected: { label: '실행 거절', tone: 'neutral' },
} as const;

export function App() {
  const [message, setMessage] = useState('');
  const [approvalMode, setApprovalMode] =
    useState<WriteApprovalMode>('required');
  const [response, setResponse] = useState<AgentRunResponse | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedMessage = message.trim();

    if (!trimmedMessage || pendingAction) {
      return;
    }

    setPendingAction('run');
    setError(null);
    setResponse(null);

    try {
      setResponse(await runAgent(trimmedMessage, approvalMode));
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : '알 수 없는 오류가 발생했습니다.',
      );
    } finally {
      setPendingAction(null);
    }
  };

  const handleDecision = async (decision: ApprovalDecision) => {
    if (response?.status !== 'awaiting_approval' || pendingAction) {
      return;
    }

    setPendingAction(decision);
    setError(null);

    try {
      setResponse(await resumeAgent(response.executionId, decision));
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : '알 수 없는 오류가 발생했습니다.',
      );
    } finally {
      setPendingAction(null);
    }
  };

  const status = response ? statusCopy[response.status] : null;

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="FollowUp Agent 홈">
          <span className="brand-mark" aria-hidden="true">
            F
          </span>
          <span>
            <strong>FollowUp</strong>
            <small>Agent workspace</small>
          </span>
        </a>
        <div className="environment-badge">
          <span aria-hidden="true" />
          Local demo
        </div>
      </header>

      <main id="top">
        <section className="hero" aria-labelledby="page-title">
          <div>
            <p className="eyebrow">Human-in-the-loop Agent</p>
            <h1 id="page-title">
              고객 상담의 다음 행동을
              <br /> 놓치지 않도록.
            </h1>
          </div>
          <p className="hero-description">
            고객과 상담 이력을 조회하고, 필요한 후속 업무는 사용자의 확인을
            받은 뒤 실행합니다. 오른쪽 Trace에서 Agent의 판단 과정을 직접
            확인해 보세요.
          </p>
        </section>

        <section className="workspace" aria-label="Agent 실행 화면">
          <div className="conversation-column">
            <article className="panel request-panel">
              <div className="panel-heading">
                <div>
                  <p className="section-index">01 · Request</p>
                  <h2>무엇을 도와드릴까요?</h2>
                </div>
                <span className="api-label">POST /agent/runs</span>
              </div>

              <div className="quick-prompts" aria-label="예시 요청">
                {quickPrompts.map((prompt) => (
                  <button
                    type="button"
                    key={prompt.label}
                    onClick={() => setMessage(prompt.message)}
                    disabled={pendingAction !== null}
                  >
                    {prompt.label}
                  </button>
                ))}
              </div>

              <form onSubmit={(event) => void handleSubmit(event)}>
                <label className="sr-only" htmlFor="agent-message">
                  Agent에게 요청할 내용
                </label>
                <textarea
                  id="agent-message"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="예: 김민수 고객의 기본 정보와 최근 상담 내용을 알려줘."
                  maxLength={2000}
                  rows={5}
                  disabled={pendingAction !== null}
                />
                <div className="request-controls">
                  <label className="approval-mode">
                    <span>Write 실행 정책</span>
                    <select
                      value={approvalMode}
                      onChange={(event) =>
                        setApprovalMode(event.target.value as WriteApprovalMode)
                      }
                      disabled={pendingAction !== null}
                    >
                      <option value="required">항상 승인받기</option>
                      <option value="auto">서버 허용 시 자동 실행</option>
                    </select>
                  </label>
                  <div className="submit-group">
                    <span>{message.length} / 2000</span>
                    <button
                      className="primary-button"
                      type="submit"
                      disabled={!message.trim() || pendingAction !== null}
                    >
                      {pendingAction === 'run' ? '실행 중…' : 'Agent 실행'}
                      <span aria-hidden="true">→</span>
                    </button>
                  </div>
                </div>
              </form>
            </article>

            <div className="result-region" aria-live="polite">
              {error && (
                <div className="error-banner" role="alert">
                  <strong>요청을 완료하지 못했습니다.</strong>
                  <p>{error}</p>
                </div>
              )}

              {response?.status === 'awaiting_approval' && (
                <article className="panel approval-card">
                  <div className="approval-icon" aria-hidden="true">
                    !
                  </div>
                  <div className="approval-main">
                    <p className="section-index">02 · Approval required</p>
                    <h2>데이터 변경 전 확인이 필요합니다.</h2>
                    <p>
                      Agent가 <strong>{response.approval.toolName}</strong> 실행을
                      요청했습니다. 아래 입력값을 확인해 주세요.
                    </p>
                    <pre>
                      {JSON.stringify(response.approval.arguments, null, 2)}
                    </pre>
                    <div className="approval-actions">
                      <button
                        className="primary-button"
                        type="button"
                        onClick={() => void handleDecision('approve')}
                        disabled={pendingAction !== null}
                      >
                        {pendingAction === 'approve'
                          ? '승인 처리 중…'
                          : '승인하고 실행'}
                      </button>
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => void handleDecision('reject')}
                        disabled={pendingAction !== null}
                      >
                        {pendingAction === 'reject' ? '거절 처리 중…' : '거절'}
                      </button>
                    </div>
                  </div>
                </article>
              )}

              {response && response.status !== 'awaiting_approval' && (
                <article className="panel answer-card">
                  <div className="answer-heading">
                    <div>
                      <p className="section-index">02 · Agent response</p>
                      <h2>처리 결과</h2>
                    </div>
                    {status && (
                      <span className={`status-badge status-${status.tone}`}>
                        {status.label}
                      </span>
                    )}
                  </div>
                  <p className="answer-copy">{response.answer}</p>
                  <div className="execution-meta">
                    <span>Execution ID</span>
                    <code>{response.executionId}</code>
                  </div>
                </article>
              )}
            </div>
          </div>

          <aside className="panel trace-panel" aria-labelledby="trace-title">
            <div className="panel-heading trace-heading">
              <div>
                <p className="section-index">Live inspection</p>
                <h2 id="trace-title">Execution Trace</h2>
              </div>
              <span className="trace-count">{response?.trace.length ?? 0}</span>
            </div>
            <TraceTimeline trace={response?.trace ?? []} />
          </aside>
        </section>
      </main>

      <footer>
        <span>FollowUp Agent · Backend workflow demo</span>
        <span>NestJS · LangGraph · PostgreSQL</span>
      </footer>
    </div>
  );
}
