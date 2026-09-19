export type MathTextState =
  | "plain"
  | "valid"
  | "invalid"
  | "unavailable";

export interface SafeMathText {
  text?: string;
  state: MathTextState;
}

interface MathSegment {
  start: number;
  end: number;
  expression: string;
}

const SYMBOLS: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε",
  varepsilon: "ϵ", zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ",
  iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ",
  pi: "π", rho: "ρ", sigma: "σ", tau: "τ", upsilon: "υ", phi: "φ",
  varphi: "ϕ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π",
  Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  pm: "±", mp: "∓", times: "×", cdot: "·", approx: "≈", sim: "∼",
  neq: "≠", ne: "≠", leq: "≤", geq: "≥", infty: "∞",
  partial: "∂", nabla: "∇", degree: "°", angstrom: "Å"
};

function latexSegments(value: string): MathSegment[] {
  const segments: MathSegment[] = [];
  const pattern = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$|\\\(([\s\S]+?)\\\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    segments.push({
      start: match.index,
      end: match.index + match[0].length,
      expression: match[1] ?? match[2] ?? match[3] ?? ""
    });
  }
  return segments;
}

function hasUnbalancedMathDelimiters(value: string): boolean {
  const dollars = (value.match(/(?<!\\)\$/g) ?? []).length;
  if (dollars % 2 !== 0) return true;
  const opens = (value.match(/\\\(/g) ?? []).length;
  const closes = (value.match(/\\\)/g) ?? []).length;
  return opens !== closes;
}

function balancedBraces(value: string): boolean {
  let depth = 0;
  for (const char of value) {
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

function escapeTextForLatex(value: string): string {
  return Array.from(value)
    .map((char) => {
      switch (char) {
        case "\\":
          return "\\backslash{}";
        case "{":
          return "\\{";
        case "}":
          return "\\}";
        case "$":
          return "\\$";
        case "%":
          return "\\%";
        case "#":
          return "\\#";
        case "&":
          return "\\&";
        case "_":
          return "\\_";
        case "^":
          return "\\^{}";
        case "\n":
        case "\r":
        case "\t":
          return " ";
        default:
          return char;
      }
    })
    .join("");
}

function mathJaxExpression(value: string, segments: MathSegment[]): string | null {
  const parts: string[] = [];
  let cursor = 0;
  for (const segment of segments) {
    const literal = value.slice(cursor, segment.start);
    if (literal) parts.push("\\text{" + escapeTextForLatex(literal) + "}");
    const expression = segment.expression.trim();
    if (!expression || !balancedBraces(expression)) return null;
    parts.push(expression);
    cursor = segment.end;
  }
  const tail = value.slice(cursor);
  if (tail) parts.push("\\text{" + escapeTextForLatex(tail) + "}");
  return parts.join("");
}

function normalizeScriptWrappers(value: string): string {
  return value
    .replace(/_\\(?:mathrm|mathbf|mathit|text)\{([^{}]*)\}/g, "_{$1}")
    .replace(/\^\\(?:mathrm|mathbf|mathit|text)\{([^{}]*)\}/g, "^{$1}");
}

function stripSimpleGroups(value: string): string {
  return value
    .replace(/\\(?:mathrm|mathbf|mathit|text)\{([^{}]*)\}/g, "$1")
    .replace(/\\left|\\right/g, "");
}

function convertScript(value: string, kind: "sub" | "sup"): string {
  const tag = kind === "sub" ? "sub" : "sup";
  return value.replace(
    kind === "sub"
      ? /_\{([^{}]+)\}|_([A-Za-z0-9+\-=])/g
      : /\^\{([^{}]+)\}|\^([A-Za-z0-9+\-=])/g,
    (_match, group, single) =>
      "<" + tag + ">" + (group ?? single ?? "") + "</" + tag + ">"
  );
}

function simpleLatexToPlotly(expression: string): string | null {
  if (!balancedBraces(expression)) return null;
  let value = normalizeScriptWrappers(expression.trim());
  value = value.replace(/\\sqrt\{([^{}]+)\}/g, "√($1)");
  value = value.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "($1)/($2)");
  value = stripSimpleGroups(value);
  value = convertScript(value, "sub");
  value = convertScript(value, "sup");
  value = value.replace(/\\([A-Za-z]+)/g, (full, name: string) => SYMBOLS[name] ?? full);
  value = value
    .replace(/\\,/g, " ")
    .replace(/\\;/g, " ")
    .replace(/\\:/g, " ")
    .replace(/\\!/g, "")
    .replace(/\\ /g, " ")
    .replace(/[{}]/g, "");
  if (/\\[A-Za-z]+/.test(value)) return null;
  return value;
}

function composeFallback(value: string, segments: MathSegment[]): string | null {
  const parts: string[] = [];
  let cursor = 0;
  for (const segment of segments) {
    parts.push(value.slice(cursor, segment.start));
    const converted = simpleLatexToPlotly(segment.expression);
    if (converted === null) return null;
    parts.push(converted);
    cursor = segment.end;
  }
  parts.push(value.slice(cursor));
  return parts.join("");
}

export function plainMathFallback(value: string | undefined): string | undefined {
  if (!value) return value;
  return value
    .replace(/\$/g, "&#36;")
    .replace(/\\\(/g, "&#92;(")
    .replace(/\\\)/g, "&#92;)");
}

function visibleFallback(value: string, segments: MathSegment[]): string {
  return composeFallback(value, segments) ?? plainMathFallback(value) ?? value;
}

export function normalizePlotlyMathText(value: string | undefined): string | undefined {
  if (!value) return value;
  if (hasUnbalancedMathDelimiters(value)) return plainMathFallback(value);
  const segments = latexSegments(value);
  if (!segments.length) return value;
  const expression = mathJaxExpression(value, segments);
  if (!expression) return visibleFallback(value, segments);
  return "$" + expression + "$";
}

export async function resolveSafeMathText(value: string | undefined): Promise<SafeMathText> {
  if (!value) return { text: value, state: "plain" };
  if (hasUnbalancedMathDelimiters(value)) {
    return { text: plainMathFallback(value), state: "invalid" };
  }
  const segments = latexSegments(value);
  if (!segments.length) return { text: value, state: "plain" };
  const expression = mathJaxExpression(value, segments);
  if (!expression) return { text: visibleFallback(value, segments), state: "invalid" };

  const mathJax = (window as any).MathJax;
  if (!mathJax?.tex2svgPromise) {
    return { text: visibleFallback(value, segments), state: "unavailable" };
  }
  try {
    if (mathJax.startup?.promise) await mathJax.startup.promise;
    const node = await mathJax.tex2svgPromise(expression, { display: false });
    if (node?.querySelector?.('[data-mml-node="merror"]') || node?.querySelector?.(".merror")) {
      return { text: visibleFallback(value, segments), state: "invalid" };
    }
    return { text: "$" + expression + "$", state: "valid" };
  } catch {
    return { text: visibleFallback(value, segments), state: "invalid" };
  }
}
