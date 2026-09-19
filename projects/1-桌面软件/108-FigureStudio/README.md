# P108｜FigureStudio

FigureStudio 是一个面向科研论文出图的模板驱动工作台。

> **Matplotlib 风格科研审美 + Origin 式项目组织 + 现代 Web 交互**

## 当前状态

当前 `p108-exp` 已进入 v0.2 工作台阶段，GitHub Pages 是实时交互预览入口。

核心能力：

- 单视口工作台，页面本身不纵向滚动；
- 中央科研画布最大化显示；
- 16:9 / 4:3 / 3:2 / custom；
- UI Scale 90%–140%，默认 110%，不改变论文图物理尺寸；
- Project Explorer 文件夹、拖拽、重命名、复制、删除、缩略图；
- 多 Dataset / 多 Figure / stable ID 引用；
- CSV / TSV / TXT / Clipboard；
- Replace Data + 旧/新数据差异预览；
- Undo / Redo / autosave recovery；
- `.sfig` schema 0.2，并兼容迁移 v0.1；
- Scientific / Nature / Presentation；
- Line / Scatter / Marker / Errorbar / Spectrum / Offset；
- Bar / Grouped / Stacked / Heatmap / Surface 3D；
- 曲线多选、批量样式、拖拽图层；
- 轴 / 图例紧凑属性面板；
- Publication Checker；
- SVG / PNG 600 dpi；
- Matplotlib Python script export。

## 桌面与出版基础层

`src-tauri/` 已建立 Tauri 2 shell，包含 Linked Data 文件读取、文件身份和 watcher backend。

`publication/figurestudio_renderer.py` 已建立 Matplotlib publication renderer，可输出 SVG / PDF / EPS / PNG / TIFF。

当前没有创建 Windows 安装包、stable、tag 或 Release；桌面层仍处于 exp 基础阶段。

## 技术路线

    Dataset / FigureSpec / Preset
              │
       ┌──────┴──────┐
       │             │
    Plotly        Matplotlib
       │             │
    Web/Tauri    publication

## 分支

- 日常设计与开发：`p108-exp`
- 稳定候选：`p108-stable`（尚未创建）
- 正式主线：`main`

GitHub Pages 仅用于开发预览，不代表正式 Release。