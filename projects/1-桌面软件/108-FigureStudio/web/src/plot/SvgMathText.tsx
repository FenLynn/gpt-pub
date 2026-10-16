import { useEffect, useMemo, useState } from "react";
import {
  hasLatexMath,
  plainSvgMathFallback,
  renderMathTextSvg,
  type MathSvgGeometry
} from "../lib/mathText";

export interface SvgMathTextProps {
  text?: string;
  x: number;
  y: number;
  fontSize: number;
  fontFamily?: string;
  fill?: string;
  fontWeight?: number | string;
  textAnchor?: "start" | "middle" | "end";
  rotate?: number;
  opacity?: number;
  className?: string;
}

/**
 * SVG-native mixed text/math renderer.
 *
 * Plain strings remain normal editable SVG <text>. Strings containing
 * $...$, $$...$$ or \( ... \) are rendered by bundled MathJax into nested
 * vector SVG paths, so the same DOM is used for screen, SVG and PNG export.
 */
export function SvgMathText({
  text = "",
  x,
  y,
  fontSize,
  fontFamily,
  fill = "currentColor",
  fontWeight,
  textAnchor = "start",
  rotate,
  opacity,
  className
}: SvgMathTextProps) {
  const usesMath = useMemo(() => hasLatexMath(text), [text]);
  const [geometry, setGeometry] = useState<MathSvgGeometry | null>(null);
  const [resolved, setResolved] = useState(!usesMath);

  useEffect(() => {
    let cancelled = false;
    if (!usesMath) {
      setGeometry(null);
      setResolved(true);
      return () => { cancelled = true; };
    }
    setResolved(false);
    setGeometry(null);
    void renderMathTextSvg(text).then(result => {
      if (cancelled) return;
      setGeometry(result);
      setResolved(true);
    });
    return () => { cancelled = true; };
  }, [text, usesMath]);

  const transform = rotate ? "rotate(" + rotate + " " + x + " " + y + ")" : undefined;

  if (!usesMath) {
    return <text
      className={className}
      x={x}
      y={y}
      fill={fill}
      opacity={opacity}
      fontFamily={fontFamily}
      fontSize={fontSize}
      fontWeight={fontWeight}
      textAnchor={textAnchor}
      transform={transform}
    >{text}</text>;
  }

  if (!geometry) {
    return <text
      className={className}
      x={x}
      y={y}
      fill={fill}
      opacity={opacity}
      fontFamily={fontFamily}
      fontSize={fontSize}
      fontWeight={fontWeight}
      textAnchor={textAnchor}
      transform={transform}
      data-math-source={text}
      data-math-pending={resolved ? "error" : "true"}
    >{plainSvgMathFallback(text)}</text>;
  }

  // MathJax SVG uses a 1000-unit em coordinate system with baseline at y=0.
  const scale = fontSize / 1000;
  const renderWidth = geometry.width * scale;
  const renderHeight = geometry.height * scale;
  const left =
    textAnchor === "middle" ? x - renderWidth / 2 :
    textAnchor === "end" ? x - renderWidth :
    x;
  const top = y + geometry.minY * scale;

  return <g
    className={className}
    transform={transform}
    opacity={opacity}
    data-math-source={text}
    data-math-rendered="true"
  >
    <svg
      x={left}
      y={top}
      width={renderWidth}
      height={renderHeight}
      viewBox={geometry.minX + " " + geometry.minY + " " + geometry.width + " " + geometry.height}
      overflow="visible"
      xmlns="http://www.w3.org/2000/svg"
      xmlnsXlink="http://www.w3.org/1999/xlink"
      style={{ color: fill }}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: geometry.innerSvg }}
    />
  </g>;
}
