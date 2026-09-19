import type { CellValue, Column, ColumnRole, DataSheet } from "../model";

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

function toCell(cell: string): CellValue {
  const cleaned = cleanCell(cell);
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : cleaned;
}

function splitNameAndUnit(label: string): { name: string; unit?: string } {
  const match = label.trim().match(/^(.*?)\s*[\[(]([^\])]+)[\])]\s*$/);
  if (!match) return { name: label.trim() || "列" };
  return {
    name: match[1].trim() || label.trim(),
    unit: match[2].trim()
  };
}

function roleForColumn(
  index: number,
  label: string,
  values: CellValue[],
  firstNumericAssigned: boolean
): ColumnRole {
  const lower = label.toLowerCase();
  if (/yerr|y error|sigma|std|error/.test(lower)) return "YErr";
  if (/xerr|x error/.test(lower)) return "XErr";
  if (/label|name|sample|id/.test(lower)) return "Label";

  const nonNull = values.filter((value) => value !== null);
  const numeric = nonNull.filter((value) => typeof value === "number").length;
  const numericRatio = nonNull.length ? numeric / nonNull.length : 0;

  if (numericRatio < 0.6) return "Label";
  if (!firstNumericAssigned || index === 0) return "X";
  return "Y";
}

export function parseDelimitedText(text: string, fileName: string): DataSheet {
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.trim().length > 0);

  if (lines.length < 2) {
    throw new Error("数据至少需要两行。");
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
    return "列 " + String(index + 1);
  });

  const body = looksLikeHeader ? rows.slice(1) : rows;
  const columns: Column[] = [];
  let firstNumericAssigned = false;

  names.forEach((label, columnIndex) => {
    const values = body.map((row) => toCell(row[columnIndex] || ""));
    const parsed = splitNameAndUnit(label);
    const role = roleForColumn(
      columnIndex,
      label,
      values,
      firstNumericAssigned
    );

    if (role === "X") firstNumericAssigned = true;

    columns.push({
      id: makeId(parsed.name, columnIndex),
      name: parsed.name,
      unit: parsed.unit,
      role,
      values
    });
  });

  if (columns.length < 2) {
    throw new Error("没有识别到至少两列数据。");
  }

  const cleanName = fileName.replace(/\.[^.]+$/, "") || "导入数据";

  return {
    id: "sheet-" + Date.now().toString(36),
    name: cleanName,
    source: { kind: "embedded" },
    columns
  };
}
