import type { LorentzAnnotation, LorentzComposition } from "../model";
import { defaultLorentzComposition } from "../data/lorentz";

type Props={
  value:LorentzComposition|undefined;
  selectedId:string;
  onSelect:(id:string)=>void;
  onChange:(value:LorentzComposition)=>void;
};

/** All golden-reference values live in the regular FigureSpec, not in a second UI model. */
export function LorentzInspector({value,selectedId,onSelect,onChange}:Props){
  const c=value??defaultLorentzComposition;
  const patch=(data:Partial<LorentzComposition>)=>onChange({...c,...data});
  const active=c.annotations.find(a=>a.id===selectedId)??c.annotations[0];
  const patchAnnotation=(data:Partial<LorentzAnnotation>)=>{
    if(!active)return;
    patch({annotations:c.annotations.map(a=>a.id===active.id?{...a,...data}:a)});
  };
  const number=(label:string,key:keyof LorentzComposition,step=.1)=><div className="prop-row" key={key}>
    <label htmlFor={"lorentz-"+key}>{label}</label>
    <input id={"lorentz-"+key} type="number" step={step} value={(c[key] as number|undefined)??""}
      onChange={e=>{if(e.target.value!=="")patch({[key]:Number(e.target.value)})}}/>
  </div>;
  const text=(label:string,key:keyof LorentzComposition)=><div className="prop-row lorentz-text-row" key={key}>
    <label htmlFor={"lorentz-"+key}>{label}</label>
    <textarea id={"lorentz-"+key} rows={2} value={(c[key] as string|undefined)??""}
      onChange={e=>patch({[key]:e.target.value})}/>
  </div>;
  const color=(label:string,key:keyof LorentzComposition)=><div className="prop-row" key={key}>
    <label htmlFor={"lorentz-"+key}>{label}</label>
    <input id={"lorentz-"+key} type="color" value={c[key] as string}
      onChange={e=>patch({[key]:e.target.value})}/>
  </div>;
  const bool=(label:string,key:keyof LorentzComposition)=><div className="prop-row" key={key}>
    <label htmlFor={"lorentz-"+key}>{label}</label>
    <input id={"lorentz-"+key} type="checkbox" checked={c[key] as boolean}
      onChange={e=>patch({[key]:e.target.checked})}/>
  </div>;
  const annNum=(label:string,key:keyof LorentzAnnotation,step=.5)=><div className="prop-row" key={key}>
    <label htmlFor={"lorentz-note-"+key}>{label}</label>
    <input id={"lorentz-note-"+key} type="number" step={step} value={(active?.[key] as number|undefined)??""}
      onChange={e=>patchAnnotation({[key]:e.target.value===""?undefined:Number(e.target.value)})}/>
  </div>;
  const annColor=(label:string,key:keyof LorentzAnnotation)=><div className="prop-row" key={key}>
    <label htmlFor={"lorentz-note-"+key}>{label}</label>
    <input id={"lorentz-note-"+key} type="color" value={(active?.[key] as string|undefined)??"#ffffff"}
      onChange={e=>patchAnnotation({[key]:e.target.value})}/>
  </div>;
  const delta=((c.plotBottom??932)-(c.plotTop??65)+(c.panelGap??62))/2;
  return <section className="inspector-pane lorentz-inspector" data-testid="lorentz-inspector">
    <div className="pane-heading"><strong>双面板 · 对象属性</strong><span>SVG 实时预览</span></div>
    <p className="lorentz-hint">直接拖动图中文字框。数据在工作表编辑；曲线、坐标轴、字体与图例仍使用顶部对应属性页。</p>

    <details className="lorentz-group" open>
      <summary>文字标注 <span>{c.annotations.length} 个独立对象</span></summary>
      <div className="lorentz-group-body">
        <div className="prop-row">
          <label htmlFor="lorentz-active-note">当前对象</label>
          <select id="lorentz-active-note" value={active?.id??""} onChange={e=>onSelect(e.target.value)}>
            {c.annotations.map(a=><option key={a.id} value={a.id}>{a.text.split("\n")[0]||a.id}</option>)}
          </select>
        </div>
        <div className="lorentz-actions">
          <button type="button" onClick={()=>{
            const id="note-"+Date.now();
            patch({annotations:[...c.annotations,{
              id,panel:"top",x:260,y:205,text:"New annotation",
              color:"#3c4b59",fontSizePt:9,maxWidth:280,
              background:"#ffffff",backgroundOpacity:.88,
              borderColor:"#d8dde0",borderWidthPt:.3
            }]});
            onSelect(id);
          }}>＋ 新增标注</button>
          <button type="button" disabled={!active} onClick={()=>{
            if(!active)return;
            patch({annotations:c.annotations.filter(a=>a.id!==active.id)});
            onSelect(c.annotations.find(a=>a.id!==active.id)?.id??"");
          }}>删除选中</button>
        </div>
        {active&&<>
          <div className="prop-row lorentz-text-row">
            <label htmlFor="lorentz-note-text">文字内容（支持换行）</label>
            <textarea id="lorentz-note-text" rows={3} value={active.text}
              onChange={e=>patchAnnotation({text:e.target.value})}/>
          </div>
          <div className="prop-row">
            <label htmlFor="lorentz-note-panel">所属面板</label>
            <select id="lorentz-note-panel" value={active.panel}
              onChange={e=>{
                const next=e.target.value as "top"|"bottom";
                patchAnnotation({panel:next,y:active.y+(next===active.panel?0:next==="bottom"?delta:-delta)});
              }}>
              <option value="top">上图</option><option value="bottom">下图</option>
            </select>
          </div>
          <div className="prop-row"><label htmlFor="lorentz-note-visible">显示标注</label>
            <input id="lorentz-note-visible" type="checkbox" checked={active.visible!==false}
              onChange={e=>patchAnnotation({visible:e.target.checked})}/></div>
          {annNum("横向位置 X","x",1)}
          {annNum("纵向位置 Y","y",1)}
          {annNum("字体大小 (pt)","fontSizePt",.2)}
          {annNum("自动换行宽度","maxWidth",5)}
          {annColor("文字颜色","color")}
          {annColor("背景颜色","background")}
          {annNum("背景不透明度","backgroundOpacity",.05)}
          {annColor("边框颜色","borderColor")}
          {annNum("边框宽度 (pt)","borderWidthPt",.1)}
          {annNum("箭头目标 X","arrowX",1)}
          {annNum("箭头目标 Y","arrowY",1)}
        </>}
      </div>
    </details>

    <details className="lorentz-group">
      <summary>画布与双面板布局 <span>尺寸 / 标题 / 边距</span></summary>
      <div className="lorentz-group-body">
        {text("上图标题","topTitle")}
        {text("下图标题","bottomTitle")}
        {text("下图 Y 轴标题","phaseYTitle")}
        {number("标题字重","titleWeight",100)}
        {number("面板间距","panelGap",1)}
        {number("绘图区左边界","plotLeft",1)}
        {number("绘图区右边界","plotRight",1)}
        {number("绘图区上边界","plotTop",1)}
        {number("绘图区下边界","plotBottom",1)}
        {number("下图 Y 最小值","phaseMin",5)}
        {number("下图 Y 最大值","phaseMax",5)}
        {number("下图主刻度间隔","phaseMajorTickStep",5)}
        {number("下图次刻度间隔","phaseMinorTickStep",5)}
      </div>
    </details>

    <details className="lorentz-group">
      <summary>共振与高亮 <span>标记 / 参考线 / 网格</span></summary>
      <div className="lorentz-group-body">
        {number("共振频率","resonanceX",.01)}
        {number("共振标记半径","markerRadius",.2)}
        {number("参考线宽度","referenceLineWidth",.1)}
        {bool("显示共振虚线","showReferenceLines")}
        {bool("显示共振标记","showResonanceMarkers")}
        {number("高亮频率起点","bandStart",.01)}
        {number("高亮频率终点","bandEnd",.01)}
        {number("高亮不透明度","bandOpacity",.01)}
        {color("高亮填充颜色","bandColor")}
        {number("网格不透明度","gridOpacity",.01)}
      </div>
    </details>

    <details className="lorentz-group">
      <summary>上下图例 <span>位置 / 宽度 / 行距</span></summary>
      <div className="lorentz-group-body">
        <p className="lorentz-hint">文字与线段样式在“图例”和“曲线”属性页调整；这里控制双图例的独立布局。</p>
        {number("上图图例 X","topLegendX",1)}
        {number("上图图例 Y","topLegendY",1)}
        {number("上图图例宽度","topLegendWidth",5)}
        {number("下图图例 X","bottomLegendX",1)}
        {number("下图图例 Y","bottomLegendY",1)}
        {number("下图图例宽度","bottomLegendWidth",5)}
        {number("图例行高","legendRowHeight",1)}
        {text("高亮区域图例文字","bandLegendLabel")}
      </div>
    </details>
  </section>;
}
