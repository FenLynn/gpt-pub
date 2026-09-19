# Dataset / PlotSpec / Template / Export Draft

## Dataset

Dataset 最小语义：id、name、source、columns、metadata。

Column 至少包含 id、name、type、unit、role。典型 role：X / Y / Z / Error / Category / Label。

## Figure 引用与 Transform

Figure 通过 datasetId 与 columnId 引用数据。Project Tree 中移动对象不得破坏引用。

offset、scale、normalize、crop、sort、baseline subtract、log 等显示处理保存为可追溯 Transform，不覆盖 raw Dataset。

## PlotSpec

PlotSpec 只保存长期语义，不暴露 Plotly 专属字段。主要包含物理尺寸、panels、axes、series、annotations、legend 和 style references。

## Template

首批候选：XY Line、XY Scatter、Line+Marker、Errorbar、Spectrum、Multi Spectrum、Offset Spectrum、Simple/Grouped/Stacked Bar、Heatmap、Surface 3D。

## Preset

首批候选：Nature、Scientific、Optica、Presentation、Dark。

## 字体与数学

主要字体为 Arial 与 Times New Roman。复杂数学表达式走 LaTeX/MathJax/Matplotlib mathtext；简单 λ μ Δ ± × 优先 Unicode。

## 颜色

默认 palette 应自然、克制、色盲友好。二维连续色图优先 viridis、cividis、magma、inferno、coolwarm、gray，不默认推荐 rainbow / jet。

## 导出

计划支持 SVG、PDF、EPS、PNG、TIFF。内部尺寸使用 mm / pt；raster 才使用 dpi，常用 300 / 600 / 1200 dpi。

交互预览优先 Plotly；后续 publication renderer 允许 Matplotlib 直接生成出版文件。Heatmap / 3D 的矢量导出允许“文字与轴矢量 + 数据层 rasterized”的混合策略，并在 UI 明确提示。