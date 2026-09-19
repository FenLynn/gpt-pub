# Data Workspace v0.4｜Origin 思路收敛

## 核心原则

FigureStudio 不复制 Origin 的厚重界面，只吸收它最成熟的数据工作流：

```text
Project organization
Workbook / Worksheet
Column designation
Plot setup
Dependents
Recalculate model（后续）
```

当前 UI 规则：

```text
左侧 = 项目对象
中间 = 数据簿或图形
右侧 = 当前对象属性
```

## 文档层级

```text
顶部文档 Tab
├ 数据簿
├ 图形
└ 图形

数据簿内部
├ 工作表1
├ 工作表2
└ 工作表3
```

工作表不占顶层文档 Tab，避免大量 Sheet 把工作区顶部撑满。

## 项目树图标

浅彩色只表达对象类别：

- 文件夹：浅黄色；
- 数据簿 / 工作表：浅蓝色；
- 图形：浅红色。

Linked、选中、警告等状态使用独立信号，不复用类别颜色。

## 工作表

默认显示：

```text
A(X)
波长
nm
```

可按需展开备注行。

支持：

- 编辑单元格；
- 名称 / 单位 / 备注；
- X / Y / Z / XErr / YErr / Label / None；
- 工作表新增、重命名、排序；
- 跨数据簿移动；
- 复制工作表；
- 复制结构；
- CSV / TSV / TXT 导入；
- 文件导入为当前数据簿的新工作表；
- 粘贴为新工作表。

## 新建图与已有图的区别

新建图可以使用列角色作为默认规则。

多个 X 时，默认取一个 X 及其右侧、下一个 X 之前的 Y 区段。

已有图则保存：

```text
sheetId
xColumnId
yColumnIds[]
yErrorColumnId?
zColumnId?
```

已有图不再根据 role 自动寻找替代列。

## 数据映射

Graph 右侧“数据”页是轻量版 Plot Setup：

- 源工作表；
- X；
- Y Series；
- Y 误差；
- Z；
- 打开源数据簿。

目前一个 Graph 的主数据映射以一个 Sheet 为范围；跨 Sheet 多源 Series 明确延后，不在本轮把数据模型再次复杂化。

## Dependents

当前工作表右侧显示引用它的图形。

数据安全规则：

- 被引用列不能直接删除；
- 被引用工作表不能直接删除；
- 包含被引用工作表的数据簿不能直接删除；
- Replace / Reload 若会让稳定引用失效则拒绝；
- 数据更新成功时 Graph 数据刷新，但样式不变。

## Sheet-level Source

```text
数据簿
├ Raw        → linked
├ Processed  → embedded
└ Summary    → embedded
```

Linked 只锁定当前 Sheet，不锁死整个 DataBook。

## 多项目

```text
一个浏览器 Tab / Window = 一个 Project
```

项目自动恢复放在 sessionStorage，因此不同浏览器 Tab 不会互相覆盖工作区状态。

用户偏好（例如 UI Scale）继续使用 localStorage。

## 从 Origin 学了什么

已吸收：

- Workbook / Worksheet 层级；
- Column Designation；
- Long Name / Units / Comments 思路；
- Plot Setup 的显式数据关系；
- Dependents；
- Worksheet rename / reorder / duplicate；
- 多 X 的默认关联思路。

刻意没有照抄：

- 大量模态对话框；
- 多层工具栏；
- 同一功能多个入口；
- 应用内多 Project 管理；
- 复杂菜单式 Plot Setup。

## 后续

下一层可以继续学习 Origin 的：

- F(x) / Formula Column；
- Auto / Manual Recalculate；
- XLSX 多工作表导入；
- 大表虚拟化；
- 项目搜索和预览；
- 更完整的跨 Sheet Plot Setup。

这些能力都建立在 v0.4 模型上，不再改变根关系。

## Origin 官方参考

- https://docs.originlab.com/user-guide/worksheets-columns/
- https://docs.originlab.com/origin-help/wkscol-setdesignation/
- https://docs.originlab.com/origin-help/wksheaderrow-datasupportdisplay/
- https://docs.originlab.com/origin-help/plot-setup/
- https://docs.originlab.com/origin-help/project-explorer/
