# P106｜MediaIndex Acceptance App

## 目的

`MediaIndex Acceptance` 是 Phase 0 的真实域验收壳，不是正式 MediaIndex 产品。

它的目标只有一个：

> 让用户尽量少操作地完成 A4 图片真实域验收和 V011 视频真实域验收。

算法仍复用现有 Python baseline worker，GUI 负责隐藏：

- Python 命令行。
- CSV manifest。
- 临时工作目录。
- 结果文件路径。
- 图片和视频 runner 的调用顺序。

## 当前版本

`v0.0.1-dev`

没有正式 tag，也没有 GitHub Release。

## 用户操作目标

用户统一只需要双击：

```text
start_acceptance.bat
```

如果 portable 已经存在，它会直接启动；如果还没有，它会自动调用 build 并在完成后启动。

首次自动构建时会：

1. 查找本机 Python。
2. 创建私有 build venv。
3. 安装 PyInstaller 和算法依赖。
4. 把 A4 / V011 baseline 打包为私有 worker EXE。
5. 若缺少 .NET 8 SDK，则自动下载一个仅供构建使用的私有 SDK。
6. 构建自包含 Windows x64 GUI。
7. 生成 portable 文件夹和 ZIP。
8. 自动启动 GUI。

完成后日常只运行：

```text
dist/
  MediaIndex-Acceptance-v0.0.1-win-x64/
    MediaIndex Acceptance.exe
```

正式 portable 运行时不要求安装 Python，也不要求安装 .NET Runtime。

## GUI 流程

### 1. 选择库存

只选择已有真实库存目录，不复制库存：

- 图片库存目录。
- 视频库存目录。

只测图片时无需选择视频目录。

只测视频时无需选择图片目录。

### 2. 加入 Query

支持：

- “添加图片”。
- “添加视频”。
- 直接把图片或视频拖到窗口。

Query 文件不会被自动复制到发布目录。

### 3. 设置标准答案

每条 Query 必须显式标注一次：

- 双击行或点“设置标准答案”，选择真实源。
- 完全无关的 hard negative 可以批量选中后点“设为无对应”。

未标注 Query 不允许开始测试，避免把“忘记设置”误当成 hard negative。

视频的 `source start` 是可选项。只有用户知道时才填写，不强迫手工查时间码。

### 4. 一键运行

点击：

```text
开始真实域验收
```

程序内部自动生成临时 manifest，然后顺序执行：

```text
A4 image
→
V011 video
→
anonymous summary
```

只存在图片或只存在视频 Query 时会自动跳过另一类。

### 5. 结果

GUI 直接显示核心指标：

- 图片 Top-50 candidate recall。
- 图片 hard-negative false Confirmed。
- 视频 positive Top-1。
- 视频 unrelated strong match。

需要交给 ChatGPT 分析时只点：

```text
导出匿名结果
```

输出：

- `a004_results.json`
- `v011_results.json`
- `real_domain_summary.json`

## 隐私

应用内部状态位于：

```text
%LOCALAPPDATA%\FenLynn\MediaIndex\Acceptance
```

默认不复制原图、原视频到该目录。

公开仓库和匿名导出都不应包含私人媒体。

## Portable 结构

当前计划：

```text
MediaIndex-Acceptance-v0.0.1-win-x64/
├─ MediaIndex Acceptance.exe
├─ Runtime/
│  └─ MediaIndex.Acceptance.Worker.exe
└─ README.txt
```

用户只需要点击主 EXE。

worker 对用户隐藏，由主程序以无控制台方式调用。

## 技术结构

```text
WinForms .NET 8 self-contained host
        ↓
private PyInstaller worker
        ↓
A4 image runner
V011 video runner
summary runner
```

选择这一结构是为了：

- 复用已经验证过的 Python 算法，避免为了 GUI 重新翻译算法引入新误差。
- GUI 本身保持原生 Windows、启动简单。
- portable 运行时不暴露 Python 环境。
- 等真实域冻结后，再决定正式 MediaIndex Core 是否迁移到 C++ / C# / native library。

## 当前边界

Acceptance App 不做：

- 删除文件。
- 移动文件。
- 重命名文件。
- 自动整理库存。
- 正式持久化 MediaIndex 大库索引。
- 正式产品 UI。

它只用于真实域验收。
