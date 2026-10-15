import { defaultDataRef } from "./adapter";
import type { DataSheet, FigureSpec, UserDefaults } from "../model";

function id(prefix: string): string {
  return prefix + "-" + Math.random().toString(36).slice(2, 10);
}

/** Synthetic public test data: reproducible formulae, never laboratory measurements. */
export function createNatureDecaySheet(): DataSheet {
  const time: number[] = [], a: number[] = [], b: number[] = [];
  for (let i = 0; i < 120; i++) {
    const x = 0.1 + i * 0.8;
    time.push(Number(x.toFixed(3)));
    a.push(Number((1.2 * Math.exp(-x / 11) + 0.0015).toPrecision(6)));
    b.push(Number((0.87 * Math.exp(-x / 17) + 0.002).toPrecision(6)));
  }
  return {
    id: id("sheet-nature-decay"), name: "Synthetic decay",
    source: { kind: "embedded" },
    columns: [
      { id: "nature-decay-time", name: "Time", unit: "ms", role: "X", values: time },
      { id: "nature-decay-a", name: "Condition A", unit: "a.u.", role: "Y", values: a },
      { id: "nature-decay-b", name: "Condition B", unit: "a.u.", role: "Y", values: b }
    ]
  };
}

export function createNatureKineticsSheet(): DataSheet {
  const time: number[] = [], control: number[] = [], treatment: number[] = [];
  for (let i = 0; i < 91; i++) {
    const x = i * 1.25;
    time.push(x);
    control.push(Number((0.16 + 0.83 * (1 - Math.exp(-x / 25)) + 0.009 * Math.sin(i * 0.21)).toFixed(5)));
    treatment.push(Number((0.16 + 0.70 * (1 - Math.exp(-x / 43)) + 0.008 * Math.cos(i * 0.18)).toFixed(5)));
  }
  return {
    id: id("sheet-nature-kinetics"), name: "Synthetic kinetics",
    source: { kind: "embedded" },
    columns: [
      { id: "nature-kinetics-time", name: "Time", unit: "s", role: "X", values: time },
      { id: "nature-kinetics-control", name: "Control", unit: "a.u.", role: "Y", values: control },
      { id: "nature-kinetics-treatment", name: "Treatment", unit: "a.u.", role: "Y", values: treatment }
    ]
  };
}

