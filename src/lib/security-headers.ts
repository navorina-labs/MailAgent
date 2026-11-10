/** Security headers for static pages. Pages that show or store an API key get a strict CSP. */

/** Pages where an API key is visible or kept in the browser: no third-party scripts at all. */
const KEY_PAGES = new Set(["/term", "/term.html", "/get-key", "/get-key.html"]);

export const KEY_PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self' https://api.webmailagent.com",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

export function isKeyPage(path: string): boolean {
  return KEY_PAGES.has(path);
}

/** Headers to add to a static asset response for this path. */
export function securityHeadersFor(path: string): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  };
  headers["Content-Security-Policy"] = isKeyPage(path) ? KEY_PAGE_CSP : "frame-ancestors 'none'";
  return headers;
}

export function withSecurityHeaders(response: Response, path: string): Response {
  const out = new Response(response.body, response);
  for (const [name, value] of Object.entries(securityHeadersFor(path))) {
    if (!out.headers.has(name)) out.headers.set(name, value);
  }
  return out;
}
