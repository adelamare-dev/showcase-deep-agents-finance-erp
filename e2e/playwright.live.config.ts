import { defineConfig } from "@playwright/test";
import base from "../playwright.config";

// The live scenarios run against a `pnpm demo` already started with a real
// MISTRAL_API_KEY, so this config starts no server.
export default defineConfig({
  ...base,
  testDir: "specs",
  webServer: undefined,
  projects: base.projects?.filter((p) => p.name === "live"),
});
