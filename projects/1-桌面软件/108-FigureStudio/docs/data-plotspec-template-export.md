# Dataset / PlotSpec / Template / Export v0.1

## Dataset

Dataset 当前包含：

```text
id
name
x
ys[]
metadata
```

Column 包含：

```text
id
name
unit
values
```

二维场可额外通过 metadata 保存 rowCoordinates / rowAxisName / rowAxisUnit。

## Figure / PlotSpec

Figure 是长期可编辑对象，不是导出的图片：

```text
Figure
├─ id / name
├─ datasetId
├─ templateId
├─ presetId
├─ figureOverrides
├─ seriesOverrides
└─ seriesOrder
```

Renderer 把同一 FigureSpec 映射为 Plotly traces/layout。

UI 不直接把 Plotly 私有结构保存为项目事实。

## Template

v0.1 已实现：

### XY

- 折线
- 散点
- 点线
- 误差棒
- 光谱
- 堆叠光谱

### Bar

- 单柱状图
- 分组柱状图
- 堆叠柱状图

### Field

- Heatmap / beam-like intensity map

### 3D

- Surface 3D

Offset Spectrum 的 offset 只在渲染时作用，不修改 raw Dataset。

## Preset

v0.1：

- Scientific
- Nature
- Presentation

并支持：

```text
Factory
→ User Default
→ Project Default
→ Preset
→ Figure override
→ Series override
```

用户临时修改默认只落在当前 Figure / Series；只有明确点击“项目默认”或“我的默认”才提升作用域。

## 轴与图例

v0.1 支持：

- X / Y title
- linear / log
- auto / manual range
- inward / outward ticks
- minor ticks
- grid
- legend show/hide
- legend position
- horizontal / vertical
- columns
- frame

## 样式

Series：

- visible
- line visible
- line style
- line width
- marker symbol
- marker size
- color
- opacity
- layer order

Field：

- Viridis
- Cividis
- Magma
- Inferno
- RdBu
- Greys
- reverse colorscale

## Export

Web v0.1：

- SVG
- PNG 600 dpi

核心规则：

> 预览只对固定出版画布做 CSS 缩放；导出直接从同一 Plotly DOM / layout 生成。

因此预览与导出共享：

- 坐标范围
- trace order
- opacity
- legend
- margins
- font
- line width
- marker
- aspect ratio

PDF / EPS / TIFF 留给后续 Matplotlib publication renderer，不用另一套“重新布局”的 Web 导出逻辑冒充出版 renderer。
