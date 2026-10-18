# P108 FigureStudio｜HANDOFF

> 新对话、换模型或换开发代理时，以本文件作为固定接续入口。  
> 本文件记录“怎么恢复上下文、哪些架构决策不能退回、当前开发断点是什么”。  
> **分支 SHA、CI Run、Pages 部署均为动态事实，每次接续必须重新查询仓库，不得只相信本文件中的历史值。**

## 1. 项目入口

- 仓库：`FenLynn/gpt-pub`
- 项目：P108 FigureStudio
- 路径：`projects/1-桌面软件/108-FigureStudio/`
- Web：`projects/1-桌面软件/108-FigureStudio/web/`
- 日常开发分支：`p108-exp`
- 专用 CI：`.github/workflows/p108-figurestudio-pages.yml`
- 公网开发预览：`https://fenlynn.github.io/gpt-pub/p108/`
- 当前阶段不创建 `p108-stable`、正式 tag、Release 或额外桌面 CI。

本次写入 HANDOFF 时，最近已验证的 P108 head 为：

`481694db182d5851ca5a08783d6726a467cc92fe`

对应 P108 dedicated CI 已全绿，Unified Pages 也已成功发布该 P108 SHA。  
**下一对话开始时必须重新核对 current `p108-exp` head 和最新成功 CI，不能假设这个 SHA 仍是最新。**

---

## 2. 新对话必须按这个顺序恢复

先读仓库实际内容，不要直接凭聊天摘要继续改。

1. `/GPT_RULES.md`
2. `projects/1-桌面软件/开发约束.md`
3. `projects/1-桌面软件/108-FigureStudio/开发约束.md`
4. 本 `HANDOFF.md`
5. `README.md`
6. `工作记录.md`
7. `设计与演进.md`
8. 当前 `p108-exp` 的真实 head、最近 P108 CI、Unified Pages 实际采用的 P108 SHA
9. 再检查本轮涉及的源文件和真实浏览器截图

如果 HANDOFF、README、工作记录与当前代码不一致：

**以仓库当前代码 + 当前成功 CI + 实际浏览器结果为准，并在本轮结束前更新 HANDOFF。**

---

## 3. 当前最重要的架构决策

### 3.1 图形架构与数据表达必须彻底分层

这是当前 P108 最重要的设计边界，后续不要退回“折线图 / 散点图 / 点线图都是独立图型”的模型。

#### A. Plot Architecture｜图形架构层

负责坐标系、图层关系和数据组织方式，例如：

- 单 Y
- 双 Y
- 瀑布 / 偏移
- 柱状
- 2D Field
- 3D
- 专项分析
- 组合 / 多面板以后单独演进

**单 Y / 双 Y 是架构，不是点、线的风格。**

#### B. Series｜数据组层

一张图可以放任意多组 Series。

例如单 Y：

```text
Single Y
├─ Series A
├─ Series B
└─ Series C
```

A、B、C 可以完全使用不同的数据表达。

双 Y 也是一样，只是每个 Series 多一个独立的轴归属：

```text
Double Y
├─ Series A → Left Y
├─ Series B → Right Y
├─ Series C → Left Y
├─ Series D → Right Y
└─ Series E → Right Y
```

不得把双 Y 实现成“第一条默认左、第二条默认右，因此一左一右”的固定语义。  
默认可以有推荐值，但**每个 Series 必须可以自由选择 Left / Right Y**。

#### C. Element｜Series 内部表达元素

每个 Series 参考 Origin 的思路拆成独立元素：

- Line
- Symbol / Marker
- Error Bar
- Fill
- 后续可继续扩展

它们是组合关系，不是互斥图型。

例如：

```text
纯线       = Line ON  + Symbol OFF
纯点       = Line OFF + Symbol ON
点线       = Line ON  + Symbol ON
线+空心点  = Line ON  + Symbol ON + Hollow ON
```

所以“点线图”不应该继续作为长期架构概念存在。

#### D. Preset / Theme｜快速默认层

Preset 负责快速出图和视觉一致性，不负责限制能力。

用户应当可以：

1. 一键套用常见默认，如“论文线”“点”“线+点”“空心点”；
2. 套用后继续独立调整 Line / Symbol / Error / Fill 的颜色、大小、线型、透明度；
3. 一键更换整张图 Palette；
4. 保留每个 Series / Element 的显式 override。

最终原则：

```text
快速默认负责快
Element override 负责自由
Theme / Palette 负责一致
Architecture 只负责结构
```

---

## 4. 当前已经落地的实现

当前代码已经开始按上述分层实现。

### 顶部 Graph Toolbar

顶部现在选择的是 **“架构”**，不是“点 / 线 / 点线”。

- 单 Y 与双 Y 不再暴露“点 / 线 / 点线”作为架构子型。
- 只有真正存在结构变体的架构才显示子型，例如柱状、二维场、3D 等。
- Lorentz Golden 是特殊双面板组合编辑示例，不代表通用多面板已经完成。

