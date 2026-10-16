# P108｜FigureStudio

FigureStudio 是面向科研论文出图的模板驱动工作台。

> **Matplotlib 风格科研审美 + Origin 式项目/数据组织 + 现代 Web 交互**

## 当前状态

当前 `p108-exp` 已进入 **v0.5 图形输入状态** 阶段。

这一阶段优先解决 FigureStudio 的根本工作流：

```text
先组织数据
→ 在工作表中检查 / 编辑数据
→ 明确 X / Y / Error / Z
→ 创建图形
→ 图形保持稳定数据引用
→ 再做样式与出版输出
```

GitHub Pages 是当前交互验收入口。

## 项目模型

```text
项目
├─ 文件夹
├─ 数据簿
│  ├─ 工作表
│  └─ 工作表
└─ 图形
```

顶部文档只打开 **数据簿 / 图形**；工作表使用数据簿内部页签切换。

一个浏览器 Tab / Window 只持有一个 `.sfig` 项目。需要同时编辑多个项目时直接多开浏览器 Tab / Window，不在应用内部再造多项目管理器。

## 数据工作区

已实现：

- 浅彩色语义图标：文件夹浅黄、数据浅蓝、图形浅红；
- 数据簿内部多工作表页签；
- 工作表页签切换、双击重命名、拖拽排序；
- 工作表可跨数据簿移动，图形稳定引用不变；
- 单元格支持 number / text / null；
- 列名、单位、备注；
- X / Y / Z / XErr / YErr / Label / None 列角色；
- A(X) / B(Y) / C(YErr) 科研列头；
- 行 / 列 / 工作表新增；
- CSV / TSV / TXT 导入；
- 导入文件为当前数据簿的新工作表；
- 粘贴数据为新工作表；
- 复制工作表 / 复制结构；
- 工作表 → 依赖图形反查；
- 图形 → 源数据簿快速跳转；
- 图形右侧“数据”页显式设置工作表 / X / Y[] / Y 误差 / Z；
- 新建图默认采用 Origin 式 X 分段关系：一个 X 默认关联它右侧、下一个 X 之前的 Y；
- 已有图形只认稳定 `sheetId + columnId`，不会因改列角色而静默换数据；
- 被图形引用的列 / 工作表 / 数据簿禁止直接删除；
- Replace / Reload 若会破坏已有稳定引用则拒绝执行；
- Reload 保留用户设置的列角色、列备注和工作表备注。

## 项目内数据与链接数据

v0.4 将数据源身份放在 **工作表**，而不是数据簿。

```text
数据簿
├─ 原始数据     → 链接数据 / raw.csv
├─ 处理数据     → 项目内数据
└─ 汇总数据     → 项目内数据
```

因此一个数据簿可以同时容纳外部原始数据和项目内处理结果。

- 项目内数据：`.sfig` 是事实源，可编辑；
- 链接数据：外部文件是事实源，当前工作表默认只读；
- Web：重新选择文件完成 Reload；
- 链接工作表可以“创建可编辑副本”；
- 解除链接后当前缓存数据转为项目内数据；
- Tauri 后续使用 native path / identity / watcher 自动发现外部变化。

## .sfig

当前 schema：**0.5**。

兼容迁移：

```text
0.1 → 0.5
0.2 → 0.5
0.3 → 0.5
0.4 → 0.5
```

0.3 的 DataBook.source 会在读取时下沉到每个 Sheet.source。

## Lorentz Golden Reference｜普通图形编辑器验收

2026-10-16 在 `p108-exp` 加入可公开的解析 Lorentz oscillator 双面板示例：

