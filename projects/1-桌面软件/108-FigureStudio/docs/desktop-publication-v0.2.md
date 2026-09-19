# Desktop & Publication v0.2

## 总体路径

    FigureSpec
       ├─ Plotly interactive → Web / Tauri
       └─ Matplotlib publication → SVG / PDF / EPS / PNG / TIFF

Plotly 负责编辑体验，Matplotlib 负责最终出版文件。两边都消费同一 Dataset / FigureSpec 语义，不把 Plotly layout 当项目格式。

## Tauri

`src-tauri/` 已建立 Tauri 2 桌面壳，窗口直接加载 `web/` 的构建结果。

当前 native commands：

- `read_linked_text`
- `file_identity`
- `start_linked_watch`
- `stop_linked_watch`
- `run_publication_renderer`

Linked Data watcher 向前端广播 `figurestudio://linked-file-changed`。

因此后续桌面 UI 连接 Linked Source 时，只需把文件变化事件接入现有 Replace Data / Dataset stable ID 流程，不需要重新设计 Figure。

## Linked Source identity

桌面端已经可以取得 canonical path、file size、modified time。正式 Linked Dataset 仍按设计保留 absolute path、relative path、filename、size、modified time、optional content hash。

换电脑或移动项目后可以做 Locate / Relink，而不是把绝对路径当唯一身份。

## Publication renderer

`publication/figurestudio_renderer.py` 接收 renderer-neutral job：

    {
      "dataset": { "...": "Dataset" },
      "figure": { "...": "FigureSpec" },
      "preset": { "...": "PresetDefinition" }
    }

支持当前主要图型：XY line / scatter / marker、errorbar、offset spectrum、bar / stacked bar、heatmap、surface 3D。

输出格式由文件后缀决定：`.svg`、`.pdf`、`.eps`、`.png`、`.tif` / `.tiff`；raster 默认 600 dpi。

## Python script export

Web v0.2 同时提供 `Python` 导出按钮，直接生成可编辑 Matplotlib 脚本。

因此有两条可复现路径：

    GUI → .sfig → desktop renderer
    GUI → generated matplotlib.py

`.sfig` 始终是项目事实源。