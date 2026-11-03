// Turns the error a failed agent run carries into one sentence for the user.
// The raw text is never shown: it can hold the provider's URL and body.

export type RunErrorKind = "rate-limit" | "model" | "unreachable" | "unknown";

export type RunErrorInfo = { kind: RunErrorKind; message: string };

const MESSAGES: Record<RunErrorKind, string> = {
  "rate-limit":
    "The model service is receiving too many requests right now. Wait a few seconds, then retry.",
  model: "The model service returned an error. Retry in a moment.",
  unreachable: "The agent service is not reachable. Start the agent, then retry.",
  unknown: "The assistant could not finish this answer. Retry to run it again.",
};

// The provider status the agent forwards in its error text, if any.
function providerStatus(text: string): number | null {
  const match = /Error response (\d{3})/.exec(text);
  return match ? Number(match[1]) : null;
}

export function describeRunError(raw: unknown): RunErrorInfo {
  const text =
    raw instanceof Error ? raw.message : typeof raw === "string" ? raw : "";
  const status = providerStatus(text);
  let kind: RunErrorKind = "unknown";
  if (status === 429 || /too many requests|rate.?limit/i.test(text)) {
    kind = "rate-limit";
  } else if (status !== null || /timed? ?out|timeout/i.test(text)) {
    kind = "model";
  } else if (
    /fetch failed|failed to fetch|econnrefused|enotfound|networkerror|network error|unreachable|socket hang up|\b50[234]\b/i.test(
      text,
    )
  ) {
    kind = "unreachable";
  }
  return { kind, message: MESSAGES[kind] };
}
