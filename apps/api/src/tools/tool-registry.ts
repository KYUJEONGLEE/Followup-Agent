import type { AgentToolDefinition } from './contracts/tool-definition';
import type { ToolEffect } from './contracts/tool-effect';
import type {
  ExecutableAgentTool,
  ToolExecutionContext,
} from './define-agent-tool';
import {
  TOOL_ERROR_CODES,
  ToolExecutionError,
} from './tool-execution.error';

export interface ToolCallRequest {
  callId: string;
  name: string;
  arguments: unknown;
}

export interface ToolCallResult {
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
  result: Awaited<ReturnType<ExecutableAgentTool['invoke']>>['result'];
}

export class ToolRegistry {
  private readonly toolsByName: Map<string, ExecutableAgentTool>;

  constructor(tools: readonly ExecutableAgentTool[]) {
    this.toolsByName = new Map();

    for (const tool of tools) {
      if (this.toolsByName.has(tool.definition.name)) {
        throw new Error(`중복된 Tool 이름: ${tool.definition.name}`);
      }

      this.toolsByName.set(tool.definition.name, tool);
    }
  }

  listDefinitions(): AgentToolDefinition[] {
    return [...this.toolsByName.values()].map((tool) => tool.definition);
  }

  getEffect(toolName: string): ToolEffect {
    return this.getTool(toolName).effect;
  }

  async execute(
    call: ToolCallRequest,
    executionId: string,
  ): Promise<ToolCallResult> {
    const tool = this.getTool(call.name);

    const rawArguments = this.parseArguments(call.name, call.arguments);
    const context: ToolExecutionContext = {
      executionId,
      callId: call.callId,
    };
    const invocation = await tool.invoke(rawArguments, context);

    return {
      callId: call.callId,
      name: call.name,
      arguments: invocation.arguments,
      result: invocation.result,
    };
  }

  private getTool(toolName: string): ExecutableAgentTool {
    const tool = this.toolsByName.get(toolName);

    if (!tool) {
      throw new ToolExecutionError(
        TOOL_ERROR_CODES.notSupported,
        `지원하지 않는 Tool입니다: ${toolName}`,
      );
    }

    return tool;
  }

  private parseArguments(toolName: string, rawArguments: unknown): unknown {
    if (typeof rawArguments !== 'string') {
      return rawArguments;
    }

    try {
      return JSON.parse(rawArguments) as unknown;
    } catch (error: unknown) {
      throw new ToolExecutionError(
        TOOL_ERROR_CODES.invalidArguments,
        `${toolName} Tool arguments가 JSON 형식이 아닙니다.`,
        [],
        { cause: error },
      );
    }
  }
}
