import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { refuseForeignRequest } from "../../src/lib/request-guard";

// The titles start with "offline." so the offline project plays them.
const call = (
  method: string,
  headers: Record<string, string>,
): Response | null =>
  refuseForeignRequest(
    new Request("http://localhost:3000/api/copilotkit/x", { method, headers }),
  );

const json = { "content-type": "application/json" };

test("offline.request-guard admits a local host on every loopback form", () => {
  for (const host of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000", "localhost"]) {
    expect(call("GET", { host })).toBeNull();
  }
});

test("offline.request-guard refuses a foreign or missing host", () => {
  for (const host of ["evil.example", "evil.example:3000", "localhost.evil.example:3000", "10.0.0.5:3000"]) {
    expect(call("GET", { host })?.status).toBe(403);
  }
  expect(call("GET", {})?.status).toBe(403);
});

test("offline.request-guard admits a GET without an Origin and ignores a foreign one", () => {
  expect(call("GET", { host: "localhost:3000" })).toBeNull();
  expect(call("GET", { host: "localhost:3000", origin: "http://evil.example" })).toBeNull();
});

test("offline.request-guard admits a POST whose Origin matches the Host", () => {
  expect(call("POST", { host: "localhost:3000", origin: "http://localhost:3000", ...json })).toBeNull();
  expect(call("POST", { host: "[::1]:3000", origin: "http://[::1]:3000", ...json })).toBeNull();
});

test("offline.request-guard admits a POST with no Origin", () => {
  expect(call("POST", { host: "localhost:3000", ...json })).toBeNull();
});

test("offline.request-guard refuses a foreign, null or unparsable Origin", async () => {
  for (const origin of ["http://evil.example", "http://localhost:4000", "http://127.0.0.1:3000", "null", "not a url"]) {
    const refused = call("POST", { host: "localhost:3000", origin, ...json });
    expect(refused?.status).toBe(403);
    expect(await refused?.json()).toEqual({ error: "Origin not allowed" });
  }
});

test("offline.request-guard requires a JSON POST and ignores media type parameters", () => {
  const base = { host: "localhost:3000", origin: "http://localhost:3000" };
  expect(call("POST", { ...base, "content-type": "text/plain" })?.status).toBe(415);
  expect(call("POST", base)?.status).toBe(415);
  expect(call("POST", { ...base, "content-type": "application/json; charset=utf-8" })).toBeNull();
  expect(call("POST", { ...base, "content-type": "Application/JSON" })).toBeNull();
});

test("offline.request-guard dev and start bind to the loopback interface", () => {
  const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
  expect(scripts["dev:web"]).toContain("-H 127.0.0.1");
  expect(scripts.start).toContain("-H 127.0.0.1");
});
