// Runs `uv sync` in agent/ (the install step) and explains the one failure
// that reads badly: the malware check cannot reach api.osv.dev.
import { spawn } from "node:child_process";
import { basename, dirname, resolve } from "node:path";

export function explainSyncFailure(stderr) {
  if (!/malware check failed due to an error from osv/i.test(stderr)) return null;
  return [
    "",
    "The malware check could not reach api.osv.dev, so uv stopped and nothing was installed.",
    "The check stays on. Check your network or proxy settings, then run `pnpm install` again (or `pnpm run postinstall`).",
    "",
  ].join("\n");
}

function run(script) {
  const agentDir = resolve(dirname(script), "../agent");
  const child = spawn("uv", ["sync"], {
    cwd: agentDir,
    stdio: ["inherit", "inherit", "pipe"],
  });
  child.stderr.setEncoding("utf8");
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
    process.stderr.write(chunk);
  });
  child.on("error", (err) => {
    console.error(`Could not start uv: ${err.message}`);
    process.exit(1);
  });
  child.on("close", (code) => {
    if (code !== 0) process.stderr.write(explainSyncFailure(stderr) ?? "");
    process.exit(code ?? 1);
  });
}

// Run only when started as `node scripts/agent-sync.mjs`, not when imported by
// the unit spec (which loads this file as CommonJS, so import.meta is out).
if (process.argv[1] && basename(process.argv[1]) === "agent-sync.mjs") run(resolve(process.argv[1]));
