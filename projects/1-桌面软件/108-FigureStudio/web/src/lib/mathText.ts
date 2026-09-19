function latexExpressions(value: string): string[] {
  const expressions: string[] = [];
  const pattern = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$|\\\(([\s\S]+?)\\\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    expressions.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return expressions;
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
): Promise<string | undefined> {
  if (!value) return value;
  const expressions = latexExpressions(value);
  if (!expressions.length) return value;

  const mathJax = (window as any).MathJax;
  if (!mathJax?.tex2svgPromise) return plainMathFallback(value);

  try {
    if (mathJax.startup?.promise) await mathJax.startup.promise;
    for (const expression of expressions) {
      const node = await mathJax.tex2svgPromise(expression, {
        display: false
      });
      if (
        node?.querySelector?.('[data-mml-node="merror"]') ||
        node?.querySelector?.(".merror")
      ) {
        return plainMathFallback(value);
      }
    }
    return value;
  } catch {
    return plainMathFallback(value);
  }
}
