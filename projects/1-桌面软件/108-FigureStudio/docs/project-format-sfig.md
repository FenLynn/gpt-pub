# .sfig Project Format v0.4

## 1. 事实模型

```text
Project
├─ folders[]
├─ dataBooks[]
│  └─ sheets[]
│     ├─ source
│     ├─ columns[]
│     └─ metadata
└─ figures[]
```

DataBook 是组织容器；Sheet 是数据事实对象；Graph 只保存稳定数据引用和绘图参数。

## 2. 容器

```text
project.sfig
├─ manifest.json
├─ project.json
└─ data/
   ├─ <sheet-id>.json
   └─ ...
```

`project.json` 保存：

- 文件夹层级；
- DataBook metadata；
- Sheet metadata；
- Sheet-level Embedded / Linked source identity；
- Column metadata；
- FigureSpec；
- Template / Preset / overrides。

`data/<sheet-id>.json` 保存 Sheet 的实际列值。

## 3. schemaVersion

当前：

```json
{
  "format": "sfig",
  "schemaVersion": "0.4",
  "createdWith": "0.4.0-web"
}
```

读取器支持：

- 0.1 → 0.4
- 0.2 → 0.4
- 0.3 → 0.4
- 0.4 native

未知未来 schemaVersion 不允许被旧应用静默覆盖保存。

## 4. DataBook

```text
DataBook
├─ id
├─ name
├─ folderId?
└─ sheets[]
```

DataBook 不拥有统一 source。

同一 DataBook 可以同时包含：

```text
Sheet A → linked
Sheet B → embedded
Sheet C → embedded
```

## 5. Sheet

```text
Sheet
├─ id
├─ name
├─ comment?
├─ source
├─ columns[]
└─ metadata?
```

source：

```text
kind = embedded | linked
fileName?
path?
relativePath?
size?
modifiedMs?
status?
```

Web 重新打开 Linked Sheet 时，如果不能确认原外部文件身份，状态进入 `needs-relink`，不能假装仍与源文件同步。

## 6. Column

```text
Column
├─ id
├─ name
├─ unit?
├─ comment?
├─ role
└─ values[]
```

role：

```text
X / Y / Z / XErr / YErr / Label / None
```

单元格允许：

```text
number | string | null
```

Renderer 通过 adapter 得到纯数值 PlotColumn，不直接消费 Spreadsheet 的混合类型数据。

## 7. Graph 数据引用

```text
figure.dataRef
├─ sheetId
├─ xColumnId
├─ yColumnIds[]
├─ yErrorColumnId?
└─ zColumnId?
```

这些 ID 是项目事实。

因此：

- 改列名不会换数据；
- 改单位不会换数据；
- 改 role 不会让已有 Graph 自动重映射；
- 移动 Sheet 到另一个 DataBook 不会断 Graph；
- 删除被引用列会被阻止；
- 删除被引用 Sheet / DataBook 会被阻止；
- Replace / Reload 若无法保持所有引用会被拒绝。

新建 Graph 时可以使用 Column Role 推导默认映射；创建完成后即固化为稳定 ID。

## 8. Embedded / Linked

Embedded Sheet：

- `.sfig` 是事实源；
- 可编辑；
- 可作为处理/汇总工作表。

Linked Sheet：

- 外部文件是事实源；
- 当前缓存值保存在项目中用于预览和迁移；
- 默认只读；
- Web Reload 需要重新选择源文件；
- 可以创建 Embedded 可编辑副本；
- 可以解除链接，把当前缓存转为 Embedded；
- Tauri 后续通过 path / identity / watcher 自动发现变化。

Reload 只更新源数据，不得改 Graph 样式；用户设置的 role / comment 等工作表元数据应保留。

## 9. migration

### 0.1 / 0.2

旧 Dataset：

```text
Dataset
├ x
└ ys[]
```

迁移：

```text
DataBook
└ Sheet (embedded)
   ├ X
   └ Y / YErr ...
```

旧 Figure 的 `datasetId + seriesOrder + errorSeriesId` 转成稳定 `sheetId + columnId` 引用。

### 0.3

旧结构：

```text
DataBook
├ source
└ sheets[]
```

迁移：

```text
DataBook
└ sheets[]
   └ each sheet.source = old DataBook.source
```

Linked source 重新打开后进入 `needs-relink`。

## 10. 不作为事实源的内容

以下内容不能反过来决定项目事实：

- Plotly layout；
- 导出的 PNG / SVG / PDF / EPS / TIFF；
- Figure thumbnail；
- Matplotlib Python script；
- UI 临时选择状态；
- 浏览器文档 Tab 状态。
