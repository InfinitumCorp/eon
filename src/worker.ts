import { CONSOLE_HTML } from "./console.ts";
import { handleEonRequest } from "./lib/eon/http.ts";

/**
 * Cloudflare Worker entry for the E(O)N™ MIL exercise.
 * Serves the console at / and the API at /api/eon/*.
 */
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const prefix = "/api/eon";
    if (url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)) {
      const splat = url.pathname.slice(prefix.length).replace(/^\//, "");
      return handleEonRequest(request, splat);
    }
    if (url.pathname === "/health") return handleEonRequest(request, "health");
    if (url.pathname === "/" && request.method === "GET") {
      return new Response(CONSOLE_HTML, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
        },
      });
    }
    return new Response("Not found.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  },
};
