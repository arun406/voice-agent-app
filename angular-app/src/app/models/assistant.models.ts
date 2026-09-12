export type AssistantState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

export interface ToolParam {
  name: string;
  type: 'string' | 'number' | 'boolean';
  description: string;
  required: boolean;
}

/** One capability the assistant can invoke — either your backend or a local handler. */
export interface ToolDefinition {
  name: string;
  description: string;
  params: ToolParam[];
  /** HTTP method + URL template for tool-executor.service.ts. `{param}` is substituted from args. */
  method?: 'GET' | 'POST';
  urlTemplate?: string;
  /**
   * For tools answered entirely on-device (no backend call) — e.g. the current
   * date/time, which the LLM's own frozen training data can never know correctly.
   * Takes precedence over method/urlTemplate when both are present.
   */
  localHandler?: (args: Record<string, string | number | boolean>) => unknown;
  /** True for tools discovered from the MCP server at runtime — routes through McpService instead of method/urlTemplate. */
  mcp?: boolean;
}

export interface ToolCall {
  tool: string;
  args: Record<string, string | number | boolean>;
}

export interface AssistantTurn {
  transcript: string;
  toolCall?: ToolCall;
  toolResult?: unknown;
  answer?: string;
  error?: string;
}