主要文件：

- `web/src/plot/templates.ts`
- `web/src/App.tsx`

### Series Inspector

普通 XY Series 当前已经拆出：

- 数据组通用设置
- 系列基准色
- 快速预设
- 双 Y 的 Left / Right Y 分配
- `Line · 线`
- `Symbol · 点`
- `Error Bar · 误差棒`
- `Fill · 填充`

Line 与 Symbol 已经可以同时或分别开启。

颜色开始按下面的继承思路演进：

```text
Palette
  ↓
Series 基准色
  ├─ Line 默认继承，可独立覆盖
  ├─ Symbol 默认继承，可独立覆盖
  ├─ Error Bar 默认继承，可独立覆盖
  └─ Fill 默认继承，可独立覆盖
```

当前 `SeriesOverride` 已增加或使用：

- `lineVisible`
- `lineWidthPt`
- `lineStyle`
- `lineColor`
- `markerVisible`
- `markerSymbol`
- `markerSizePt`
- `markerHollow`
- `markerFillColor`
- `markerEdgeColor`
- `markerEdgeWidthPt`
- `errorBarVisible`
- `errorBarWidthPt`
- `errorBarCapSizePt`
- `errorBarColor`
- `fillVisible`
- `fillColor`
- `fillOpacity`
- `yAxis`

主要文件：

- `web/src/model.ts`
- `web/src/App.tsx`
- `web/src/plot/renderSpec.ts`
- `web/src/export/matplotlib.ts`

### 已加入的关键回归

测试已经明确验证：

- 同一张单 Y 图内可以同时存在：
  - Series A = 纯线
  - Series B = 纯点
  - Series C = 线 + 点
- Line color 可以独立于 Series 基准色。
- Error Bar 是 per-Series element，不再只由“Errorbar 图型”决定。
- Fill 是可组合的 per-Series element。
- 双 Y 中不同 Series 可以独立设置成 `Right / Left / Right`。

主要测试：

- `web/tests/nature-gallery.test.ts`

---

## 5. 兼容层暂时不要粗暴删除

当前 `.sfig` schema 仍为 **0.5**。

历史 `templateId` 仍包含：

- `xy-line`
- `xy-scatter`
- `xy-line-marker`
- `xy-errorbar`
- `double-y`
- 等

这些旧 ID 现在有一部分只是兼容和默认入口。

**不要为了“架构干净”直接删除这些 ID，导致旧项目无法打开。**

更合理的后续路线是：

1. 先让 runtime 语义彻底从旧 template 表现解耦；
2. 保持 0.5 兼容；
3. 如果未来确实需要 schema 0.6，再设计显式 `architectureId` / series element migration；
4. migration 必须可复核，不能静默改变旧图外观。

---

## 6. 当前仍需要继续收敛的关键问题

### 6.1 Theme / Palette / Size 还需要系统化

用户明确希望：

> 随便画一张普通图，配色、风格、大小尺寸控制都一致，配色可以方便切换。

下一主线应当是建立统一的：

```text
Architecture
  +
Series Elements
  +
Theme
  +
Palette
  +
Physical Size
```

而不是继续增加“线图模板 / 点图模板”。

Theme 应统一：

- 字体层级
- axis
- tick
- grid
- legend
- 默认 line width
- 默认 marker size
- spacing / margin
- colorbar
- bar border
- field / contour 基础语言

Palette 应独立于 Theme：

- categorical palette：Line / Symbol / Bar 多系列
- sequential palette：Heatmap / Contour / Surface
- diverging palette：需要正负分离的场图

Size 应统一处理：

- canvas mm
- title pt
- axis title pt
- tick pt
- legend pt
- line / marker scaling
- margin

**CSS px 不能成为出版尺寸事实源。**

### 6.2 Series 默认值仍需进一步摆脱 legacy templateId

当前底层为了兼容旧图，某些默认表现仍可能参考 `xy-line / xy-scatter / xy-line-marker / xy-errorbar`。

后续应逐步变成：

```text
Architecture default
→ Theme / Preset default
→ Series element default
→ Series explicit override
```

旧 templateId 只作为 migration / compatibility hint，不应长期决定一个 Series 必须是点还是线。

### 6.3 Error Bar 数据映射还不够 Origin-like

当前 Figure 数据引用仍主要只有一个 `yErrorColumnId`。

如果要真正支持多个 Series 各自不同 Error Bar，后续应该设计：

- per-Series YErr mapping
- 或明确的 auxiliary column binding

不要简单复制多份数据。

### 6.4 Fill 目前只是第一版

当前普通 XY Fill 主要是曲线到 baseline 的填充。

以后如果扩展：

- between two series
- stacked area
- confidence band
- positive / negative split

应继续作为 Element / auxiliary relationship 设计，而不是新造大量“图型”。

---

## 7. 3D 当前状态不要回退

