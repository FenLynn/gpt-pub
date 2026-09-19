# P108｜FigureStudio

FigureStudio（工作名：Scientific Figure Studio）是一个面向科研论文出图的模板驱动绘图工具。

目标不是复制 Origin 的全部功能，而是把 **Matplotlib 风格的科研审美、Origin 式项目组织、现代 Web 交互和 Web/Tauri 双端运行**组合起来，重点解决“数据进去，快速得到统一、紧凑、可复现、可投稿的论文图”。

## 当前阶段

当前进入 **v0.1 Web 交互原型阶段**。

第一阶段优先验证：

- Project / Dataset / Figure / PlotSpec 核心边界；
- 默认科研审美是否成立；
- 三栏式项目 / Figure / Properties 工作流；
- Template 与 Preset 分离；
- 设置继承与局部 override；
- mm / pt / dpi 物理单位体系；
- Plotly 交互预览与未来 Matplotlib publication renderer 的边界；
- GitHub Pages 快速评审。

## 当前 Web Demo 能力

- 程序生成的公开安全合成光谱数据；
- CSV / TSV / TXT 导入；
- XY 多曲线；
- Scientific / Nature / Presentation preset；
- Arial / Times New Roman；
- 线宽、marker、颜色、legend、X/Y label 实时调整；
- LaTeX / MathJax 轴标题试验；
- 浏览器内 Save demo / Restore；
- SVG / PNG 导出。

当前项目格式保存仍是浏览器原型，正式 \`.sfig\` 容器将在项目模型稳定后接入。

## 产品原则

1. **默认无感**：常用场景尽量使用默认值和模板完成，不要求用户逐项配置。
2. **临时修改方便**：当前 Figure / Series 的修改默认只影响当前对象，并可一键恢复继承值。
3. **模板优先**：少量高质量模板覆盖大多数科研出图需求，不追求图型数量。
4. **科研出版优先**：默认风格接近 Matplotlib 论文图，优先满足 Nature / Optica 等出版工作流。
5. **项目化优先**：一个项目内集中保存数据、图、模板和状态，支持数据更新后关联图自动刷新。
6. **开放兼容**：项目格式、配置和数据引用尽量开放，避免被单一 renderer 或封闭格式锁死。
7. **原始数据不破坏**：归一化、offset、裁剪等属于 transform，不直接改写原始 Dataset。

## 预期首版图型

- XY：line / scatter / line+marker / errorbar / spectrum / offset spectrum；
- Bar：simple / grouped / stacked；
- Field：heatmap / beam-like intensity map / contour；
- 3D：surface / scatter 3D。

当前先完成 XY 闭环，Bar / Field / 3D 后续追加。

## 技术路线

\`\`\`text
React + TypeScript + Vite
+ Plotly.js（实时交互预览）
+ Tauri（后续 Windows 桌面壳）
+ PlotSpec 中间层
+ Matplotlib renderer（后续出版输出）
\`\`\`

Web 与桌面共用核心代码。Web 端以手动选择、拖拽、下载导出为主；桌面端增加 Linked File、目录访问和自动 reload。

## 分支与预览

\`\`\`text
日常设计与开发：p108-exp
稳定候选：      p108-stable（尚未创建）
正式主线：      main
\`\`\`

P108 使用专属 GitHub Pages workflow 作为开发预览入口。Pages 不是正式发布，也不会自动创建 tag 或 GitHub Release。