- **入口**：`/p108/?golden=lorentz`，进入完整 FigureStudio 项目编辑器，不再另开独立绘图页面。
- **数据事实源**：`Synthetic Nature Gallery data` 中的 `Lorentz oscillator · editable 1601-point model` 工作表，包含归一化频率、实部、虚部、相位三列数据；可以打开工作表修改任一数值，曲线会按稳定列引用更新。
- **图形事实源**：`Golden · Lorentz oscillator (a,b)` 是正常 `FigureSpec`，以 `lorentz.kind=lorentz-two-panel` 保存上下图标题、面板间距、共振参考线、高亮区域、双图例位置、六个独立注释对象等。保留全部原有图形、曲线、坐标轴和图例属性页，额外提供「标注」页。
- **交互**：曲线可点击进入曲线属性；文字框可拖动，并在标注页精确输入 X/Y、文字、颜色、字号、背景、边框和箭头坐标；数据、样式与注释随 `.sfig` 保存、恢复和 Undo/Redo。
- **所见即所得**：使用实际工作表数据生成 1601 点矢量路径，图内 SVG 与 SVG/600 dpi PNG 导出共用同一 DOM。Python 单面板脚本导出对这张双面板样图暂时禁用，避免错误地把它输出为一张单图。
- **验收**：项目数据与 `.sfig` 往返测试、SVG 实部/虚部/相位路径和注释测试、真实 Chromium 中的普通编辑器与标注属性页检查。不得用独立页面截图替代验收。

此样图是 **Golden Reference 的可编辑初版**，尚不等同于通用任意多面板编辑器；字体公式仍以 Unicode/serif 文字为主，复杂 LaTeX 与 SVG/PDF 跨端字体一致性需要后续单独验证。

## 绘图与出版

已有能力继续保留：

- Line / Scatter / Line + Marker / Errorbar；
- Spectrum / Offset Spectrum / Waterfall / 双 Y；
- Bar / Grouped / Stacked，并支持柱状图数值标签；
- Heatmap / Contour / Surface 3D；
- Scientific / Nature / Presentation；
- Matplotlib tab10 风格科研默认、向外 Tick、模板感知的自动图例；
- 图例支持图内六位置、自由拖动与“图外右侧”出版布局；
- 标题、轴标题、图例、色条支持本地 MathJax / LaTeX，不依赖 CDN；
- 双 Y 左右轴标题与刻度可随对应数据颜色区分；
- 场图实际行坐标、色图 / Z 范围 / Colorbar / Contour levels；
- 曲线批量样式；
- 轴 / 图例属性；
- Publication Checker；
- SVG / PNG 600 dpi；
- Matplotlib Python script export，并与 GUI 主要默认样式保持一致；
- Tauri + Matplotlib publication renderer 基础层。

## 本轮明确延后

为了不让数据工作区再次变成“大而乱”的 Origin：

- 公式列 / F(x) / 自动重算；
- XLSX 多工作表导入；
- 大数据虚拟表格；
- 块选择与增强型复制粘贴；
- 项目搜索 / hover preview；
- 单个 Graph 跨多个 Sheet 的复杂 Plot Setup；
- Data | Graph 左右分屏；
- multi-panel Figure composition。

这些以后继续做，但不会再改变“数据簿 → 工作表 → 稳定列引用 → 图形”这条核心关系。

## 分支

- 日常开发：`p108-exp`
- 稳定候选：`p108-stable`（尚未创建）
- 正式主线：`main`

GitHub Pages 仅用于开发预览，不代表正式 Release。

## 图形输入状态

Figure 文档与数据绑定正式分离。左侧项目树可以直接“新建空图”；工作表里的“按列角色新建图”继续作为已绑定数据的快捷入口。

输入状态固定为：`empty / incomplete / ready / broken`，界面对应“空图 / 待完成 / 可绘制 / 引用失效”。

- 空图：没有 `dataRef`，仍可设置图型、尺寸、样式和轴；
- 待完成：已选择工作表，但当前模板所需主数据不足；
- 可绘制：模板输入满足且稳定引用可解析；
- 引用失效：原工作表或 Column ID 已无法解析，不做静默 fallback。

