export type MathTextState = "plain" | "valid" | "invalid";

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
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  varepsilon: "ϵ",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  vartheta: "ϑ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  tau: "τ",
  upsilon: "υ",
  phi: "φ",
  varphi: "ϕ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Xi: "Ξ",
  Pi: "Π",
  Sigma: "Σ",
  Upsilon: "Υ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",
  pm: "±",
  mp: "∓",
  times: "×",
  cdot: "·",
  approx: "≈",
  sim: "∼",
  neq: "≠",
  ne: "≠",
  leq: "≤",
  geq: "≥",
  infty: "∞",
  partial: "∂",
  nabla: "∇",
  degree: "°",
  angstrom: "Å"
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

function stripSimpleGroups(value: string): string {
  return value
    .replace(/\\(?:mathrm|mathbf|mathit|text)\{([^{}]*)\}/g, "$1")
    .replace(/\\left|\\right/g, "");
}

function convertScript(value: string, kind: "sub" | "sup"): string {
  const tag = kind === "sub" ? "sub" : "sup";
  return value.replace(
    kind === "sub"
      ? /_\{([^{}]+)\}|_([A-Za-z0-9+-=])/g
      : /\^\{([^{}]+)\}|\^([A-Za-z0-9+-=])/g,
    (_match, group, single) =>
      "<" + tag + ">" + (group ?? single ?? "") + "</" + tag + ">"
  );
}

function simpleLatexToPlotly(expression: string): string | null {
  let value = stripSimpleGroups(expression.trim());

  value = value.replace(/\\sqrt\{([^{}]+)\}/g, "√($1)");
  value = value.replace(
    /\\frac\{([^{}]+)\}\{([^{}]+)\}/g,
    "($1)/($2)"
  );

  value = convertScript(value, "sub");
  value = convertScript(value, "sup");

  value = value.replace(/\\([A-Za-z]+)/g, (full, name: string) => {
    return SYMBOLS[name] ?? full;
  });

  value = value
    .replace(/\\,/g, " ")
    .replace(/\\;/g, " ")
    .replace(/\\:/g, " ")
    .replace(/\\!/g, "")
    .replace(/\\ /g, " ")
    .replace(/[{}]/g, "");

  // Unknown TeX commands are intentionally rejected. For mixed labels we
  // prefer showing the user's exact source over silently dropping text.
  if (/\\[A-Za-z]+/.test(value)) return null;

  return value;
}

export function plainMathFallback(value: string | undefined): string | undefined {
  if (!value) return value;
  if (!/[\$]|\\\(|\\\)/.test(value)) return value;

  return value
    .replace(/\$/g, "&#36;")
    .replace(/\\\(/g, "&#92;(")
    .replace(/\\\)/g, "&#92;)");
}

function composeSafeInline(value: string, segments: MathSegment[]): string | null {
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

export async function resolveSafeMathText(
  value: string | undefined
): Promise<SafeMathText> {
  if (!value) return { text: value, state: "plain" };

  const segments = latexSegments(value);
  if (!segments.length) return { text: value, state: "plain" };

  const mathJax = (window as any).MathJax;

  // Validate TeX first. A bad expression must never break the plot.
  if (mathJax?.tex2svgPromise) {
    try {
      if (mathJax.startup?.promise) await mathJax.startup.promise;
      for (const segment of segments) {
        const node = await mathJax.tex2svgPromise(segment.expression, {
          display: false
        });
        if (
          node?.querySelector?.('[data-mml-node="merror"]') ||
          node?.querySelector?.(".merror")
        ) {
          return {
            text: plainMathFallback(value),
            state: "invalid"
          };
        }
      }
    } catch {
      return {
        text: plainMathFallback(value),
        state: "invalid"
      };
    }
  }

  // Scientific inline labels should remain one Plotly text object.
  // This avoids Plotly/MathJax replacing only the math fragment and losing
  // surrounding plain text.
  const inline = composeSafeInline(value, segments);
  if (inline !== null) {
    return { text: inline, state: "valid" };
  }

  // Full-formula input can still use MathJax directly.
  if (
    segments.length === 1 &&
    segments[0].start === 0 &&
    segments[0].end === value.length &&
    mathJax?.tex2svgPromise
  ) {
    return {
      text: "$" + segments[0].expression + "$",
      state: "valid"
    };
  }

  // Unsupported complex mixed text: keep the complete source visible.
  return {
    text: plainMathFallback(value),
    state: "invalid"
  };
}