3D 最近已经做过一轮重点修复。

原则：

- 不要恢复 Plotly `surface.contours` 在主表面爬线；
- 不要为了干净把投影删掉；
- 三向投影都要保留。

当前方案：

- 主 surface 保持干净；
- Floor：FigureStudio 自己计算的 refined z contours；
- X wall：constant-x profile；
- Y wall：constant-y profile；
- surface display interpolation 当前使用高密度显示网格，不改源数据；
- WebGL preview 与 SVG export 尽量保持同一几何语义。

关键文件：

- `web/src/plot/renderSpec.ts`
- `web/src/export/surfaceVectorSvg.ts`

---

## 8. UI / 视觉原则

用户对 P108 的要求不是“功能能用”即可。

必须：

- 实际打开浏览器截图检查；
- 不允许只看 TypeScript / CI 绿灯就说视觉完成；
- 科研出版图优先；
- 参考 Matplotlib / Nature / Origin 的高价值交互，但不机械复制 Origin 的复杂度；
- 默认应能快速得到干净图；
- 高级参数允许独立微调；
- 不要把所有设置堆成一个巨大面板；
- 图形结构、数据映射、Series 表达、Figure 样式必须分层。

当前用户明确认可的方向：

> Origin 式元素拆分 + FigureStudio 自己的简洁科研默认与一键风格。

---

## 9. 验证方式

P108 每次实质修改至少要走：

```bash
npm --prefix "projects/1-桌面软件/108-FigureStudio/web" install --no-audit --no-fund
npm --prefix "projects/1-桌面软件/108-FigureStudio/web" run build
npm --prefix "projects/1-桌面软件/108-FigureStudio/web" run test:gallery
```

然后检查 P108 dedicated CI：

`.github/workflows/p108-figurestudio-pages.yml`

Dedicated CI 当前会做：

- P108 scope gate
- TypeScript / Vite build
- gallery regression
- CJK font visual environment
- Nature gallery Chromium QA
- Lorentz actual editor QA
- screenshot artifact
- validated preview artifact

**视觉相关修改必须下载并查看真实 screenshot artifact。**

Unified Pages 会从最近成功的 P108 dedicated CI 选择独立 P108 source ref，再和 P109 一起发布。

所以公开页面是否更新，必须最终检查 Unified Pages 日志中的：

`Resolved preview refs: P108=<sha> ...`

不要只看到 dedicated CI 成功就声称公网已更新。

---

## 10. 分支与提交规则

- 只改 `p108-exp`。
- 不碰其他项目源码。
- 不新建额外 workflow。
- 不通过 Actions 做与 P108 既有验证边界无关的自动化。
- 多文件修改优先原子 commit。
- 每次提交后核对 branch head。
- 失败时先读真实日志，不要猜。
- 修复后重新跑完整 P108 CI。
- UI / renderer 修改必须做截图验证。

---

## 11. 下一对话推荐起手方式

新对话可以直接给下面这句话：

```text
请接续 P108 FigureStudio。仓库是 FenLynn/gpt-pub，开发分支 p108-exp。
先完整读取并严格按照
projects/1-桌面软件/108-FigureStudio/HANDOFF.md
恢复上下文，再读取该文件要求的上位规则和项目文档。
随后重新核对 p108-exp 当前真实 head、最近成功 P108 dedicated CI、Unified Pages 实际采用的 P108 SHA。
先告诉我准确断点和你理解的当前架构，不要根据旧聊天猜测。
核心原则：单 Y / 双 Y 是图形架构；每个 Series 独立拥有 Line / Symbol / Error Bar / Fill 等元素；双 Y 的每个 Series 可自由选择 Left / Right Y；Preset 只提供快速默认，不限制自由编辑。
核对无误后再继续当前主线：统一普通图的 Theme / Palette / Physical Size，并保持 Origin 式元素自由编辑。
```

如果只是短距离跨对话，也可以简化成：

```text
接续 P108，先读 p108-exp 的 projects/1-桌面软件/108-FigureStudio/HANDOFF.md，重新核对仓库和 CI 后继续，不要沿用旧上下文猜状态。
```

---

## 12. 本轮交接断点

本轮刚完成的核心调整：

1. 纠正“单 Y / 双 Y 与点线表现混层”的设计错误；
2. 顶部改为 Architecture 选择；
3. 单 Y / 双 Y 不再把点、线、点线当架构子型；
4. Series Inspector 开始按 Origin 思路拆 Line / Symbol / Error Bar / Fill；
5. 双 Y 每个 Series 独立选择左 / 右 Y；
6. 加入 mixed single-Y 与 arbitrary double-Y assignment 回归；
7. dedicated CI 已通过；
8. Unified Pages 已确认发布当时的 P108 成功 head。

**下一优先级不是继续发明“更多线图模板”，而是把 Theme / Palette / Physical Size 做成所有普通图共享的统一系统。**
