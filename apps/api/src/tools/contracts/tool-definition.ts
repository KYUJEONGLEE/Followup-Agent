export interface ToolJsonSchema {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, Record<string, unknown>>>;
  readonly required: readonly string[];
  readonly additionalProperties: false;
}

export interface AgentToolDefinition {
  readonly type: 'function';
  readonly name: string;
  readonly description: string;
  readonly parameters: ToolJsonSchema;
  readonly strict: true;
}
