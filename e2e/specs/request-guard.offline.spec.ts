import { expect, test } from "@playwright/test";

const AGENT = "http://127.0.0.1:8123";
const FOREIGN = "http://evil.example";

test("offline.request-guard the runtime route refuses a text/plain POST", async ({ request }) => {
  const response = await request.post("/api/copilotkit/agent/finance_erp_agent/run", {
    headers: { "content-type": "text/plain" },
    data: "{}",
  });
  expect(response.status()).toBe(415);
});

test("offline.request-guard the runtime route refuses a foreign Origin", async ({ request }) => {
  const response = await request.post("/api/copilotkit/agent/finance_erp_agent/run", {
    headers: { "content-type": "application/json", origin: FOREIGN },
    data: "{}",
  });
  expect(response.status()).toBe(403);
});

// The stack runs on seed data, so a snapshot comparison could not tell a refused
// reset from an applied one; agent/tests/test_origin_guard.py proves the store
// is untouched after a payment.
test("offline.request-guard the agent refuses a foreign-origin reset", async ({ request }) => {
  const response = await request.post(`${AGENT}/api/erp/reset`, {
    headers: { "content-type": "text/plain", origin: FOREIGN },
  });
  expect(response.status()).toBe(403);
});
