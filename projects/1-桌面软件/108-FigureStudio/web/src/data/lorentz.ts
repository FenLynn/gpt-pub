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
  topTitle:"(a) Complex frequency response of a Lorentz oscillator",
  bottomTitle:"(b) Phase lag between the driving field and displacement",
  phaseYTitle:"Phase lag, φ (degrees)",
  panelGap:62,plotLeft:104,plotRight:1160,plotTop:65,plotBottom:932,titleWeight:600,
  topLegendWidth:298,bottomLegendWidth:270,legendRowHeight:25,bandLegendLabel:"Resonant band",
  phaseMin:0,phaseMax:195,phaseMajorTickStep:45,phaseMinorTickStep:15,
  markerRadius:5.2,referenceLineWidth:1.1,topMin:-3.9,topMax:7.8,
  resonanceX:1,bandStart:.92,bandEnd:1.07,bandColor:"#ae5a4d",bandOpacity:.045,
  gridOpacity:.085,topLegendX:857,topLegendY:96,bottomLegendX:884,bottomLegendY:894,
  showReferenceLines:true,showResonanceMarkers:true,
  annotations:[
    {id:"absorption",panel:"top",x:215,y:140,
      text:"Absorption maximum\nω = ω₀,  Im χ ∝ 1/γ",
      color:"#89463b",fontSizePt:9,background:"#ffffff",backgroundOpacity:.88,
      borderColor:"#d8dde0",borderWidthPt:.3,maxWidth:275,arrowX:632,arrowY:106},
    {id:"normal",panel:"top",x:170,y:235,
      text:"Normal dispersion\n(dn/dω > 0)",
      color:"#315b72",fontSizePt:8.8,background:"#ffffff",backgroundOpacity:.84,
      borderColor:"#d8dde0",borderWidthPt:.3,maxWidth:240},
    {id:"anomalous",panel:"top",x:495,y:410,
      text:"Anomalous dispersion\n(dn/dω < 0)",
      color:"#89463b",fontSizePt:8.8,background:"#ffffff",backgroundOpacity:.84,
      borderColor:"#d8dde0",borderWidthPt:.3,maxWidth:240},
    {id:"in-phase",panel:"bottom",x:165,y:634,
      text:"Low frequency  (ω ≪ ω₀)\nφ → 0° · in-phase response",
      color:"#315b72",fontSizePt:8.8,background:"#ffffff",backgroundOpacity:.88,
      borderColor:"#d8dde0",borderWidthPt:.3,maxWidth:300},
    {id:"resonance",panel:"bottom",x:765,y:812,
      text:"At resonance  (ω = ω₀)\nφ = 90° · maximum dissipation",
      color:"#89463b",fontSizePt:8.8,background:"#ffffff",backgroundOpacity:.88,
      borderColor:"#d8dde0",borderWidthPt:.3,maxWidth:340},
    {id:"out-phase",panel:"bottom",x:875,y:626,
      text:"High frequency  (ω ≫ ω₀)\nφ → 180° · inertial response",
      color:"#694b7c",fontSizePt:8.8,background:"#ffffff",backgroundOpacity:.88,
      borderColor:"#d8dde0",borderWidthPt:.3,maxWidth:275}
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
      plotTitleSizePt:11,axisLineWidthPt:.6,majorTickLengthPt:4.5,minorTickLengthPt:2.3,
      frameStyle:"boxed",tickDirection:"inside",minorTicks:true,gridVisible:true,
      xTitle:"Normalized Driving Frequency, ω/ω₀",yTitle:"Susceptibility, χ(ω) (a.u.)",
      xAutoRange:false,xMin:.4,xMax:1.6,
      yAutoRange:false,yMin:-3.9,yMax:7.8,
      legendVisible:true,legendFrame:true,legendFontSizePt:9,legendBackground:"#ffffff",
      background:"#ffffff",marginLeftMm:13,marginRightMm:4,marginTopMm:6,marginBottomMm:10
    },
    seriesOverrides:{
      "lorentz-real":{color:"#305b76",lineWidthPt:1.2,legendLabel:"Re χ(ω)   Dispersion"},
      "lorentz-imag":{color:"#a44b3d",lineWidthPt:1.2,legendLabel:"Im χ(ω)   Absorption"},
      "lorentz-phase":{color:"#674080",lineWidthPt:1.2,legendLabel:"Phase lag  φ(ω)"}
    },
    seriesOrder:["lorentz-real","lorentz-imag","lorentz-phase"],
    lorentz:structuredClone(defaultLorentzComposition)
  };
}