当前 XY / Bar / Field / 3D 模板均允许 X 留空；无显式 X 时使用 `1, 2, 3, ...` 行号。工作表快捷建图只要求至少一列主数据 Y。


## Matplotlib Gallery 视觉基准

P108 当前把 Matplotlib 官方 Gallery 作为科研单图的主要视觉参考之一，但不机械复制 API。重点对齐的是出版语义：稳定色循环、合理线宽 / marker、向外 Tick、克制网格、按需要显示图例、Errorbar / Bar / Field / 3D 的典型表达。

新建项目中增加“常用图验收”文件夹，内置 Scatter、Errorbar、Bar、Grouped Bar、Stacked Bar 的可点击 QA 示例。该文件夹用于开发和交互验收，不改变 .sfig schema 0.5。

## 精细 SVG 画布实验（p108-exp）

本阶段新增纯浏览器原生 SVG 精细画布，不依赖 CDN、Python 或新 npm 绘图库。它消费与 Plotly 相同的 `FigureSpec`、`buildTraces()` 和 `buildLayout()`，不另建样式事实源；显示的 SVG 节点即 SVG 导出事实源，PNG 由同一 SVG 栅格化生成。

- 当前覆盖：XY 折线、散点、线加点、误差棒、光谱、偏移光谱、瀑布、双 Y 轴共 8 类。
- 原有 14 种图型、全部右侧数据/曲线/轴/图例/出版检查器数值控件、项目保存、撤销与 Python 脚本导出全部保留；Web 工具栏可切换 **精细 SVG / Plotly 兼容**。
- 栅格场图、Contour、3D Surface、Bar 类、分类 X 或含复杂 LaTeX 内容的图仍自动使用原 Plotly；不伪称 SVG 等效支持。
- 新增可独立编辑、重置及设为默认的出版几何值：轴框开口/四边框、轴线宽（pt）、主/次刻度长度（pt）、轴/图标题间距（pt）、四侧留白（mm）；也传递给原 Plotly 布局。
- 实测曲线默认按原采样点直连，使用 SVG `round` cap/join 提高边缘精细度；不自动使用插值平滑改变谱峰信息。
- 当前限制：精细 SVG 支持直接拖动图例并保存自由 X/Y 位置；暂未复制 Plotly 的滚轮缩放和完整 MathJax 布局；需要这些交互时切换 **Plotly 兼容**，已有位置、数字、数据和样式不会丢失。正式接管画布前需完成功能、图像、性能和浏览器回归测试。
- .sfig 文件保持 schema 0.5，新配置均为可选 `figureOverrides`；自动兼容旧数据。
- GitHub Pages 仍是开发预览入口而非 Release；构建通过不等于浏览器实机与站点实际可访问性已经验收。

## Nature 风格视觉样本（14 张）

新增 `Nature Gallery · 14 samples` 项目文件夹与 [详细样本矩阵](docs/nature-gallery.md)。全部 X/Y 轴标题使用英文，11 张二维图使用原生 SVG，3 张场图/柱图保留 Plotly 兼容画布。

专用预览入口：`https://fenlynn.github.io/gpt-pub/p108/?gallery=1`，直接显示 N01 光谱。普通 `/p108/` 仍保持数据表优先的项目工作流；点击“新建项目”可创建这组全新合成数据样本，已导入的用户项目不会被隐式更改。

Nature 单栏 89 mm、双栏 183 mm，默认字高约 6.5 pt，线宽约 0.58–0.82 pt。画布宽、高都支持独立 mm 输入、重置与项目持久化；轴线、刻度长度、标题间距和留白继续支持数值调整。所有示例数据由可复现公式生成，不是实测数据。

CI 运行 `npm run test:gallery` 做 14 张图的 FigureSpec 和 SVG 结构回归。**构建通过不是 Nature 投稿验收**，浏览器字体、图例交互与打印输出仍需要实机检查。
