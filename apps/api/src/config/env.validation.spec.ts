import { describe, expect, it } from '@jest/globals';
import { validateEnvironment } from './env.validation';

const databaseUrl =
  'postgresql://postgres:postgres@localhost:5432/followup_agent';
const openAiApiKey = 'test-api-key';

describe('validateEnvironment', () => {
  it('기본 환경변수 값을 적용한다', () => {
    expect(
      validateEnvironment({
        DATABASE_URL: databaseUrl,
        OPENAI_API_KEY: openAiApiKey,
      }),
    ).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      DATABASE_URL: databaseUrl,
      OPENAI_API_KEY: openAiApiKey,
      OPENAI_MODEL: 'gpt-5.6',
      AGENT_ALLOW_AUTO_WRITE: false,
    });
  });

  it('문자열 PORT와 명시한 환경변수를 변환한다', () => {
    expect(
      validateEnvironment({
        NODE_ENV: 'test',
        PORT: '3100',
        DATABASE_URL: databaseUrl,
        CORS_ORIGIN: 'http://localhost:5173',
        OPENAI_API_KEY: openAiApiKey,
        OPENAI_MODEL: 'gpt-test',
        AGENT_ALLOW_AUTO_WRITE: 'true',
      }),
    ).toEqual({
      NODE_ENV: 'test',
      PORT: 3100,
      DATABASE_URL: databaseUrl,
      CORS_ORIGIN: 'http://localhost:5173',
      OPENAI_API_KEY: openAiApiKey,
      OPENAI_MODEL: 'gpt-test',
      AGENT_ALLOW_AUTO_WRITE: true,
    });
  });

  it('AGENT_ALLOW_AUTO_WRITE는 true 또는 false만 허용한다', () => {
    expect(() =>
      validateEnvironment({
        DATABASE_URL: databaseUrl,
        OPENAI_API_KEY: openAiApiKey,
        AGENT_ALLOW_AUTO_WRITE: 'yes',
      }),
    ).toThrow('AGENT_ALLOW_AUTO_WRITE');
  });

  it('DATABASE_URL이 없으면 실패한다', () => {
    expect(() => validateEnvironment({ OPENAI_API_KEY: openAiApiKey })).toThrow(
      'DATABASE_URL: 필수 환경변수입니다.',
    );
  });

  it('PORT 범위를 벗어나면 실패한다', () => {
    expect(() =>
      validateEnvironment({
        PORT: '70000',
        DATABASE_URL: databaseUrl,
        OPENAI_API_KEY: openAiApiKey,
      }),
    ).toThrow('PORT: 1 이상 65535 이하의 정수여야 합니다.');
  });

  it('PostgreSQL이 아닌 DATABASE_URL이면 실패한다', () => {
    expect(() =>
      validateEnvironment({
        DATABASE_URL: 'mysql://user:password@localhost:3306/followup_agent',
        OPENAI_API_KEY: openAiApiKey,
      }),
    ).toThrow('postgresql:// 형식의 데이터베이스 URL이어야 합니다.');
  });

  it('HTTP가 아닌 CORS_ORIGIN이면 실패한다', () => {
    expect(() =>
      validateEnvironment({
        DATABASE_URL: databaseUrl,
        CORS_ORIGIN: 'ftp://localhost:5173',
        OPENAI_API_KEY: openAiApiKey,
      }),
    ).toThrow('http:// 또는 https:// 형식의 URL이어야 합니다.');
  });

  it('오류 메시지에 입력한 비밀번호를 노출하지 않는다', () => {
    const password = 'should-not-leak';

    expect(() =>
      validateEnvironment({
        DATABASE_URL: `mysql://user:${password}@localhost:3306/followup_agent`,
        OPENAI_API_KEY: openAiApiKey,
      }),
    ).toThrow('postgresql:// 형식의 데이터베이스 URL이어야 합니다.');

    try {
      validateEnvironment({
        DATABASE_URL: `mysql://user:${password}@localhost:3306/followup_agent`,
        OPENAI_API_KEY: openAiApiKey,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain(password);
    }
  });

  it('OPENAI_API_KEY가 없으면 실패한다', () => {
    expect(() =>
      validateEnvironment({
        DATABASE_URL: databaseUrl,
      }),
    ).toThrow('OPENAI_API_KEY: 필수 환경변수입니다.');
  });
});
