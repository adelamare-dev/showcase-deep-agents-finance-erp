import { HttpAgent } from "@ag-ui/client";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";

const runtime = new CopilotRuntime({
  agents: {
    finance_erp_agent: new HttpAgent({
      url:
        process.env.REMOTE_ACTION_URL ||
        "http://127.0.0.1:8123/copilotkit/agents/finance_erp_agent",
    }),
  },
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handler;
export const POST = handler;
