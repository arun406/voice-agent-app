import { Injectable } from '@angular/core';
import { MCP_SERVER_URL } from '../config/mcp.config';
import { ToolDefinition, ToolParam } from '../models/assistant.models';
import { AuthService } from './auth.service';

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: { properties?: Record<string, { type?: string; description?: string }>; required?: string[] };
}

/**
 * Generic client for an MCP server over the "Streamable HTTP" transport (a single
 * POST endpoint carrying JSON-RPC 2.0 messages) — the transport an MCP server built
 * with @modelcontextprotocol/sdk (which the Claude Agent SDK uses) exposes by
 * default. Handles the initialize handshake, tool discovery, and tool calls; every
 * request carries the signed-in field user's Zitadel access token so the backend can
 * scope results (e.g. "today's assignments") to them.
 */
@Injectable({ providedIn: 'root' })
export class McpService {
  private sessionId: string | null = null;
  private protocolVersion: string | null = null;
  private initialized: Promise<void> | null = null;
  private nextId = 1;

  constructor(private auth: AuthService) {}

  /** Fetches the server's current tool list and converts each to a ToolDefinition for the LLM router. */
  async listTools(): Promise<ToolDefinition[]> {
    await this.ensureInitialized();
    const result = await this.rpc('tools/list', {});
    const tools: McpTool[] = result?.tools ?? [];
    return tools.map(toToolDefinition);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.ensureInitialized();
    const result = await this.rpc('tools/call', { name, arguments: args });
    if (result?.isError) {
      const message = (result.content ?? []).map((c: any) => c.text).filter(Boolean).join(' ');
      throw new Error(message || `MCP tool "${name}" returned an error.`);
    }
    return extractContent(result?.content);
  }

  private ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      this.initialized = this.doInitialize().catch((err) => {
        this.initialized = null; // allow retry on next call instead of failing forever
        throw err;
      });
    }
    return this.initialized;
  }

  private async doInitialize(): Promise<void> {
    const result = await this.rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'voice-agent-app', version: '1.0.0' }
    });
    // The server may negotiate down to a version it actually supports — echo that
    // back (not the one we asked for) on every request from here on, per spec.
    this.protocolVersion = result?.protocolVersion ?? '2025-06-18';
    await this.notify('notifications/initialized', {});
  }

  private async rpc(method: string, params: unknown): Promise<any> {
    const id = this.nextId++;
    const response = await this.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }), true);
    if (response?.error) {
      throw new Error(`MCP error (${method}): ${response.error.message ?? JSON.stringify(response.error)}`);
    }
    return response?.result;
  }

  private async notify(method: string, params: unknown): Promise<void> {
    await this.send(JSON.stringify({ jsonrpc: '2.0', method, params }), false);
  }

  private async send(body: string, expectResponse: boolean): Promise<any> {
    const token = await this.auth.getAccessToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`
    };
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
    if (this.protocolVersion) headers['MCP-Protocol-Version'] = this.protocolVersion;

    const res = await fetch(MCP_SERVER_URL, { method: 'POST', headers, body });

    const returnedSession = res.headers.get('Mcp-Session-Id');
    if (returnedSession) this.sessionId = returnedSession;

    if (!res.ok) {
      throw new Error(`MCP request failed: ${res.status} ${await res.text().catch(() => '')}`);
    }
    if (!expectResponse || res.status === 202) {
      return null;
    }

    const contentType = res.headers.get('Content-Type') ?? '';
    if (contentType.includes('application/json')) {
      return res.json();
    }
    if (contentType.includes('text/event-stream')) {
      return this.readFirstSseMessage(res);
    }
    throw new Error(`Unexpected MCP response content-type: ${contentType}`);
  }

  /** Streamable HTTP allows an SSE response for a single call; we only need the first message it carries. */
  private async readFirstSseMessage(res: Response): Promise<any> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const event of events) {
          const dataLine = event.split('\n').find((l) => l.startsWith('data:'));
          if (dataLine) {
            return JSON.parse(dataLine.slice(5).trim());
          }
        }
      }
    } finally {
      reader.cancel().catch(() => {});
    }
    throw new Error('MCP SSE stream ended without a response.');
  }
}

function toToolDefinition(tool: McpTool): ToolDefinition {
  const properties = tool.inputSchema?.properties ?? {};
  const required = tool.inputSchema?.required ?? [];
  const params: ToolParam[] = Object.entries(properties).map(([name, prop]) => ({
    name,
    type: jsonSchemaTypeToParamType(prop?.type),
    description: prop?.description ?? '',
    required: required.includes(name)
  }));
  return {
    name: tool.name,
    description: tool.description ?? '',
    params,
    mcp: true
  };
}

function jsonSchemaTypeToParamType(type: string | undefined): 'string' | 'number' | 'boolean' {
  if (type === 'number' || type === 'integer') return 'number';
  if (type === 'boolean') return 'boolean';
  return 'string';
}

/** MCP tool results are a list of content blocks; a single JSON-ish text block is the common case for a data tool. */
function extractContent(content: any[] | undefined): unknown {
  if (!content || content.length === 0) return {};
  const texts = content.filter((c) => c?.type === 'text').map((c) => c.text as string);
  if (texts.length === 1) {
    try {
      return JSON.parse(texts[0]);
    } catch {
      return texts[0];
    }
  }
  return texts.length ? texts : content;
}
