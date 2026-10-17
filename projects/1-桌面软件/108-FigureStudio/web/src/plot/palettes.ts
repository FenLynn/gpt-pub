import type { ColorCycleId } from "../model";
import { GOLDEN_STYLE } from "./goldenStyle";

export interface PublicationPalette {
  id: Exclude<ColorCycleId, "matplotlib" | "matlab">;
  label: string;
  englishLabel: string;
  description: string;
  colors: readonly string[];
}

export const PUBLICATION_PALETTES: Record<
  Exclude<ColorCycleId, "matplotlib" | "matlab">,
  PublicationPalette
> = {
  golden: {
    id: "golden",
    label: "Golden · Lorentz",
    englishLabel: "Golden Lorentz",
    description: "克制、精确、低饱和的 FigureStudio 核心出版语言",
    colors: [...GOLDEN_STYLE.palette, "#D8E0E6"]
  },
  "sunny-blue-bamboo": {
    id: "sunny-blue-bamboo",
    label: "晴蓝竹影",
    englishLabel: "Clear Blue Bamboo",
    description: "清透自然，适合材料、电催化与多组曲线",
    colors: ["#DFF0F5","#A3C4DE","#AFD8C2","#7EA98B","#F6EBBA","#E9B0A6","#C0C4C1","#F5F8FA"]
  },
  "mist-blue-celadon": {
    id: "mist-blue-celadon",
    label: "雾蓝青瓷",
    englishLabel: "Mist Blue Celadon",
    description: "清冷理性，适合光学、材料与催化",
    colors: ["#4F6D8A","#7FA6C9","#A7C4B0","#DCEDE6","#C4CBD6","#8EA1B7","#6B9B8F","#F5F7FA"]
  },
  "sea-salt-coral": {
    id: "sea-salt-coral",
    label: "海盐珊瑚",
    englishLabel: "Sea Salt Coral",
    description: "明净柔和，适合统计、多组数据与生医图",
    colors: ["#F7FAFC","#A7C7E7","#CFEAF6","#F4A7AE","#FBD9C9","#5878A6","#A6D0C6","#DADDE3"]
  },
  "apricot-haze": {
    id: "apricot-haze",
    label: "杏桃浅岚",
    englishLabel: "Apricot Haze",
    description: "柔和清雅，适合纳米材料、生医与填充曲线",
    colors: ["#FAD6C9","#B0C6A8","#FAF5E8","#92B3CD","#D99DA3","#D0E3DB","#A6B3C0","#E8E2DB"]
  },
  "burgundy-slate": {
    id: "burgundy-slate",
    label: "勃艮第灰",
    englishLabel: "Burgundy Slate",
    description: "克制成熟，适合材料、光谱与热分析",
    colors: ["#713E50","#A56778","#C997A3","#E9D5DB","#526879","#8FA4B3","#C4CFD6","#D5B78C"]
  },
  "nature-aurora": {
    id: "nature-aurora",
    label: "Nature Aurora",
    englishLabel: "Nature Aurora",
    description: "蓝紫绿柔和彩度，适合生命科学、聚类与多组统计",
    colors: ["#DDE6F3","#7FA4C8","#B59BC8","#D08AB6","#8FB79B","#6A5A8F","#3F345B","#F4F6FA"]
  }
};

export const PUBLICATION_PALETTE_ORDER: PublicationPalette["id"][] = [
  "golden",
  "sunny-blue-bamboo",
  "mist-blue-celadon",
  "sea-salt-coral",
  "apricot-haze",
  "burgundy-slate",
  "nature-aurora"
];

export function publicationPalette(id: ColorCycleId | undefined): PublicationPalette {
  if (!id || id === "matplotlib" || id === "matlab") return PUBLICATION_PALETTES.golden;
  return PUBLICATION_PALETTES[id];
}
