import type { DataSheet, FigureSpec, LorentzComposition, UserDefaults } from "../model";
import { defaultDataRef } from "./adapter";

/** Public analytical sample, not measured data. Three series share the same editable Sheet X column. */
export function createLorentzSheet(): DataSheet {
  const frequency:number[]=[],re:number[]=[],im:number[]=[],phase:number[]=[];
  const gamma=.115, amplitude=.76;
  for(let i=0;i<=1600;i++){
    const w=.4+1.2*i/1600, a=1-w*w, b=gamma*w, d=a*a+b*b;
    frequency.push(Number(w.toFixed(7)));
    re.push(Number((amplitude*a/d).toPrecision(10)));
    im.push(Number((amplitude*b/d).toPrecision(10)));
    phase.push(Number((Math.atan2(b,a)*180/Math.PI).toPrecision(10)));
  }
  return {
    id:"sheet-lorentz-golden",name:"Lorentz oscillator · editable 1601-point model",
    source:{kind:"embedded"},
    columns:[
      {id:"lorentz-omega",name:"Normalized driving frequency",unit:"ω/ω₀",role:"X",values:frequency},
      {id:"lorentz-real",name:"Re[χ(ω)]",role:"Y",values:re},
      {id:"lorentz-imag",name:"Im[χ(ω)]",role:"Y",values:im},
      {id:"lorentz-phase",name:"Phase lag φ(ω)",unit:"degrees",role:"Y",values:phase}
    ]
  };
}
export const defaultLorentzComposition: LorentzComposition = {
  kind:"lorentz-two-panel",
  topTitle:"(a) Complex Frequency Response of the Lorentz Oscillator",
  bottomTitle:"(b) Phase Lag Between Driving Electric Field and Electron Displacement",
  phaseYTitle:"Phase Lag, φ (degrees)",
  panelGap:52,phaseMin:0,phaseMax:195,phaseMajorTickStep:45,phaseMinorTickStep:15,markerRadius:6.5,referenceLineWidth:1.4,topMin:-3.9,topMax:7.8,
  resonanceX:1,bandStart:.92,bandEnd:1.07,bandColor:"#a44b3d",bandOpacity:.055,
  gridOpacity:.11,topLegendX:745,topLegendY:78,bottomLegendX:800,bottomLegendY:890,
  showReferenceLines:true,showResonanceMarkers:true,
  annotations:[
    {id:"absorption",panel:"top",x:220,y:102,text:"Absorption Peak (ω = ω₀)\nIm[χ] ∝ 1/γ",color:"#873c30",fontSizePt:9.5,background:"#ffffff",backgroundOpacity:.93,borderColor:"#c5c5c5",borderWidthPt:.5,arrowX:635,arrowY:107},
    {id:"normal",panel:"top",x:164,y:235,text:"Normal Dispersion\n(dn/dω > 0)",color:"#315b72",fontSizePt:9,background:"#ffffff",backgroundOpacity:.92,borderColor:"#c5c5c5",borderWidthPt:.5},
    {id:"anomalous",panel:"top",x:468,y:402,text:"Anomalous Dispersion\n(dn/dω < 0)",color:"#873c30",fontSizePt:9,background:"#ffffff",backgroundOpacity:.92,borderColor:"#c5c5c5",borderWidthPt:.5},
    {id:"in-phase",panel:"bottom",x:160,y:860,text:"ω ≪ ω₀ : φ → 0°\n(In-phase elastic tracking,\npure refractive n, zero loss)",color:"#315b72",fontSizePt:9,background:"#ffffff",backgroundOpacity:.92,borderColor:"#c5c5c5",borderWidthPt:.5},
    {id:"resonance",panel:"bottom",x:736,y:740,text:"Resonance Lag: 90°\n(Velocity in phase with E(t) → Max dissipation)",color:"#873c30",fontSizePt:9,background:"#ffffff",backgroundOpacity:.92,borderColor:"#c5c5c5",borderWidthPt:.5},
    {id:"out-phase",panel:"bottom",x:860,y:601,text:"ω ≫ ω₀ : φ → 180°\n(Out-of-phase inertial response,\nfree-carrier-like shielding)",color:"#69457c",fontSizePt:9,background:"#ffffff",backgroundOpacity:.92,borderColor:"#c5c5c5",borderWidthPt:.5}
  ]
};
export function createLorentzFigure(sheet:DataSheet,defaults:UserDefaults):FigureSpec{
  const ref=defaultDataRef(sheet);
  return {
    id:"figure-lorentz-golden",name:"Golden · Lorentz oscillator (a,b)",folderId:"folder-nature",
    dataRef:{...ref,yColumnIds:["lorentz-real","lorentz-imag","lorentz-phase"]},
    templateId:"xy-line",presetId:"nature",
    figureOverrides:{
      ...defaults.figureOverrides,
      figureWidthMm:183,figureHeightMm:155,aspectMode:"custom",
      fontFamily:"Times New Roman",fontSizePt:9.5,tickLabelSizePt:9.5,axisTitleSizePt:11,
      plotTitleSizePt:12,axisLineWidthPt:.7,majorTickLengthPt:4.5,minorTickLengthPt:2.3,
      frameStyle:"boxed",tickDirection:"inside",minorTicks:true,gridVisible:true,
      xTitle:"Normalized Driving Frequency, ω/ω₀",yTitle:"Susceptibility, χ(ω) (a.u.)",
      xAutoRange:false,xMin:.4,xMax:1.6,
      yAutoRange:false,yMin:-3.9,yMax:7.8,
      legendVisible:true,legendFrame:true,legendFontSizePt:9.5,legendBackground:"#ffffff",
      background:"#ffffff",marginLeftMm:13,marginRightMm:4,marginTopMm:6,marginBottomMm:10
    },
    seriesOverrides:{
      "lorentz-real":{color:"#305b76",lineWidthPt:1.35,legendLabel:"Re[χ(ω)] (Phase velocity / Dispersion ∼ n)"},
      "lorentz-imag":{color:"#a44b3d",lineWidthPt:1.35,legendLabel:"Im[χ(ω)] (Dissipation / Absorption ∼ κ)"},
      "lorentz-phase":{color:"#674080",lineWidthPt:1.35,legendLabel:"Phase lag φ(ω) = atan2(γω, 1−ω²)"}
    },
    seriesOrder:["lorentz-real","lorentz-imag","lorentz-phase"],
    lorentz:structuredClone(defaultLorentzComposition)
  };
}
