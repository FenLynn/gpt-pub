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

实际 UI 使用统一单色 SVG 图标，不依赖 emoji 或颜色来区分对象。

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
