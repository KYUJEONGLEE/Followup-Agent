import type { AgentTraceEntry } from '../api/agent';

interface TraceTimelineProps {
  trace: AgentTraceEntry[];
}

const approvalLabels = {
  requested: '승인 요청',
  approved: '승인 완료',
  rejected: '승인 거절',
} as const;

export function TraceTimeline({ trace }: TraceTimelineProps) {
  if (trace.length === 0) {
    return (
      <div className="trace-empty">
        <span className="trace-empty-mark">→</span>
        <p>요청을 보내면 Agent가 거친 Node와 Tool이 여기에 표시됩니다.</p>
      </div>
    );
  }

  return (
    <ol className="trace-list" aria-label="Agent 실행 Trace">
      {trace.map((entry) => (
        <li className={`trace-item trace-${entry.type}`} key={entry.sequence}>
          <div className="trace-sequence">{entry.sequence}</div>
          <div className="trace-content">
            <span className="trace-type">
              {entry.type === 'node'
                ? 'Node'
                : entry.type === 'tool'
                  ? 'Tool'
                  : 'Approval'}
            </span>
            <strong>
              {entry.type === 'approval'
                ? approvalLabels[entry.decision]
                : entry.name}
            </strong>
            {entry.type === 'tool' && (
              <pre>{JSON.stringify(entry.arguments, null, 2)}</pre>
            )}
            {entry.type === 'approval' && (
              <p>
                {entry.toolName} ·{' '}
                {entry.mode === 'required' ? '항상 확인' : '자동 실행'}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
