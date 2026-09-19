# P108｜FigureStudio

FigureStudio 是一个面向科研论文出图的模板驱动工作台。

> **Matplotlib 风格科研审美 + Origin 式项目/数据组织 + 现代 Web 交互**

## 当前状态

当前 `p108-exp` 已进入 **v0.3 Data Workspace** 阶段，GitHub Pages 是实时交互预览入口。

这一阶段先解决最根本的问题：数据不再是 Graph 的附属物，而是可独立打开、编辑、导入和链接的一等文档。

## 核心文档模型

```text
Project
├─ Folder
├─ DataBook
│  ├─ Sheet
│  └─ Sheet
└─ Graph
```

Graph 只通过稳定引用读取数据：

```text
Graph
└─ dataRef
   ├─ sheetId
   ├─ xColumnId
   ├─ yColumnIds[]
   ├─ yErrorColumnId?
   └─ zColumnId?
```

因此移动文件夹、重命名 DataBook / Sheet 或修改列角色，不会静默换掉已有 Graph 的数据。

## v0.3 数据工作区

- 左侧 Project Explorer 只负责组织项目对象；
- Folder / DataBook / Sheet / Graph 使用明显不同的矢量图标；
- DataBook 可以展开多个 Sheet；
- 中间使用文档 Tab，同时打开 Data Sheet 和 Graph；
- 打开 Sheet 时，中间是真正的 Spreadsheet；
- Sheet 支持直接编辑单元格、列名和单位；
- 支持新增行、列、Sheet，列拖拽排序和删除；
- 科研列角色：X / Y / Z / XErr / YErr / Label / None；
- 列头以 A(X)、B(Y)、C(YErr) 等形式显示；
- “按列角色新建图”将当前角色固化成稳定 Column ID 引用；
- Embedded Data 可编辑；
- Linked Data 默认只读；
- Web Linked Data 支持重新选择/加载源文件，以及“解除链接并编辑”；
- CSV / TSV / TXT 导入；
- 粘贴表格数据为新 Sheet；
- Graph 可以一键跳回其源 Sheet；
- `.sfig` 升级到 schema 0.3；
- 打开旧 schema 0.1 / 0.2 项目时自动迁移成 DataBook → Sheet。

## 绘图能力

已有绘图功能继续保留：

- Line / Scatter / Line + Marker / Errorbar；
- Spectrum / Offset Spectrum；
- Bar / Grouped / Stacked；
- Heatmap；
- Surface 3D；
- Scientific / Nature / Presentation；
- 曲线批量样式；
- 轴 / 图例属性；
- Publication Checker；
- SVG / PNG 600 dpi；
- Matplotlib Python script export。

## 桌面与出版基础层

`src-tauri/` 已建立 Tauri 2 shell，包含 Linked Data 文件读取、文件身份和 watcher backend。

`publication/figurestudio_renderer.py` 已建立 Matplotlib publication renderer，可输出 SVG / PDF / EPS / PNG / TIFF。

当前没有创建 Windows 安装包、stable、tag 或 Release；桌面层仍处于 exp 基础阶段。

## 技术路线

```text
DataBook / Sheet
       │
   stable column IDs
       │
     Graph
       │
   FigureSpec
      /   \
 Plotly   Matplotlib
 Web/UI   publication
```

## 分支

- 日常设计与开发：`p108-exp`
- 稳定候选：`p108-stable`（尚未创建）
- 正式主线：`main`

GitHub Pages 仅用于开发预览，不代表正式 Release。
