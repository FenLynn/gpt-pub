# R99 · Win7 表格兼容

版本：0.2.25-preview；数据结构仍为 schema 7；分析算法仍为 R94。

## 根因与修复

Win7 上部分 360 极速内核存在 `DecompressionStream`，但不接受 `deflate-raw`。原轻量解析器因此在构造解压流时抛出 `Failed to construct 'DecompressionStream': unsupported compression format 'deflate-raw'`，验证和导入均无法继续。这不是源 XLSX 损坏，也不是项目 ZIP 初始化问题。

R99 在程序包内加入官方 SheetJS Community Edition 0.20.3 完整浏览器构建及 Apache-2.0 许可证。XLSX 的 ZIP/Deflate 和旧 XLS 的 CFB/BIFF 解析均由本地脚本完成，不调用网络，也不依赖浏览器 `DecompressionStream`。五类业务选择器、拖放、导入预览和原件浏览统一接受 `.xls`、`.xlsx`、`.csv`。

旧内核缺少 `Blob.arrayBuffer()` 或 `Blob.text()` 时使用 FileReader 降级。原始上传字节仍按原文件名保存；字段识别、目标月份校验、合并规则和导入配置记忆沿用现有流程。

## 支持边界

- 支持 Excel 97–2003 `.xls`、标准 `.xlsx` 和 CSV，读取首个工作表。
- 支持常见中文旧工作簿和 Excel 数字日期；导入层读取单元格的已保存值。
- 不执行宏，不还原图形或原排版，不计算没有缓存结果的复杂公式。
- 加密、损坏或受密码保护的工作簿会明确拒绝；可在 Excel/WPS 解密后另存再导入。
- IE/360兼容模式的 Trident 内核仍不支持本应用。Win7 应使用360极速内核；当前源码语法基线约为 Chromium 85。目录直写仍取决于 File System Access API，不支持时使用便携缓存和项目 ZIP。
- 实际 Win7/360 安装仍需目标机器验收；自动化用移除相关 API 的浏览器覆盖降级路径，不能冒充具体360版本实机。

## 验证

`tests/r99-audit.cjs` 在纯 `file://` 页面中移除 `DecompressionStream`、`Blob.arrayBuffer()` 和 `Blob.text()`，现场生成并读取压缩 XLSX 与 BIFF8 XLS，检查中文、行号、向导确认、规范记录和原件字节保存。完整 smoke、历史生命周期、程序 ZIP 清单和 Windows 原生解压继续回归。
