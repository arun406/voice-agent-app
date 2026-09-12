import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { BACKEND_BASE_URL, TOOLS } from '../config/tools.config';
import { ToolCall, ToolDefinition } from '../models/assistant.models';
import { AuthService } from './auth.service';
import { McpService } from './mcp.service';

/**
 * Executes a planned ToolCall. Local tools (localHandler) run on-device; MCP tools
 * (mcp: true, discovered live from your MCP server — see AssistantOrchestratorService)
 * go through McpService; anything else falls back to the static REST config in
 * tools.config.ts, kept mainly for local/browser-preview testing without a live MCP
 * server.
 */
@Injectable({ providedIn: 'root' })
export class ToolExecutorService {
  constructor(private http: HttpClient, private auth: AuthService, private mcp: McpService) {}

  async execute(call: ToolCall, mcpTools: ToolDefinition[] = []): Promise<unknown> {
    const tool = TOOLS.find((t) => t.name === call.tool) ?? mcpTools.find((t) => t.name === call.tool);
    if (!tool) throw new Error(`Unknown tool: ${call.tool}`);

    if (tool.localHandler) {
      return tool.localHandler(call.args);
    }

    if (tool.mcp) {
      return this.mcp.callTool(tool.name, call.args);
    }

    // BACKEND_BASE_URL is still the placeholder from tools.config.ts — return a
    // canned response so the pipeline is demoable before a real backend is wired in.
    if (BACKEND_BASE_URL.includes('your-backend.example.com')) {
      return this.mockResponse(call);
    }

    let path = tool.urlTemplate!;
    for (const [key, value] of Object.entries(call.args)) {
      path = path.replace(`{${key}}`, encodeURIComponent(String(value)));
    }
    const url = `${BACKEND_BASE_URL}${path}`;
    const headers = new HttpHeaders({ Authorization: `Bearer ${await this.auth.getAccessToken()}` });

    if (tool.method === 'GET') {
      return firstValueFrom(this.http.get(url, { headers }));
    }
    return firstValueFrom(this.http.post(url, call.args, { headers }));
  }

  private mockResponse(call: ToolCall): unknown {
    switch (call.tool) {
      case 'getOrderStatus':
        return { orderId: call.args['orderId'], status: 'Out for delivery', eta: 'Today, 6pm' };
      case 'getAccountBalance':
        return { balance: 1284.5, currency: 'USD' };
      default:
        return {};
    }
  }
}
