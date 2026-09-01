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
});
