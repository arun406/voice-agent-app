/**
 * Your MCP server (TypeScript, built with the Claude Agent SDK), once deployed
 * somewhere network-reachable (e.g. behind an HTTPS load balancer on AWS). It's
 * currently only running on your office laptop — update this once it has a real URL.
 *
 * Must speak the MCP "Streamable HTTP" transport (a single POST endpoint accepting
 * JSON-RPC 2.0 request bodies) — that's the default for an MCP server built with
 * @modelcontextprotocol/sdk's StreamableHTTPServerTransport, which the Claude Agent
 * SDK uses under the hood, so this should work as-is once you point it at a real URL.
 */
export const MCP_SERVER_URL = 'https://your-mcp-server.example.com/mcp';
