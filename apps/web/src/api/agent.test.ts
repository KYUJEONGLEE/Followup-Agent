import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAgent } from './agent';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Agent API client', () => {
  it('API가 90초 동안 응답하지 않으면 요청을 중단하고 안내한다', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn((_: string, init?: RequestInit) => {
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('요청 제한 시간 초과', 'TimeoutError'));
          });
        });
      }),
    );

    const request = runAgent('안녕하세요.', 'required');
    const rejection = expect(request).rejects.toThrow(
      'API 서버가 응답하지 않습니다. 무료 데모가 기동 중일 수 있으니 잠시 후 다시 시도해 주세요.',
    );

    await vi.advanceTimersByTimeAsync(90_000);
    await rejection;
  });

  it.each([200, 503])(
    'HTTP %i 헤더가 도착해도 본문이 멈추면 90초 후 중단한다',
    async (status) => {
      vi.useFakeTimers();
      let requestSignal: AbortSignal | undefined;
      vi.stubGlobal(
        'fetch',
        vi.fn((_: string, init?: RequestInit) => {
          requestSignal = init?.signal ?? undefined;
          return Promise.resolve({
            ok: status === 200,
            status,
            json: () =>
              new Promise((_, reject) => {
                requestSignal?.addEventListener('abort', () => {
                  reject(new DOMException('본문 읽기 중단', 'AbortError'));
                });
              }),
          } as Response);
        }),
      );

      const result = runAgent('안녕하세요.', 'required').catch(
        (error: unknown) => error,
      );

      await vi.advanceTimersByTimeAsync(90_000);

      expect(requestSignal?.aborted).toBe(true);
      expect(await result).toHaveProperty(
        'message',
        'API 서버가 응답하지 않습니다. 무료 데모가 기동 중일 수 있으니 잠시 후 다시 시도해 주세요.',
      );
    },
  );

  it('정상 JSON을 읽은 뒤 timeout 타이머를 정리한다', async () => {
    vi.useFakeTimers();
    const body = { status: 'completed', answer: '안녕하세요!' };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(body),
      }),
    );

    await expect(runAgent('안녕하세요.', 'required')).resolves.toEqual(body);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('오류 JSON의 검증 메시지를 유지하고 타이머를 정리한다', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({
          message: ['잘못된 요청입니다.', '값을 확인하세요.'],
        }),
      }),
    );

    await expect(runAgent('안녕하세요.', 'required')).rejects.toThrow(
      '잘못된 요청입니다. 값을 확인하세요.',
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('오류 본문이 JSON이 아니면 HTTP 상태 메시지를 유지한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
      }),
    );

    await expect(runAgent('안녕하세요.', 'required')).rejects.toThrow(
      '요청 처리에 실패했습니다. (502)',
    );
  });
});
