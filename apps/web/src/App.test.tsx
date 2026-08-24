import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { AgentRunResponse } from './api/agent';

const executionId = '8a697cff-b2bd-42ab-a3d7-13a4cd91f83d';

function mockJsonResponse(body: AgentRunResponse, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('Agent 답변과 Tool Trace를 표시한다', async () => {
    const user = userEvent.setup();
    const fetchMock = mockJsonResponse({
      executionId,
      status: 'completed',
      answer: '김민수 고객은 active 상태이며 최근 상담은 2건입니다.',
      approval: null,
      writeApprovalMode: 'required',
      trace: [
        { sequence: 1, type: 'node', name: 'llm' },
        {
          sequence: 2,
          type: 'tool',
          name: 'get_customer',
          arguments: { name: '김민수' },
        },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await user.click(screen.getByRole('button', { name: '고객과 상담 조회' }));
    await user.click(screen.getByRole('button', { name: /Agent 실행/ }));

    expect(
      await screen.findByText(
        '김민수 고객은 active 상태이며 최근 상담은 2건입니다.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('get_customer')).toBeInTheDocument();
    expect(screen.getByText(/"name": "김민수"/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/agent/runs',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: '김민수 고객의 기본 정보와 최근 상담 내용을 같이 알려줘.',
          writeApprovalMode: 'required',
        }),
      },
    );
  });

  it('승인 대기 요청을 승인해 Workflow를 재개한다', async () => {
    const user = userEvent.setup();
    const awaitingApproval: AgentRunResponse = {
      executionId,
      status: 'awaiting_approval',
      answer: null,
      writeApprovalMode: 'required',
      approval: {
        toolName: 'create_follow_up_task',
        arguments: {
          customer_id: 'C001',
          title: '생활 습관 확인',
        },
      },
      trace: [
        { sequence: 1, type: 'node', name: 'llm' },
        {
          sequence: 2,
          type: 'approval',
          decision: 'requested',
          mode: 'required',
          toolName: 'create_follow_up_task',
        },
      ],
    };
    const completed: AgentRunResponse = {
      executionId,
      status: 'completed',
      answer: '후속 업무를 생성했습니다.',
      approval: null,
      writeApprovalMode: 'required',
      trace: [
        ...awaitingApproval.trace,
        {
          sequence: 3,
          type: 'approval',
          decision: 'approved',
          mode: 'required',
          toolName: 'create_follow_up_task',
        },
      ],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(awaitingApproval),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(completed),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await user.type(
      screen.getByLabelText('Agent에게 요청할 내용'),
      '김민수 고객 후속 업무를 생성해줘.',
    );
    await user.click(screen.getByRole('button', { name: /Agent 실행/ }));

    expect(
      await screen.findByRole('heading', {
        name: '데이터 변경 전 확인이 필요합니다.',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/"customer_id": "C001"/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '승인하고 실행' }));

    expect(
      await screen.findByText('후속 업무를 생성했습니다.'),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/agent/runs/${executionId}/approval`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'approve' }),
      },
    );
  });

  it('API 오류 메시지를 사용자에게 보여준다', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: vi.fn().mockResolvedValue({ message: 'Agent API 연결 실패' }),
      }),
    );

    render(<App />);
    await user.type(
      screen.getByLabelText('Agent에게 요청할 내용'),
      '안녕하세요.',
    );
    await user.click(screen.getByRole('button', { name: /Agent 실행/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Agent API 연결 실패',
    );
  });
});
