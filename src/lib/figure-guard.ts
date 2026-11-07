// Rule that decides whether a figure written in the assistant's text is real.
// A figure is a dollar amount, a percentage or a count of ERP entities. It is
// admitted when it equals a number the tools returned this turn, a number of the
// store snapshot or a number the user typed, allowing for display rounding.
// agent/figure_guard.py applies the same rule to the same cases
// (agent/tests/data/figure_cases.json): change both together.
// Values are compared in absolute terms: a sign never makes a figure wrong.

export type FigureKind = "money" | "percent" | "count";
export type Figure = { raw: string; kind: FigureKind; value: number };

export const MARK_RE = /⟦unverified:([^⟧]+)⟧/g;

const SCALES: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  million: 1e6,
  b: 1e9,
  billion: 1e9,
};
const TOLERANCE = 1e-9;
const CENT = 0.005;

const NUMBER = String.raw`\d+(?:,\d{3})*(?:\.\d+)?`;
const ENTITY = String.raw`(?:employee|bill|invoice|client|customer|supplier|item)s?`;
const CURRENCY = String.raw`(?:USD|dollars?)`;
// A scaled number followed by an ERP entity ("2 million customers") is a count,
// not money; one adjective may sit between the number and the entity.
const ENTITY_AHEAD = String.raw`(?!\s+(?:[A-Za-z]+\s+)?${ENTITY}\b)`;
const MONEY =
  String.raw`(?:(?:\$|USD\s?)\s?(?<n1>${NUMBER})(?:\s?(?<s1>thousand|million|billion|[KMB])\b)?` +
  String.raw`|(?<![\w.,$])(?<n2>${NUMBER})\s?(?:(?<s2>thousand|million|billion)\b${ENTITY_AHEAD}(?:\s${CURRENCY}\b)?|${CURRENCY}\b))`;
