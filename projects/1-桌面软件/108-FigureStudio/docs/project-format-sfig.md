# .sfig Project Format v0.1

## 1. 目标

`.sfig` 是 FigureStudio 的项目事实源。目标是：

- 单文件；
- 数据、Figure、模板状态可一起迁移；
- 同一 Dataset 不因被多张 Figure 引用而重复保存；
- schema 可升级；
- 未知字段尽量 round-trip 保留；
- 导出的 PNG / SVG / PDF / EPS / TIFF 不默认塞入项目。

## 2. v0.1 实际容器

当前 Web v0.1 已经使用 ZIP 容器：

```text
project.sfig
├─ manifest.json
├─ project.json
└─ data/
   ├─ <dataset-id>.json
   ├─ <dataset-id>.json
   └─ ...
```

`project.json` 保存 Project、Figure、模板/样式设置和 Dataset metadata。

`data/<dataset-id>.json` 保存数值数组。

当前数值数据仍是 **压缩 JSON**，目的是先冻结项目模型和兼容行为；后续大型数据可无痛迁移为 Arrow / TypedArray binary，而不改变 Figure 对 Dataset ID 的引用方式。

## 3. manifest

```json
{
  "format": "sfig",
  "schemaVersion": "0.1",
  "projectId": "project-...",
  "createdWith": "0.1.0-web"
}
```

## 4. Dataset 与 Figure

Figure 不复制数据，只保存：

```text
figure.datasetId
figure.seriesOrder
figure.seriesOverrides
figure.figureOverrides
figure.templateId
figure.presetId
```

因此同一 Dataset 可以同时生成：

```text
Dataset A
├─ Figure 1 · Line
├─ Figure 2 · Heatmap
└─ Figure 3 · 3D Surface
```

Dataset 只保存一次。

## 5. Replace Data

Replace Data 保留原 Dataset ID。

若列 ID / 列名匹配：

- 自动重连所有 Figure；
- Figure 样式不变；
- Series override 保留。

若列结构变化：

- 不静默猜测；
- UI 明确请求用户确认是否按列顺序重映射。

## 6. Embedded / Linked

Web v0.1 使用 Embedded。

Linked Source 已保留为桌面端方向，计划包含：

- absolute path
- relative path
- filename
- size
- modified time
- optional content hash

Linked 不改变 Dataset ID 与 Figure 依赖模型。

## 7. 兼容与 migration

所有正式 schema 变化必须提供 migration。

v0.1 读写策略：

- 项目顶层未知字段保留；
- Dataset / Column metadata 未知字段尽量保留；
- Figure 对象直接 round-trip；
- 不识别的未来 schemaVersion 不擅自保存回旧版本。

这避免“旧版打开新版文件再保存后把新字段删掉”。
