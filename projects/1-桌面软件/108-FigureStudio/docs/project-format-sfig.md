# .sfig Project Format v0.3

## 1. 事实模型

`.sfig` 的长期项目模型现在明确为：

```text
Project
├─ folders[]
├─ dataBooks[]
│  ├─ source
│  └─ sheets[]
└─ figures[]
```

数据与图形独立保存，Graph 只保存引用和显示参数。

## 2. 容器

```text
project.sfig
├─ manifest.json
├─ project.json
└─ data/
   ├─ <sheet-id>.json
   ├─ <sheet-id>.json
   └─ ...
```

`project.json` 保存：

- Folder hierarchy
- DataBook metadata
- Sheet / Column metadata
- Embedded / Linked source metadata
- FigureSpec
- Template / Preset / overrides

`data/<sheet-id>.json` 保存 Sheet 的列值。

## 3. schemaVersion

当前：

```json
{
  "format": "sfig",
  "schemaVersion": "0.3",
  "createdWith": "0.3.0-web"
}
```

读取器支持：

- 0.1 → 0.3
- 0.2 → 0.3
- 0.3 native

未来版本不得让旧应用静默覆盖未知新 schema。

## 4. DataBook / Sheet

DataBook 是项目中的数据文档：

```text
DataBook
├─ id
├─ name
├─ folderId
├─ source
└─ sheets[]
```

Sheet：

```text
Sheet
├─ id
├─ name
├─ columns[]
└─ metadata
```

Column：

```text
id
name
unit
role
values[]
```

role：

```text
X / Y / Z / XErr / YErr / Label / None
```

单元格允许 number / text / null。

## 5. Graph 数据引用

Graph 不再依赖旧的 `datasetId` 作为主要引用。

正式引用：

```text
figure.dataRef
├─ sheetId
├─ xColumnId
├─ yColumnIds[]
├─ yErrorColumnId?
└─ zColumnId?
```

Column role 只负责创建 Graph 时的默认映射。

一旦 Graph 创建，稳定 Column ID 成为事实，因此：

- 改列名：Graph 不断；
- 改单位：Graph 数据不换；
- 改 Column role：Graph 不静默重映射；
- 移动 DataBook/Graph 文件夹：Graph 不断。

## 6. Embedded / Linked

Embedded：

- 数据值以项目内容为事实源；
- Sheet 可直接编辑；
- 分享 `.sfig` 即可完整迁移。

Linked：

- 外部文件是事实源；
- 项目保存当前缓存数据和 source identity；
- 默认只读；
- Web Reload 时用户重新选择文件；
- Tauri 可通过 path / identity / watcher 自动 Reload；
- 解除链接后缓存数据转为 Embedded，可继续编辑。

保存后重新打开 Linked 项目时，如果平台无法确认原文件身份，应进入 needs-relink 状态，而不是假装链接仍有效。

## 7. migration

0.1 / 0.2 的旧 Dataset：

```text
Dataset
├─ x
└─ ys[]
```

迁移为：

```text
DataBook
└─ Sheet
   ├─ X column
   └─ Y / YErr columns
```

旧 Figure 的：

```text
datasetId + seriesOrder + errorSeriesId
```

迁移为：

```text
sheetId + xColumnId + yColumnIds + yErrorColumnId
```

旧项目数据和 Figure 样式不需要用户手工重建。
