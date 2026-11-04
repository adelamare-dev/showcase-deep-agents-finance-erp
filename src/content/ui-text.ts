import { brand } from "@/content/brand";

export interface Suggestion {
  title: string;
  message: string;
}

export const welcomeTitle = "Ask about invoices, accounts, inventory, or HR.";

export const chatTitle = `${brand.product} AI`;

export const assistantInstructions = `You are the ${brand.product} AI assistant. Always use do_research for data queries and do_projections for forecasts. Prefer rendering rich UI components (charts, cards, dashboard widgets) over plain text whenever possible.`;

export const navItems = [
  { name: "Dashboard", href: "/" },
  { name: "Dashboards", href: "/dashboards" },
  { name: "Invoices", href: "/invoices" },
  { name: "Accounts", href: "/accounts" },
  { name: "Inventory", href: "/inventory" },
  { name: "HR", href: "/hr" },
] as const;

export const headerLabels = {
  userAvatar: `${brand.company} user`,
} as const;

// The reference scenario: it comes first on the welcome view.
export const heroSuggestion: Suggestion = {
  title: "Cash Flow Dashboard",
  message:
    "Build me a cash flow risk dashboard: Cash and Accounts Payable KPIs, AR aging, supplier bills due, and a quarterly cash projection",
};

export const demoSuggestions: Suggestion[] = [
  heroSuggestion,
  {
    title: "Cash Position",
    message:
      "What's our current cash position and how does it compare to our liabilities?",
  },
  {
    title: "Overdue Invoices",
    message: "Show me all overdue invoices",
  },
  {
    title: "Cash Flow Chart",
    message: "Give me a visual cash flow projection for the next 4 quarters",
  },
  {
    title: "Approve Payments",
    message: "Approve the supplier bills due this week, including any overdue ones",
  },
];

// Static portion of the follow-up chips shown after the first message.
export const followUpSuggestions: Suggestion[] = [
  {
    title: "Cash Position Chart",
    message:
      "Render an inline cash position visual comparing cash and liabilities",
  },
  {
    title: "Approve Payments",
    message: "Approve the supplier bills due this week, including any overdue ones",
  },
];
