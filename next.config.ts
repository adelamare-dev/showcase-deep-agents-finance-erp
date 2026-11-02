import type { NextConfig } from "next";

// The CopilotKit runtime reads this when it is first imported, so it is set
// here rather than in an env file that a fresh clone would not have.
process.env.COPILOTKIT_TELEMETRY_DISABLED ??= "true";

const nextConfig: NextConfig = {};

export default nextConfig;
