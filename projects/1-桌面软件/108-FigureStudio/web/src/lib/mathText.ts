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

function escapeTextForLatex(value: string): string {
  const replacements: Record<string, string> = {
    "\\": "\\textbackslash{}",
    "{": "\\{",
    "}": "\\}",
    "$": "\\$",
    "&": "\\&",
    "#": "\\#",
    "%": "\\%",
    "_": "\\_",
    "^": "\\textasciicircum{}",
    "~": "\\textasciitilde{}"
  };

  return Array.from(value)
    .map((char) => replacements[char] ?? char)
    .join("");
}

function composeMixedMath(value: string, segments: MathSegment[]): string {
  if (
    segments.length === 1 &&
    segments[0].start === 0 &&
    segments[0].end === value.length
  ) {
    return "$" + segments[0].expression + "$";
  }

  const parts: string[] = [];
  let cursor = 0;

  for (const segment of segments) {
    const plain = value.slice(cursor, segment.start);
    if (plain) {
      parts.push("\\text{" + escapeTextForLatex(plain) + "}");
    }
    parts.push(segment.expression);
    cursor = segment.end;
  }

  const tail = value.slice(cursor);
  if (tail) {
    parts.push("\\text{" + escapeTextForLatex(tail) + "}");
  }

  return "$" + parts.join("") + "$";
}

export function plainMathFallback(value: string | undefined): string | undefined {
  if (!value) return value;
  if (!/[\$]|\\\(|\\\)/.test(value)) return value;

  return value
    .replace(/\$/g, "&#36;")
    .replace(/\\\(/g, "&#92;(")
    .replace(/\\\)/g, "&#92;)");
}

export async function resolveSafeMathText(
  value: string | undefined
): Promise<SafeMathText> {
  if (!value) return { text: value, state: "plain" };

  const segments = latexSegments(value);
  if (!segments.length) return { text: value, state: "plain" };

  const mathJax = (window as any).MathJax;
  if (!mathJax?.tex2svgPromise) {
    return {
      text: plainMathFallback(value),
      state: "invalid"
    };
  }

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

    return {
      text: composeMixedMath(value, segments),
      state: "valid"
    };
  } catch {
    return {
      text: plainMathFallback(value),
      state: "invalid"
    };
  }
}
