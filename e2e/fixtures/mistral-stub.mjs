// Local stand-in for the Mistral chat completions API, for scenarios that must
// run without a model: reset, failures, anything that needs a scripted answer.
// Plain Node, no dependency. The agent talks to it when it starts with
// MISTRAL_BASE_URL=http://127.0.0.1:<port>/v1 (langchain-mistralai reads it).
//
//   node e2e/fixtures/mistral-stub.mjs [--port 8790]
//
// Control routes (JSON):
//   POST /__script    replaces the queue. Body: one step or an array of steps.
//   POST /__release   lets every held stream finish.
//   POST /__reset     empties the queue and the request log.
//   GET  /__requests  what the agent sent: [{ stream, messages, lastRole, model }].
//   GET  /__health    { status: "ok", queued: <steps left> }
//
// Each model call takes the next step off the queue; the request itself is
// never inspected. An empty queue answers 500, so an unexpected call is loud.
// A step is one of:
//   { text: "..." }                              a streamed text answer
//   { toolCall: { name, args } }                 a streamed tool call (args: object)
//   { text: "...", toolCall: { name, args } }    both, text first
//   { status: 429, retryAfter: 2, message: "" }  an HTTP error, with an optional
//                                                Retry-After header (seconds)
// Any answer step also accepts `hold: true`: the stream stays open after its
// first chunk until POST /__release (or until the client disconnects).
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

const MODEL = "ministral-14b-2512";
const CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

const port = (() => {
  const flag = process.argv.indexOf("--port");
  return Number(flag > 0 ? process.argv[flag + 1] : process.env.STUB_PORT ?? 8790);
})();

let queue = [];
let requests = [];
let releases = [];

// Mistral tool call ids are exactly nine letters or digits.
const toolCallId = () =>
  Array.from(randomBytes(9), (b) => CHARS[b % CHARS.length]).join("");

const readJson = (req) =>
  new Promise((resolve, reject) => {
    const parts = [];
    req.on("data", (p) => parts.push(p));
    req.on("end", () => {
      try {
        resolve(parts.length ? JSON.parse(Buffer.concat(parts).toString("utf8")) : null);
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });

const sendJson = (res, status, body, headers = {}) => {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};

const chunk = (delta, finishReason = null, extra = {}) => ({
  id: "cmpl-stub",
  object: "chat.completion.chunk",
  created: Math.floor(Date.now() / 1000),
  model: MODEL,
  choices: [{ index: 0, delta, finish_reason: finishReason }],
  ...extra,
});

const USAGE = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };

const toolCallDelta = (call) => ({
  tool_calls: [
    {
      id: toolCallId(),
      index: 0,
      function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
    },
  ],
});

// Resolves when the held stream is released or the client goes away.
const held = (res) =>
  new Promise((resolve) => {
    releases.push(resolve);
    res.on("close", resolve);
  });

async function answerStreaming(res, step) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const send = (c) => res.write(`data: ${JSON.stringify(c)}\n\n`);
  send(chunk({ role: "assistant", content: "" }));
  const words = (step.text ?? "").split(/(?<=\s)/).filter(Boolean);
  for (const [i, word] of words.entries()) {
    send(chunk({ content: word }));
    if (i === 0 && step.hold) await held(res);
  }
  if (step.hold && words.length === 0) await held(res);
  if (step.toolCall) {
    send(chunk(toolCallDelta(step.toolCall), "tool_calls", { usage: USAGE }));
  } else {
    send(chunk({ content: "" }, "stop", { usage: USAGE }));
  }
  res.write("data: [DONE]\n\n");
  res.end();
}

async function answerWhole(res, step) {
  if (step.hold) await held(res);
  const message = { role: "assistant", content: step.text ?? "" };
  if (step.toolCall) message.tool_calls = toolCallDelta(step.toolCall).tool_calls;
  sendJson(res, 200, {
    id: "cmpl-stub",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: MODEL,
    choices: [{ index: 0, message, finish_reason: step.toolCall ? "tool_calls" : "stop" }],
    usage: USAGE,
  });
}

async function chatCompletions(req, res) {
  const body = (await readJson(req)) ?? {};
  const messages = Array.isArray(body.messages) ? body.messages : [];
  requests.push({
    stream: body.stream === true,
    messages: messages.length,
    lastRole: messages.at(-1)?.role ?? null,
    model: body.model ?? null,
  });
  const step = queue.shift();
  if (!step) {
    return sendJson(res, 500, { message: "The Mistral stub has no scripted answer left." });
  }
  if (step.status) {
    const headers = step.retryAfter === undefined ? {} : { "Retry-After": String(step.retryAfter) };
    return sendJson(res, step.status, { message: step.message ?? `Scripted error ${step.status}` }, headers);
  }
  return body.stream === true ? answerStreaming(res, step) : answerWhole(res, step);
}

const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://stub").pathname;
  try {
    if (req.method === "POST" && path === "/__script") {
      const body = await readJson(req);
      queue = Array.isArray(body) ? body : body ? [body] : [];
      return sendJson(res, 200, { queued: queue.length });
    }
    if (req.method === "POST" && path === "/__release") {
      const pending = releases;
      releases = [];
      pending.forEach((release) => release());
      return sendJson(res, 200, { released: pending.length });
    }
    if (req.method === "POST" && path === "/__reset") {
      queue = [];
      requests = [];
      return sendJson(res, 200, { status: "reset" });
    }
    if (req.method === "GET" && path === "/__requests") return sendJson(res, 200, requests);
    if (req.method === "GET" && path === "/__health") {
      return sendJson(res, 200, { status: "ok", queued: queue.length });
    }
    if (req.method === "POST" && path.endsWith("/chat/completions")) {
      return await chatCompletions(req, res);
    }
    return sendJson(res, 404, { message: `No route for ${req.method} ${path}` });
  } catch (e) {
    if (!res.headersSent) sendJson(res, 400, { message: String(e?.message ?? e) });
    else res.end();
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Mistral stub listening on http://127.0.0.1:${port}`);
});
