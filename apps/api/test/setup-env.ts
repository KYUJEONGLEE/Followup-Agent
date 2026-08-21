process.env.NODE_ENV = 'test';
process.env.PORT = '3000';
process.env.DATABASE_URL =
  'postgresql://test:test@localhost:5432/followup_agent_test';
process.env.OPENAI_API_KEY = 'test-api-key';
process.env.OPENAI_MODEL = 'gpt-5.6';
delete process.env.CORS_ORIGIN;