const PERCENT = String.raw`(?<![\w.,])(${NUMBER})(?:\s?%|\s(?:percent)\b)`;
const COUNT = String.raw`(?<![\w.,$])(?<n>${NUMBER})(?:\s(?<s>thousand|million|billion))?\s+(?:[A-Za-z]+\s+)?${ENTITY}\b`;
const ANY_NUMBER = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`;

const toFloat = (digits: string) => Number(digits.replace(/,/g, ""));

// Hide the content of existing marks, keeping every offset.
const blankMarks = (text: string) => text.replace(/⟦unverified:[^⟧]*⟧/g, (m) => " ".repeat(m.length));

// Include a leading minus or a surrounding pair of parentheses.
function widen(text: string, start: number, end: number): [number, number] {
  if (start > 0 && text[start - 1] === "-" && (start === 1 || /\s/.test(text[start - 2]) || text[start - 2] === "(")) {
    return [start - 1, end];
  }
  if (start > 0 && text[start - 1] === "(" && text[end] === ")") return [start - 1, end + 1];
  return [start, end];
}

function scan(text: string): Array<{ start: number; end: number; fig: Figure }> {
  const hidden = blankMarks(text);
  const found: Array<{ start: number; end: number; fig: Figure }> = [];
  for (const m of hidden.matchAll(new RegExp(MONEY, "gi"))) {
    const g = m.groups!;
    const suffix = g.s1 ?? g.s2;
    const scale = suffix ? SCALES[suffix.toLowerCase()] : 1;
    const [start, end] = widen(hidden, m.index!, m.index! + m[0].length);
    found.push({
      start,
      end,
      fig: { raw: text.slice(start, end), kind: "money", value: Math.round(toFloat(g.n1 ?? g.n2) * scale * 1e6) / 1e6 },
    });
  }
  for (const m of hidden.matchAll(new RegExp(PERCENT, "gi"))) {
    found.push({ start: m.index!, end: m.index! + m[0].length, fig: { raw: m[0], kind: "percent", value: toFloat(m[1]) } });
  }
  for (const m of hidden.matchAll(new RegExp(COUNT, "gi"))) {
    const scale = m.groups!.s ? SCALES[m.groups!.s.toLowerCase()] : 1;
    found.push({
      start: m.index!,
      end: m.index! + m[0].length,
      fig: { raw: m[0], kind: "count", value: Math.round(toFloat(m.groups!.n) * scale * 1e6) / 1e6 },
    });
  }
  return found.sort((a, b) => a.start - b.start);
}

/** Dollar amounts, percentages and entity counts of `text`, in reading order. */
export function extractFigures(text: string): Figure[] {
  return scan(text).map((s) => s.fig);
}

function numbersIn(text: string): number[] {
  const values: number[] = [];
  for (const m of text.matchAll(new RegExp(ANY_NUMBER, "g"))) {
    values.push(toFloat(m[0]));
    // "[5,123]" is a list of two numbers as often as it is 5,123.
    if (m[0].includes(",")) values.push(...m[0].split(",").map(toFloat));
  }
  return values;
}

function leaves(node: unknown): number[] {
  if (typeof node === "number") return [Math.abs(node)];
  if (Array.isArray(node)) return node.flatMap(leaves);
  if (node && typeof node === "object") return Object.values(node).flatMap(leaves);
  return [];
}

/** Every number a figure may legitimately equal this turn. */
export function allowedValues(toolTexts: string[], snapshot: unknown, userText: string): Set<number> {
  const allowed = new Set<number>(leaves(snapshot));
  for (const text of [...toolTexts, userText]) for (const v of numbersIn(text ?? "")) allowed.add(Math.abs(v));
  return allowed;
}

const same = (a: number, b: number) => Math.abs(a - b) < TOLERANCE;

// Decimals a figure is written with, at least one.
const decimalsOf = (digits: string) => Math.max(digits.includes(".") ? digits.split(".")[1].length : 0, 1);

// Whether `value`, displayed with `decimals` decimals, may read `written`. No
// rounding function is involved, so exact halves behave as in the Python twin.
const within = (value: number, written: number, decimals: number) =>
  Math.abs(value - written) <= 0.5 * 10 ** -decimals + TOLERANCE;

function moneyAllowed(fig: Figure, allowed: Set<number>): boolean {
  const values = [...allowed];
  if (values.some((v) => Math.abs(fig.value - v) < CENT)) return true;
  const m = new RegExp(`^${MONEY}$`, "i").exec(fig.raw.replace(/^[-(]+|[)]+$/g, "").trim());
  const suffix = m?.groups && (m.groups.s1 ?? m.groups.s2);
  if (!m?.groups || !suffix) return false;
  const scale = SCALES[suffix.toLowerCase()];
  const digits = m.groups.n1 ?? m.groups.n2;
  const written = toFloat(digits);
  return values.some((v) => within(v / scale, written, decimalsOf(digits)));
}

/** Whether `fig` equals an allowed value, allowing for display rounding. */
export function isAllowed(fig: Figure, allowed: Set<number>): boolean {
  if (fig.kind === "money") return moneyAllowed(fig, allowed);
  const values = [...allowed];
  if (fig.kind === "percent") {
    const decimals = decimalsOf(/^[\d,.]+/.exec(fig.raw)![0]);
    return values.some((v) => within(v, fig.value, decimals) || (v <= 1 && within(v * 100, fig.value, decimals)));
  }
  return values.some((v) => same(v, fig.value));
}

/**
 * Wraps every figure of `text` that is not allowed in a mark, like the agent
 * does. Figures already inside a mark are left alone.
 */
export function markUnverified(text: string, allowed: Set<number>): string {
  const hidden = blankMarks(text);
  let out = "";
  let cursor = 0;
  for (const fig of extractFigures(text)) {
    if (isAllowed(fig, allowed)) continue;
    const at = hidden.indexOf(fig.raw, cursor);
    if (at < 0) continue;
    out += text.slice(cursor, at) + `⟦unverified:${fig.raw}⟧`;
    cursor = at + fig.raw.length;
  }
  return out + text.slice(cursor);
}
