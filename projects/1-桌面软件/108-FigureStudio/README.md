# P108｜FigureStudio

FigureStudio 是一个面向科研论文出图的模板驱动绘图工作台。

定位：

> **Matplotlib 风格的科研审美 + Origin 式项目组织 + 现代 Web 交互**

目标不是复制 Origin 的全部分析功能，而是让：

```text
Data → Beautiful Figure
```

同时保留：

```text
Project → Dataset → Figure → Dependency → Update
```

## v0.1 当前状态

Web v0.1 已经形成完整可评审闭环：

- 单视口、无页面级纵向滚动；
- 中央 Figure 自动最大化；
- 16:9 / 4:3 / 3:2 / custom；
- 多 Dataset / 多 Figure；
- 一个 Dataset 可被多 Figure 共享；
- CSV / TSV / TXT / Clipboard；
- Replace Data；
- Undo / Redo；
- autosave recovery；
- `.sfig` 保存 / 打开；
- Scientific / Nature / Presentation；
- 用户默认 / 项目默认；
- Line / Scatter / Line+Marker / Errorbar；
- Spectrum / Offset Spectrum；
- Bar / Grouped / Stacked；
- Heatmap；
- 3D Surface；
- 紧凑属性检查器；
- SVG / PNG 600 dpi；
- 预览与导出使用同一 Plotly Figure。

## 技术路线

```text
React + TypeScript + Vite
        │
        ├─ PlotSpec / FigureSpec
        │
        ├─ Plotly.js interactive renderer
        │
        └─ .sfig project container
```

后续 Publication/Desktop 阶段：

```text
同一前端
  └─ Tauri
      ├─ Linked Data
      ├─ file watcher
      └─ Matplotlib publication renderer
          ├─ PDF
          ├─ EPS
          └─ TIFF
```

## 分支

```text
日常设计与开发：p108-exp
稳定候选：      p108-stable（尚未创建）
正式主线：      main
```

GitHub Pages 仅作为开发预览，不代表正式 Release。
