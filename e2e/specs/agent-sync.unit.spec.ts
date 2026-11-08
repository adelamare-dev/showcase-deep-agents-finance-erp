import { expect, test } from "@playwright/test";
import { explainSyncFailure } from "../../scripts/agent-sync.mjs";

// The stderr below is what `uv sync` printed with every connection to
// api.osv.dev refused. The titles start with "offline." so the offline
// project plays them.
const osvOutage = `Resolved 83 packages in 3ms
error: Malware check failed due to an error from OSV
  cause: Request failed after 3 retries
  cause: error sending request for url (https://api.osv.dev/v1/querybatch)
  cause: client error (Connect)
  cause: tunnel error: failed to create underlying connection
  cause: tcp connect error
  cause: No connection could be made because the target machine actively refused it. (os error 10061)
`;

test("offline.agent-sync explains an OSV outage", () => {
  const message = explainSyncFailure(osvOutage) as string;
  expect(message).toContain("api.osv.dev");
  expect(message).toContain("pnpm install");
});

test("offline.agent-sync stays silent when malware is found", () => {
  const found = `Resolved 83 packages in 3ms
error: Malware check found a known malicious package: foo==1.0 (MAL-2024-1234)
`;
  expect(explainSyncFailure(found)).toBeNull();
});

test("offline.agent-sync stays silent when malware is found and the message cites the OSV url", () => {
  const found = `error: Malware check found a known malicious package: foo==1.0 (see https://api.osv.dev/v1/vulns/MAL-2024-1234)
`;
  expect(explainSyncFailure(found)).toBeNull();
});

test("offline.agent-sync stays silent on other errors", () => {
  const resolution = `error: No solution found when resolving dependencies:
  Because there is no version of nonexistent-package==1.0 and your project depends on it, we can conclude that your project's requirements are unsatisfiable.
`;
  expect(explainSyncFailure(resolution)).toBeNull();
});
