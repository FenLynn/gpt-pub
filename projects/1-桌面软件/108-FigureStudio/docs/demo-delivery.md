# Demo 与交付策略

## 1. 原则

FigureStudio 采用“Web first, desktop same frontend”。

第一版 Demo 不做两套 UI，也不使用以后必然丢弃的独立桌面原型。

```text
React / TypeScript / Vite
          │
          ├─ Browser
          │
          └─ Tauri
```

## 2. 最先给用户的 Demo

最先交付 **浏览器 Demo**。

它应该能够：

- 导入公开/本地数据；
- 新建 Figure；
- 切模板和 preset；
- 调常用属性；
- 实时看到结果；
- 导出 SVG / PNG；
- 保存/恢复一个演示项目。

### 为什么先浏览器

- 迭代 UI 最快；
- 不需要用户安装；
- 截图、交互、尺寸问题容易快速反馈；
- 与最终 Tauri 前端完全相同；
- 后续桌面端只补文件系统和原生能力。

## 3. Demo 的三种交付形式

### A. Web Preview

最佳评审形式。

构建为普通静态站点，可部署到 GitHub Pages 或其他静态托管。

优点：

- 点链接直接看；
- 最适合频繁评审 UI；
- 不需要下载安装。

当前 P108 阶段暂不自动建立部署 CI，待首个可交互原型出现后再单独评估。

### B. Local Web Build

Vite build 后得到：

```text
dist/
├─ index.html
└─ assets/
```

可以打 ZIP 提供。

对完全离线使用，应避免依赖 CDN，所有字体外的运行资源进入 bundle。

### C. Tauri Desktop

同一前端放入 Tauri：

```text
FigureStudio.exe
```

桌面版追加：

- .sfig 原生读写
- Linked Data
- 文件 watcher
- 自动 reload
- 原生 Open / Save As
- 批量导出
- 更完整的 Matplotlib publication renderer

## 4. 不推荐的方案

### 单独写一个纯 HTML Demo

除非只是一次性的静态视觉稿，否则不作为主路线。

原因：

- 很快与正式 React 代码分叉；
- 交互逻辑需要重写；
- 容易产生“Demo 看起来很好，正式版又重做”的浪费。

### 一开始只做客户端

也不推荐。

Tauri 壳、文件权限、打包、Windows smoke 会拖慢最重要的早期工作：UI 与绘图交互定型。

## 5. 实际开发顺序

```text
Phase A
React Web UI shell
→ XY renderer
→ Properties
→ Template / Preset

Phase B
Dataset / Figure project model
→ Save / Open
→ Replace Data
→ Undo / Redo

Phase C
Static Web Demo
→ 用户评审
→ UI / workflow 收束

Phase D
Tauri wrapper
→ .sfig
→ Linked Data
→ native export

Phase E
Matplotlib publication renderer
→ PDF / EPS / TIFF
```

## 6. Demo 数据

仓库 Demo 只使用公开安全的自生成数据：

- Gaussian-like spectrum
- damped oscillation
- linear power curve
- multi-series synthetic data

不得使用真实未公开实验数据。

## 7. 第一版 Demo 验收

用户第一次拿到 Demo 时，应能在 3 分钟内完成：

```text
打开
→ 看默认图
→ 导入/切换数据
→ 改线宽和 marker
→ 改轴标题
→ 输入 LaTeX
→ 切 Nature
→ 导出 SVG
```

如果这条路径不顺，优先修交互，不增加新图型。
