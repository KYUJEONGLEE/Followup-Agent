import { z } from 'zod';

const postgresqlUrl = z.string().refine(
  (value) => {
    try {
      const url = new URL(value);

      return (
        ['postgres:', 'postgresql:'].includes(url.protocol) &&
        url.hostname.length > 0 &&
        url.pathname.length > 1
      );
    } catch {
      return false;
    }
  },
  {
    message: 'postgresql:// 형식의 데이터베이스 URL이어야 합니다.',
  },
);

const httpUrl = z.string().refine(
  (value) => {
    try {
      const url = new URL(value);

      return ['http:', 'https:'].includes(url.protocol);
    } catch {
      return false;
    }
  },
  {
    message: 'http:// 또는 https:// 형식의 URL이어야 합니다.',
  },
);

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: postgresqlUrl,
  CORS_ORIGIN: httpUrl.optional(),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1).default('gpt-5.6'),
});

export type EnvironmentVariables = z.infer<typeof environmentSchema>;

export function validateEnvironment(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const result = environmentSchema.safeParse(config);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => {
        const path = issue.path.join('.');
        const messages: Record<string, string> = {
          NODE_ENV: 'development, test, production 중 하나여야 합니다.',
          PORT: '1 이상 65535 이하의 정수여야 합니다.',
          DATABASE_URL:
            config.DATABASE_URL === undefined
              ? '필수 환경변수입니다.'
              : issue.message,
          CORS_ORIGIN: issue.message,
          OPENAI_API_KEY:
            config.OPENAI_API_KEY === undefined
              ? '필수 환경변수입니다.'
              : '빈 문자열일 수 없습니다.',
          OPENAI_MODEL: '빈 문자열일 수 없습니다.',
        };

        return `- ${path}: ${messages[path] ?? issue.message}`;
      })
      .join('\n');

    throw new Error(`환경변수 검증 실패:\n${details}`);
  }

  return result.data;
}
