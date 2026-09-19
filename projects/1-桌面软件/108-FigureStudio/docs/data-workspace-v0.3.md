# Origin-style Data Workspace v0.3

## 设计原则

FigureStudio v0.3 将 Origin 值得保留的核心工作方式抽出来：

> **先有数据文档，再由数据生成图；数据与图互相独立，但保持稳定引用。**

UI 规则：

```text
左侧 = 项目有什么
中间 = 当前编辑什么
右侧 = 当前对象的属性
```

## Project Explorer

左侧只显示项目对象：

```text
📁 Folder
▦ DataBook
  └─ Sheet
📈 Graph
```

实际 UI 使用轻量浅彩色 SVG 图标辅助扫视：Folder = 浅黄色，DataBook / Sheet = 浅蓝色，Graph = 浅红色。颜色只用于对象类别识别，不承担状态含义；选中、错误、Linked 状态仍使用独立视觉信号。

DataBook 与 Graph 可以在 Folder 中组织；Graph 内部 Series 不再塞进左侧项目树。

## Document Tabs

中间是文档工作区。

Data Sheet 与 Graph 都可以打开成 Tab：

```text
[ OSA 光谱数据 · Spectrum ] [ Fig 1 · 光谱 ] [ Beam field ]
```

切到 Sheet：

- Spreadsheet

切到 Graph：

- Figure canvas

Graph 工具栏提供“数据”入口，可立即跳到它引用的 Sheet。

## Spreadsheet

列头由三层组成：

```text
A(X)
波长
nm
```

或者：

```text
B(Y)
功率
dBm
```

支持：

- 编辑 cell
- name
- unit
- role
- add row
- add column
- add Sheet
- reorder column
- delete column
- paste as new Sheet

Web 为避免巨量 DOM，目前交互表最多渲染前 1500 行；数据模型和绘图仍保留全部行。后续可替换为虚拟表格。

## Column Role

支持：

- X
- Y
- Z
- XErr
- YErr
- Label
- None

Role 是创建 Graph 的快捷语义，不是长期动态绑定规则。

例如创建 Graph 时：

```text
A(X) + B(Y) + C(YErr)
        ↓
Graph.dataRef
xColumnId = A.id
yColumnIds = [B.id]
yErrorColumnId = C.id
```

之后把 B 的 role 改成 None，也不能让旧 Graph 自动改画另一列。

## Embedded / Linked

Embedded Data：

```text
.sfig = source of truth
可编辑
```

Linked Data：

```text
external file = source of truth
read-only by default
```

Web：

- 选择文件创建 Linked Data
- 重新选择文件完成 Reload
- 解除链接后转 Embedded 并允许编辑

Desktop：

- 使用 native path
- file identity
- watcher
- 自动发现外部变化
- 再走同一 Sheet reload / Graph stable-ref 逻辑

## 下一步

数据模型稳定后，优先补：

1. XLSX / multiple sheets
2. Spreadsheet block selection / copy / paste
3. formula / derived column
4. virtualized large table
5. optional Data | Graph split view
6. Tauri native Linked source UI

这些都建立在当前 DataBook / Sheet / Graph 基础上，不再反过来修改核心关系。


## 单项目窗口原则

FigureStudio 不在同一个应用实例里再造“多项目管理器”。

Web 端的边界固定为：

```text
一个浏览器 Tab / Window = 一个 .sfig Project
一个 Project 内 = 多 DataBook / Sheet / Graph
```

需要同时比较多个项目时，直接使用浏览器多开；这比在应用内部再维护一层 Project Tab 更简单，也更符合 Web 使用习惯。

因此不设计：

- 应用内多 `.sfig` Project Tab；
- 跨 Project 拖拽；
- 跨 Project 共享 Undo / autosave；
- 一个页面同时持有多份 ProjectState。

桌面端也沿用“一窗口一项目”的心智模型；未来若需要并行项目，优先多窗口，而不是在同一窗口堆多项目。

## 继续学习 Origin，但只取高价值部分

### 1. DataBook 内部 Sheet Tab

Origin 的 Workbook 本身包含多个 Worksheet，Sheet 通过 Book 内的页签切换。FigureStudio 当前已经有 DataBook → Sheet 数据模型，下一步 UI 更适合进一步收敛为：

```text
文档 Tab：DataBook / Graph
DataBook 内部：Sheet1 | Sheet2 | Sheet3
```

这样不会让很多 Sheet 把顶部文档 Tab 撑满，也更符合“一个实验数据簿里有多张表”的科研习惯。

### 2. Column Label Rows

保留当前 A(X) / B(Y) 的列角色，并继续学习 Origin 的列元数据区，但不要照搬全部复杂度。

优先级：

```text
Name
Unit
Comment
F(x) / Formula   ← 后续
```

默认只显示最常用行；Comment / Formula 可以按需展开。

### 3. Data Mapping / Plot Setup

已有 Graph 必须提供清晰的数据映射入口，用来：

- 查看 X / Y / Error / Z 来源；
- 添加或移除 Series；
- 替换某条 Series 的数据列；
- 调整 Series 顺序；
- 从其他 Sheet 加数据到当前 Graph。

这个入口应是现代化的紧凑面板，而不是复刻 Origin 的大型对话框。

### 4. Dependents

DataBook / Sheet 应能快速看到“哪些 Graph 正在引用我”。

例如：

```text
Spectrum Sheet
依赖图形：3
→ Fig 1
→ Fig 2
→ Fig S4
```

这对于 Replace / Reload / 删除数据前的安全确认非常重要。

### 5. Formula / Recalculate

后续派生列应学习 Origin 的公式列与 Recalculate 思路：

```text
Raw columns
   ↓
Formula / Derived column
   ↓
Auto / Manual recalculate
   ↓
Dependent Graph
```

但公式和计算图属于数据层，不写进 renderer。

### 6. Project Search / Preview

项目较大后再加入：

- 搜索 DataBook / Sheet / Graph / Column；
- Graph hover thumbnail；
- DataBook hover summary；
- Dependents 数量。

这些属于大型 Project 的导航能力，不应该挤占当前基础工作流。
