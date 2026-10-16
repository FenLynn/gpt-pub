import type { LorentzAnnotation, LorentzComposition } from "../model";
import { defaultLorentzComposition } from "../data/lorentz";
type Props={value:LorentzComposition|undefined;selectedId:string;onSelect:(id:string)=>void;onChange:(value:LorentzComposition)=>void};
export function LorentzInspector({value,selectedId,onSelect,onChange}:Props){
 const c=value??defaultLorentzComposition;
 const patch=(data:Partial<LorentzComposition>)=>onChange({...c,...data});
 const active=c.annotations.find(a=>a.id===selectedId)??c.annotations[0];
 const patchAnnotation=(data:Partial<LorentzAnnotation>)=>{
   if(!active)return;patch({annotations:c.annotations.map(a=>a.id===active.id?{...a,...data}:a)});
 };
 const number=(label:string,key:keyof LorentzComposition,step=.1)=><div className="prop-row" key={key}><label>{label}</label><input type="number" step={step} value={c[key] as number} onChange={e=>patch({[key]:Number(e.target.value)})}/></div>;
 const text=(label:string,key:keyof LorentzComposition)=><div className="prop-row" key={key}><label>{label}</label><textarea rows={2} style={{minWidth:0,width:"100%",resize:"vertical"}} value={c[key] as string} onChange={e=>patch({[key]:e.target.value})}/></div>;
 const color=(label:string,key:keyof LorentzComposition)=><div className="prop-row" key={key}><label>{label}</label><input type="color" value={c[key] as string} onChange={e=>patch({[key]:e.target.value})}/></div>;
 const bool=(label:string,key:keyof LorentzComposition)=><div className="prop-row" key={key}><label>{label}</label><input type="checkbox" checked={c[key] as boolean} onChange={e=>patch({[key]:e.target.checked})}/></div>;
 const annNum=(label:string,key:keyof LorentzAnnotation,step=.5)=><div className="prop-row" key={key}><label>{label}</label><input type="number" step={step} value={(active?.[key] as number|undefined)??""} onChange={e=>patchAnnotation({[key]:e.target.value===""?undefined:Number(e.target.value)})}/></div>;
 const annColor=(label:string,key:keyof LorentzAnnotation)=><div className="prop-row" key={key}><label>{label}</label><input type="color" value={(active?.[key] as string|undefined)??"#ffffff"} onChange={e=>patchAnnotation({[key]:e.target.value})}/></div>;
 return <section className="inspector-pane" data-testid="lorentz-inspector">
  <div className="pane-heading"><strong>双面板 · 精细标注</strong><span>普通图形文档</span></div>
  <p style={{fontSize:12,lineHeight:1.5,color:"#666"}}>曲线源自数据簿的可编辑工作表；曲线颜色与线宽请到“曲线”页修改，字体、刻度与尺寸请到“图形 / 坐标轴”页修改。此处控制双面板和每一个注释对象。</p>
  <div className="section-divider">双面板标题与坐标</div>
  {text("上图标题","topTitle")}
  {text("下图标题","bottomTitle")}
  {text("下图 Y 轴","phaseYTitle")}
  {number("面板间距","panelGap",1)}
  {number("下图 Y 最小","phaseMin",5)}
  {number("下图 Y 最大","phaseMax",5)}
  {number("下图主刻度间隔","phaseMajorTickStep",5)}
  {number("下图次刻度间隔","phaseMinorTickStep",5)}
  {number("共振点半径","markerRadius",.5)}
  {number("参考线宽度","referenceLineWidth",.1)}
  {number("共振位置","resonanceX",.01)}
  {bool("共振虚线","showReferenceLines")}
  {bool("共振标记","showResonanceMarkers")}
  <div className="section-divider">半透明高亮 / 网格</div>
  {number("高亮起点","bandStart",.01)}
  {number("高亮终点","bandEnd",.01)}
  {number("高亮透明度","bandOpacity",.01)}
  {color("高亮颜色","bandColor")}
  {number("网格透明度","gridOpacity",.01)}
  <div className="section-divider">上下图例位置 · SVG 坐标</div>
  {number("上图图例 X","topLegendX",1)}
  {number("上图图例 Y","topLegendY",1)}
  {number("下图图例 X","bottomLegendX",1)}
  {number("下图图例 Y","bottomLegendY",1)}
  <div className="section-divider">独立注释对象</div>
  <div className="prop-row"><label>选中注释</label><select value={active?.id??""} onChange={e=>onSelect(e.target.value)}>{c.annotations.map(a=><option key={a.id} value={a.id}>{a.id}</option>)}</select></div>
  <div style={{display:"flex",gap:5,marginBottom:10}}>
   <button type="button" onClick={()=>{const id="note-"+Date.now();patch({annotations:[...c.annotations,{id,panel:"top",x:260,y:200,text:"New annotation",color:"#333333",fontSizePt:9,background:"#ffffff",backgroundOpacity:.92,borderColor:"#bbbbbb",borderWidthPt:.5}]});onSelect(id)}}>＋ 新增</button>
   <button type="button" disabled={!active} onClick={()=>{if(!active)return;patch({annotations:c.annotations.filter(a=>a.id!==active.id)});onSelect(c.annotations.find(a=>a.id!==active.id)?.id??"")}}>删除</button>
  </div>
  {active&&<>
   <div className="prop-row"><label>文字内容</label><textarea rows={3} style={{width:"100%",resize:"vertical"}} value={active.text} onChange={e=>patchAnnotation({text:e.target.value})}/></div>
   <div className="prop-row"><label>面板</label><select value={active.panel} onChange={e=>{const next=e.target.value as "top"|"bottom";patchAnnotation({panel:next,y:active.y+(next===active.panel?0:next==="bottom"?468:-468)})}}><option value="top">上图</option><option value="bottom">下图</option></select></div>
   <div className="prop-row"><label>显示</label><input type="checkbox" checked={active.visible!==false} onChange={e=>patchAnnotation({visible:e.target.checked})}/></div>
   {annNum("位置 X","x",1)}
   {annNum("位置 Y","y",1)}
   {annNum("字号 pt","fontSizePt",.5)}
   {annColor("文字颜色","color")}
   {annColor("背景颜色","background")}
   {annNum("背景透明度","backgroundOpacity",.05)}
   {annColor("边框颜色","borderColor")}
   {annNum("边框宽度 pt","borderWidthPt",.1)}
   {annNum("箭头终点 X","arrowX",1)}
   {annNum("箭头终点 Y","arrowY",1)}
  </>}
  <p style={{fontSize:11,color:"#777"}}>可以直接拖动图中的文字框，拖动完成后坐标会保存到 .sfig，并随 SVG/PNG 一同导出。</p>
 </section>;
}
