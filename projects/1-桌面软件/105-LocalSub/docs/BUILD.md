# LocalSub Build & Delivery

## 目标

P105 LocalSub 面向 Windows x64，采用 `.NET 8` framework-dependent single-file。基础绿色包保持轻量，不携带模型、FFmpeg、ONNX Runtime 或 sherpa native runtime。

## 本地 publish

Shell：

```powershell
dotnet publish projects/1-桌面软件/105-LocalSub/src/LocalSub/LocalSub.csproj -c Release -r win-x64 --self-contained false -o publish
```

Core：

```powershell
dotnet publish projects/1-桌面软件/105-LocalSub/src/LocalSub.CoreWorker/LocalSub.CoreWorker.csproj -c Release -r win-x64 --self-contained false -o core-publish
```

将 `core-publish/LocalSub.Core.exe` 复制到 Shell 的 `publish/` 根目录。

## 绿色目录边界

基础程序目录至少包含：

```text
LocalSub.exe
LocalSub.Core.exe
ASR/README.txt
```

用户现有环境可以另外包含：

```text
ASR/
ASR/_runtime/
Assets/
Components/
config.json
现有模型
Mediova / system FFmpeg
```

日常增量补丁默认不覆盖上述用户资产，除非本轮明确要求迁移其格式。

## 禁止打包

基础包不得包含：

- `*.onnx` 模型
- `onnxruntime*.dll`
- `sherpa-onnx-c-api.dll`
- `.NET hostfxr.dll`
- `Components/FFmpeg/bin/ffmpeg.exe`
- 用户日志、转写结果、真实配置或绝对路径

## CI

长期活动 workflow：

```text
.github/workflows/p105-localsub-ci.yml
```

CI 负责 P105 路径 scope gate、Shell/Core publish、Core Named Pipe 真连接、Shell/后台页/Process Loopback 烟测、sherpa native runtime 加载、native offline ASR 真解码和最终包边界检查。v0.1.5 起还固定检查左侧一级导航、1100×825 默认外窗、body 级全局 Tooltip，并生成五页 1100×825 与实时页 900×675 预览。

旧 `.github/workflows/p103-localsub-win-x64.yml` 属于编号错误历史，不再使用。

## 启动方式

v0.1.3 起普通双击或直接运行：

```powershell
.\LocalSub.exe
```

默认进入 Web UI。v0.1.5 默认窗口为 1100×825 的 4:3。迁移期如需旧 WinForms 备用界面：

```powershell
.\LocalSub.exe --legacy-ui
```

也可临时设置 `LOCALSUB_LEGACY_UI=1`。该备用入口只用于迁移期对照与尚未迁移页面，不是默认产品入口。

## 增量覆盖交付

Phase 1A 起，若本轮架构或 Core 有变化，最小覆盖集为：

```text
LocalSub.exe
LocalSub.Core.exe
```

覆盖前关闭 LocalSub。其余 `ASR/`、runtime、Assets、Components、config、现有模型和 FFmpeg 默认保持用户原目录不动。

正式 Release 仍需按照 GPT-Pub A/B 级规则记录 main 提交、Artifact、SHA-256 和验证结论。