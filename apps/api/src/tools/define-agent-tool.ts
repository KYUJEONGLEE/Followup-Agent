import { z } from 'zod';
import type { AgentToolDefinition } from './contracts/tool-definition';
import type { ToolEffect } from './contracts/tool-effect';
import type { ToolResult } from './contracts/tool-result';
import {
  TOOL_ERROR_CODES,
  ToolExecutionError,
} from './tool-execution.error';

export interface ToolExecutionContext {
  executionId: string;
  callId: string;
}

export interface ToolInvocation {
  arguments: Record<string, unknown>;
  result: ToolResult<unknown>;
}

export interface ExecutableAgentTool {
  effect: ToolEffect;
  definition: AgentToolDefinition;
  invoke(
    rawArguments: unknown,
    context: ToolExecutionContext,
  ): Promise<ToolInvocation>;
}

export interface AgentToolConfig<
  TInput extends Record<string, unknown>,
  TOutput,
> {
  effect: ToolEffect;
  definition: AgentToolDefinition;
  inputSchema: z.ZodType<TInput>;
  handler(
    input: TInput,
    context: ToolExecutionContext,
  ): Promise<ToolResult<TOutput>>;
}

export function defineAgentTool<
  TInput extends Record<string, unknown>,
  TOutput,
>(config: AgentToolConfig<TInput, TOutput>): ExecutableAgentTool {
  return {
    effect: config.effect,
    definition: config.definition,
    async invoke(
      rawArguments: unknown,
      context: ToolExecutionContext,
    ): Promise<ToolInvocation> {
      const parsed = config.inputSchema.safeParse(rawArguments);

      if (!parsed.success) {
        throw new ToolExecutionError(
          TOOL_ERROR_CODES.invalidArguments,
          `${config.definition.name} Tool arguments가 올바르지 않습니다.`,
          parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        );
      }

      try {
        const result = await config.handler(parsed.data, context);

        return {
          arguments: parsed.data,
          result,
        };
      } catch (error: unknown) {
        if (error instanceof ToolExecutionError) {
          throw error;
        }

        throw new ToolExecutionError(
          TOOL_ERROR_CODES.executionFailed,
          `${config.definition.name} Tool 실행에 실패했습니다.`,
          [],
          { cause: error },
        );
      }
    },
  };
}
