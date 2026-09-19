# Figure Input State v0.5

## 核心边界

`Figure 文档存在 ≠ 必须已经有数据`。

Figure 是独立的版式/绘图对象，Data Binding 是可选输入层。

```text
Figure
├ Template
├ Preset
├ Figure overrides
└ Data Binding?
```

## 两个入口

- Project Explorer → 新建空图；
- Sheet → 按列角色新建图。

## 四态

- `empty`：`dataRef === undefined`；
- `incomplete`：已选工作表，但模板最小输入不足；
- `ready`：输入完整且稳定引用可解析；
- `broken`：原 Sheet / Column 引用无法解析。

## 当前模板输入规则

XY / Bar / Field / 3D 当前都要求至少一列主数据 Series，X 为 optional。

没有显式 X 时，adapter 生成 `1, 2, 3, ... N` 行号视图；不写回 Spreadsheet，也不生成虚假 Column ID。

## 数据安全

incomplete / broken 状态只提示用户补齐或修复映射，不允许自动换列、自动换工作表或静默 fallback。

## 保存

v0.5 `.sfig` 允许保存没有 dataRef 的空图。0.1 / 0.2 / 0.3 / 0.4 项目迁移到 0.5 时，旧 Figure 保持原数据引用。
