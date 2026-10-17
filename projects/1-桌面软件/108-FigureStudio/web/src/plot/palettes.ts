import type { ColorCycleId } from "../model";
import { GOLDEN_STYLE } from "./goldenStyle";

export interface PublicationPalette {
  id: Exclude<ColorCycleId, "matplotlib" | "matlab">;
  label: string;
  description: string;
  colors: readonly string[];
}

export const PUBLICATION_PALETTES = {
  golden: {
    id: "golden",
    label: "Golden · Lorentz",
    description: "FigureStudio 标准低饱和科研配色",
    colors: GOLDEN_STYLE.palette
  },
  "mist-blue-celadon": {
    id: "mist-blue-celadon",
    label: "雾蓝青瓷",
    description: "清冷理性，适合光学、材料与催化",
    colors: ["#4F6D8A","#7FA6C9","#A7C4B0","#6B9B8F","#C4CBD6","#8EA1B7","#F5F7FA"]
  },
  "sea-salt-coral": {
    id: "sea-salt-coral",
    label: "海盐珊瑚",
    description: "明净柔和，适合多组数据与生医图",
    colors: ["#5878A6","#A7C7E7","#F4A7AE","#FBD9C9","#A6D0C6","#DADDE3","#CFEAF6"]
  },
  "burgundy-slate": {
    id: "burgundy-slate",
    label: "勃艮第灰",
    description: "克制成熟，适合材料、光谱与热分析",
    colors: ["#713E50","#A56778","#C997A3","#526879","#8FA4B3","#D5B78C","#C4CFD6"]
  }
} as const;

export function publicationPalette(id: ColorCycleId | undefined) {
  if (!id || id === "golden" || id === "matplotlib" || id === "matlab") {
    return PUBLICATION_PALETTES.golden;
  }
  return PUBLICATION_PALETTES[id];
}