/** Data stay in DataSheets, all gallery figures use exactly the normal editable FigureSpec. */
export function createNatureGallery(
  defaults: UserDefaults,
  sheets: {
    spectrum: DataSheet; dualY: DataSheet; waterfall: DataSheet;
    scatter: DataSheet; field: DataSheet; bar: DataSheet;
    decay: DataSheet; kinetics: DataSheet;
  }
): FigureSpec[] {
  const common: FigureSpec["figureOverrides"] = {
    publicationMode: "single", aspectMode: "4:3", fontFamily: "Arial",
    fontSizePt: 6.5, tickLabelSizePt: 6.1, axisTitleSizePt: 6.5,
    plotTitleSizePt: 7, legendFontSizePt: 5.9,
    background: "#ffffff", axisTitleColor: "#202328", tickLabelColor: "#202328",
    frameStyle: "open", tickDirection: "outside", minorTicks: false,
    gridVisible: false, axisLineWidthPt: 0.58,
    majorTickLengthPt: 2.6, minorTickLengthPt: 1.4, axisTitlePadPt: 2.7,
    marginLeftMm: 13.5, marginRightMm: 5.5, marginTopMm: 5.5,
    marginBottomMm: 12, legendFrame: false,
    legendOrientation: "vertical", legendPosition: "top-right"
  };
  const make = (
    sheet: DataSheet, name: string, template: FigureSpec["templateId"],
    options: FigureSpec["figureOverrides"],
    series: FigureSpec["seriesOverrides"] = {}, ids?: string[]
  ): FigureSpec => {
    const dataRef = defaultDataRef(sheet);
    const seriesOrder = ids ?? dataRef.yColumnIds;
    return {
      id: id("nature-figure"), name, folderId: "folder-nature",
      dataRef: { ...dataRef, yColumnIds: [...seriesOrder] },
      templateId: template, presetId: "nature",
      figureOverrides: { ...defaults.figureOverrides, ...common,
        errorSeriesId: dataRef.yErrorColumnId, ...options },
      seriesOverrides: series, seriesOrder: [...seriesOrder]
    };
  };
  const blue="#0072B2", vermilion="#D55E00", green="#009E73";
  return [
    make(sheets.spectrum, "N01 · Emission spectrum", "spectrum",
      { xTitle:"Wavelength (nm)",yTitle:"Spectral power (dBm)",legendPosition:"top-left" },
      { measured:{color:blue,lineWidthPt:0.82},fit:{color:vermilion,lineWidthPt:0.72,lineStyle:"dash"} },
      ["measured","fit"]),
    make(sheets.spectrum, "N02 · Peak detail", "spectrum",
      { xTitle:"Wavelength (nm)",yTitle:"Spectral power (dBm)",
        xAutoRange:false,xMin:1056,xMax:1078,xMajorTickStep:5,legendVisible:false },
      { measured:{color:blue,lineWidthPt:0.78} }, ["measured"]),
    make(sheets.kinetics, "N03 · Kinetic trajectories", "xy-line",
      { xTitle:"Time (s)",yTitle:"Normalized response (a.u.)",legendPosition:"bottom-right" },
      { "nature-kinetics-control":{color:blue,lineWidthPt:0.82},
        "nature-kinetics-treatment":{color:vermilion,lineWidthPt:0.82} },
      ["nature-kinetics-control","nature-kinetics-treatment"]),
    make(sheets.scatter, "N04 · Group comparison", "xy-scatter",
      { xTitle:"Temperature (°C)",yTitle:"Response (a.u.)",legendPosition:"top-left" },
      { "sample-a":{color:blue,markerSymbol:"circle",markerSizePt:3},
        "sample-b":{color:vermilion,markerSymbol:"square",markerSizePt:3} },
      ["sample-a","sample-b"]),
    make(sheets.scatter, "N05 · Error bars", "xy-errorbar",
      { xTitle:"Temperature (°C)",yTitle:"Response (a.u.)",
        legendVisible:false,errorSeriesId:"response-error" },
      { "sample-a":{color:blue,markerSymbol:"circle",markerSizePt:2.9,
        errorBarWidthPt:0.55,errorBarCapSizePt:2,errorBarColor:blue} }, ["sample-a"]),
    make(sheets.scatter, "N06 · Connected measurements", "xy-line-marker",
      { xTitle:"Temperature (°C)",yTitle:"Response (a.u.)",legendPosition:"bottom-right" },
      { "sample-a":{color:blue,lineWidthPt:0.75,markerSymbol:"circle",markerSizePt:2.7},
        "sample-b":{color:vermilion,lineWidthPt:0.75,markerSymbol:"square",markerSizePt:2.7} },
      ["sample-a","sample-b"]),
    make(sheets.decay, "N07 · Logarithmic decay", "xy-line",
      { xTitle:"Time (ms)",yTitle:"Signal amplitude (a.u.)",yScale:"log",legendPosition:"top-right" },
      { "nature-decay-a":{color:blue,lineWidthPt:0.8},
        "nature-decay-b":{color:vermilion,lineWidthPt:0.8} },
      ["nature-decay-a","nature-decay-b"]),
    make(sheets.dualY, "N08 · Dual-axis performance", "double-y",
      { xTitle:"Pump current (A)",yTitle:"Output power (W)",rightYTitle:"Efficiency (%)",
        marginRightMm:15,legendPosition:"top-left" },
      { "output-power":{color:blue,yAxis:"left",lineWidthPt:0.82},
        efficiency:{color:vermilion,yAxis:"right",lineWidthPt:0.82} },
      ["output-power","efficiency"]),
    make(sheets.waterfall, "N09 · Offset spectra", "offset-spectrum",
      { xTitle:"Wavelength (nm)",yTitle:"Spectral power + offset (dBm)",
        offsetStep:6,legendVisible:false }, {},
      ["waterfall-1","waterfall-2","waterfall-3","waterfall-4","waterfall-5"]),
    make(sheets.waterfall, "N10 · Waterfall spectra", "waterfall",
      { xTitle:"Wavelength (nm)",yTitle:"Spectral power + offset (dBm)",
        waterfallXOffset:0.24,waterfallYOffset:4.2,legendVisible:false }, {},
      ["waterfall-1","waterfall-2","waterfall-3","waterfall-4","waterfall-5"]),
    make(sheets.field, "N11 · Spatial intensity map", "heatmap",
      { xTitle:"Horizontal position (mm)",yTitle:"Vertical position (mm)",
        colorbarTitle:"Intensity (a.u.)",marginRightMm:13,legendVisible:false }),
    make(sheets.field, "N12 · Intensity contours", "contour",
      { xTitle:"Horizontal position (mm)",yTitle:"Vertical position (mm)",
        colorbarTitle:"Intensity (a.u.)",marginRightMm:13,legendVisible:false,
        contourLevels:12,contourFill:true,contourLines:true }),
    make(sheets.bar, "N13 · Modal composition", "stacked-bar",
      { xTitle:"Condition",yTitle:"Fraction (%)",
        legendPosition:"outside-right",marginRightMm:24,barLabelsVisible:false },
      { fundamental:{color:blue},"higher-order":{color:vermilion},loss:{color:green} },
      ["fundamental","higher-order","loss"])
  ];
}
