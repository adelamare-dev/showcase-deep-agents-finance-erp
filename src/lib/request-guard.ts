// Refuses requests a browser page on another site could send to the local
// runtime route. A cross-origin `text/plain` POST needs no CORS preflight, so
// the route itself must check who is calling and what it sends.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const refuse = (status: number, error: string): Response =>
  Response.json({ error }, { status });

// `host` of a `Host` header value (hostname plus any non-default port), or null.
function parseHost(value: string): URL | null {
  try {
    return new URL(`http://${value}`);
  } catch {
    return null;
  }
}

export function refuseForeignRequest(request: Request): Response | null {
  const hostHeader = request.headers.get("host");
  const host = hostHeader === null ? null : parseHost(hostHeader);
  if (host === null || !LOCAL_HOSTS.has(host.hostname)) {
    return refuse(403, "Host not allowed");
  }

  if (request.method === "GET" || request.method === "HEAD") return null;

  const origin = request.headers.get("origin");
  if (origin !== null) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      // "null" or garbage: treated as foreign below.
    }
    if (originHost !== host.host) return refuse(403, "Origin not allowed");
  }

  if (request.method === "POST") {
    const type = (request.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (type !== "application/json") {
      return refuse(415, "Content-Type must be application/json");
    }
  }
  return null;
}
