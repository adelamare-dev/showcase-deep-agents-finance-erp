// Starts the stack the stub scenarios need: the Mistral stub, then the agent
// pointed at it with a fake key, then the web app (run `pnpm build` first).
// Plain Node, no dependency.
//
//   node e2e/fixtures/stack.mjs [--logs <dir>]   start; stays in the foreground
//   node e2e/fixtures/stack.mjs stop             stop what a running start launched
//
// Run `start` in the background (`nohup node e2e/fixtures/stack.mjs ... &`). It
// prints "stack ready" once the three servers answer. Ports: stub 8790 (override
// with STUB_PORT, and keep STUB_URL in e2e/lib/helpers.js in step), agent 8123,
// web 3000. It refuses to start when one of them is taken.
import { spawn, spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pidFile = join(root, ".playwright-mcp", "stack.pid");
const STUB_PORT = Number(process.env.STUB_PORT ?? 8790);
const logFlag = process.argv.indexOf("--logs");
const logDir = logFlag > 0 ? process.argv[logFlag + 1] : join(root, ".playwright-mcp", "stack-logs");

const killTree = (pid) => spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "inherit" });

if (process.argv[2] === "stop") {
  let pid;
  try {
    pid = Number(readFileSync(pidFile, "utf8"));
  } catch {
    console.log("No stack is recorded as running.");
    process.exit(0);
  }
  killTree(pid);
  rmSync(pidFile, { force: true });
  process.exit(0);
}

const isFree = (port) =>
  new Promise((resolve) => {
    const probe = createServer().once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });

for (const port of [STUB_PORT, 8123, 3000]) {
  if (!(await isFree(port))) {
    console.error(`Port ${port} is already in use; stop what listens there first.`);
    process.exit(1);
  }
}

mkdirSync(dirname(pidFile), { recursive: true });
mkdirSync(logDir, { recursive: true });
writeFileSync(pidFile, String(process.pid));

const children = [];
const start = (name, command, args, options = {}) => {
  const out = openSync(join(logDir, `${name}.log`), "a");
  // One command string: the shell is needed to find `pnpm` and `uv` on Windows.
  const child = spawn([command, ...args].join(" "), {
    cwd: options.cwd ?? root,
    env: { ...process.env, ...options.env },
    stdio: ["ignore", out, out],
    shell: true,
    windowsHide: true,
  });
  closeSync(out);
  children.push(child);
  child.on("exit", (code) => {
    console.error(`${name} exited with code ${code}`);
    shutdown(1);
  });
};

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) killTree(child.pid);
  rmSync(pidFile, { force: true });
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

const waitFor = async (url, label) => {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.error(`${label} did not answer at ${url}`);
  shutdown(1);
};

start("stub", "node", ["e2e/fixtures/mistral-stub.mjs", "--port", String(STUB_PORT)]);
await waitFor(`http://127.0.0.1:${STUB_PORT}/__health`, "stub");

// A fake key: the stub accepts anything, and the real key in agent/.env is
// never read because load_dotenv() does not override variables already set.
start("agent", "uv", ["run", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8123"], {
  cwd: join(root, "agent"),
  env: {
    MISTRAL_BASE_URL: `http://127.0.0.1:${STUB_PORT}/v1`,
    MISTRAL_API_KEY: "stub-key",
    PYTHONUNBUFFERED: "1",
  },
});
await waitFor("http://127.0.0.1:8123/health", "agent");

start("web", "pnpm", ["start"]);
await waitFor("http://localhost:3000", "web");

console.log("stack ready");
