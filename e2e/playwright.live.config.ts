import { defineConfig } from "@playwright/test";
import base from "../playwright.config";

// The live scenarios run against a `pnpm demo` already started with a real
// MISTRAL_API_KEY, so this config starts no server.
export default defineConfig({
  ...base,
  testDir: "specs",
  // One test plays a whole scenario file. live.questions has 18 entries, each a
  // live run of up to about 2 minutes (one waits up to 4), so a full file needs
  // well over the 5 minutes of the stub project: allow 60 minutes.
  timeout: 3_600_000,
  webServer: undefined,
  projects: base.projects?.filter((p) => p.name === "live"),
});
