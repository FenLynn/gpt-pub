# FigureStudio Desktop Foundation

P108 的桌面壳使用 Tauri 2，并复用 `../web` 的同一套 React / TypeScript 前端。

当前桌面基础能力：

- 读取 Linked Data 文本文件；
- 获取文件 canonical path / size / modified time；
- 对 Linked Data 建立非递归文件 watcher；
- 通过事件 `figurestudio://linked-file-changed` 通知前端；
- 调用 Python/Matplotlib publication renderer；
- publication renderer 可输出 SVG / PDF / EPS / PNG / TIFF。

## 开发运行

要求：Rust stable、Tauri CLI 2、Node.js、Python 3、NumPy、Matplotlib。

从 `src-tauri` 目录运行：

    cargo tauri dev

`tauri.conf.json` 会自动调用 `npm --prefix ../web run dev`。

## Publication renderer

Renderer 位于 `../publication/figurestudio_renderer.py`。

调用方式：

    python ../publication/figurestudio_renderer.py --job figure-job.json --out figure.pdf

`figure-job.json` 至少包含 `dataset`、`figure`、`preset` 三个对象，分别对应 Web 端 Dataset / FigureSpec / PresetDefinition。

## 当前边界

桌面壳已经建立真实文件系统、watcher 和 Matplotlib 后端接口，但 P108 仍处于 exp：不创建安装包、stable、tag、Release，也没有额外桌面 CI。

Web Pages 仍是当前交互验收入口；Windows 正式打包在 UI 收敛后再进入稳定候选阶段。