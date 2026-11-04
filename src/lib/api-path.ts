/** Paths served by the Worker API; everything else goes to static assets. */
const API_PREFIXES = ["/v1", "/webhooks", "/mcp", "/.well-known"];

export function isApiPath(path: string): boolean {
  if (path === "/health") return true;
  // Match "/mcp" and "/mcp/…", not pages like "/mcp-signup-qa".
  return API_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
