# .sfig Project Format Draft

## 目标

单文件、可迁移、可恢复、可分享，同时允许大型数据使用 Linked 模式避免项目膨胀。

## 概念结构

~~~text
project.sfig
├─ manifest.json
├─ project.json
├─ data/
│  └─ <dataset-id>.<binary>
├─ figures/
│  └─ <figure-id>.json
├─ templates/
├─ presets/
├─ assets/
└─ previews/
~~~

容器实现可采用 ZIP 类格式，但具体压缩算法尚未冻结。

## 必须字段

~~~json
{
  "format": "sfig",
  "schemaVersion": "0.1",
  "projectId": "stable-id",
  "createdWith": "app-version"
}
~~~

## Dataset 模式

### Embedded

数据真正写入容器，适合论文归档、分享和长期保存。

### Linked

项目保存数据来源身份，不复制大型原始文件。至少考虑 absolute path、relative path、filename、size、modified time 与 optional content hash。

## 去重与导出

- Figure 只引用 Dataset ID，不复制 Dataset。
- SVG / PDF / EPS / PNG / TIFF 默认不嵌入项目。
- 小缩略图可以缓存并重建，不是事实源。

## Migration

所有正式 schema 变化必须提供 migration。读取未知字段时默认保留，不得无理由丢弃。