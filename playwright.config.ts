import { defineConfig } from "@playwright/test";

// The stack is the one e2e/fixtures/stack.mjs starts: the Mistral stub, the
// agent pointed at it with a fake key, then the built web app (`pnpm build`).
const server = { reuseExistingServer: false, timeout: 120_000 };

export default defineConfig({
  testDir: "e2e/specs",
  // The stub's answer queue is shared, so tests run one at a time.
  workers: 1,
  fullyParallel: false,
  timeout: 300_000,
  use: {
    baseURL: "http://localhost:3000",
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    { name: "offline", grep: /offline\./ },
    { name: "stub", grep: /stub\./ },
    { name: "live", grep: /live\./ },
  ],
  webServer: [
    {
      command: "node e2e/fixtures/mistral-stub.mjs --port 8790",
      url: "http://127.0.0.1:8790/__health",
      ...server,
    },
    {
      command: "uv run uvicorn main:app --host 127.0.0.1 --port 8123",
      cwd: "agent",
      env: {
        MISTRAL_BASE_URL: "http://127.0.0.1:8790/v1",
        MISTRAL_API_KEY: "stub-key",
        PYTHONUNBUFFERED: "1",
      },
      url: "http://127.0.0.1:8123/health",
      ...server,
    },
    {
      command: "pnpm start",
      url: "http://localhost:3000",
      ...server,
    },
  ],
});
