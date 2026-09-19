import type { Column, Dataset, NumericValue } from "../model";

function makeId(text: string, index: number): string {
  const safe = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return safe || "column-" + String(index + 1);
}

function detectDelimiter(line: string): string {
  const choices = [",", "\t", ";"];
  let best = ",";
  let bestCount = -1;

  for (const delimiter of choices) {
    const count = line.split(delimiter).length - 1;
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }

  return best;
}

function cleanCell(cell: string): string {
  return cell.trim().replace(/^"(.*)"$/, "$1").trim();
}

function toNumber(cell: string): NumericValue {
  const cleaned = cleanCell(cell);
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function splitNameAndUnit(label: string): { name: string; unit?: string } {
  const match = label.trim().match(/^(.*?)\s*[\[(]([^\])]+)[\])]\s*$/);
  if (!match) return { name: label.trim() || "Column" };
  return {
    name: match[1].trim() || label.trim(),
    unit: match[2].trim()
  };
}

export function parseDelimitedText(text: string, fileName: string): Dataset {
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error("Need at least two rows of data.");
  }

  const delimiter = detectDelimiter(lines[0]);
  const rows = lines.map((line) => line.split(delimiter).map(cleanCell));
  const width = Math.max(...rows.map((row) => row.length));
  const firstRow = rows[0];

  const looksLikeHeader = firstRow.some((cell) => {
    if (!cell) return true;
    return !Number.isFinite(Number(cell));
  });

  const names = Array.from({ length: width }, (_, index) => {
    if (looksLikeHeader && firstRow[index]) return firstRow[index];
    return "Column " + String(index + 1);
  });

  const body = looksLikeHeader ? rows.slice(1) : rows;
  const numericColumns: Column[] = [];

  names.forEach((label, columnIndex) => {
    const values = body.map((row) => toNumber(row[columnIndex] || ""));
    const validCount = values.filter((value) => value !== null).length;
    const threshold = Math.max(2, Math.ceil(body.length * 0.6));

    if (validCount >= threshold) {
      const parsed = splitNameAndUnit(label);
      numericColumns.push({
        id: makeId(parsed.name, columnIndex),
        name: parsed.name,
        unit: parsed.unit,
        values
      });
    }
  });

  if (numericColumns.length < 2) {
    throw new Error("Could not find at least two numeric columns.");
  }

  const cleanName = fileName.replace(/\.[^.]+$/, "") || "Imported dataset";

  return {
    id: "dataset-" + Date.now().toString(36),
    name: cleanName,
    x: numericColumns[0],
    ys: numericColumns.slice(1, 9)
  };
}
