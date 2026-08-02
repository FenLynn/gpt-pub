# Mediova

Mediova 是面向 Windows 10/11 x64 的本地媒体处理与创作工作站，统一处理视频与图片的批量导入、方向修正、转码、压缩、裁剪、兼容判断和结果校验。

## 当前入口

- 当前正式基线：[阶段记录](阶段记录.md)（Mediova v4.1.1，标签与 Release `p101-v4.1.1`）
- 当前工作与真实环境待验证项：[工作记录](工作记录.md)
- 项目长期规则：[开发约束](开发约束.md)
- 设计与演进：[软件开发总结](软件开发总结.md)
- v4.1.1 用户可见变化：[正式版本说明](Mediova_v4.1.1_版本说明.md)
- v4.1.0 历史版本说明：[Mediova_v4.1.0_版本说明.md](Mediova_v4.1.0_版本说明.md)
- v4.0.0 公开迁移证据：[迁移校验清单](迁移校验清单.md)

新对话必须先按 A｜`/GPT_RULES.md` → B｜`../开发约束.md` → C｜本项目 `开发约束.md` 读取约束，再读取本 README、阶段记录和工作记录。旧聊天记录只作为补充。

## 工程入口

- 正式路径：`projects/1-桌面软件/101-Mediova/`
- 源码：`代码/`
- 活动 CI：`.github/workflows/p101-mediova-ci.yml`
- 日常分支：`p101-exp`
- 稳定分支：`p101-stable`

构建完整 v4.1.1 Runtime：

```powershell
cd projects/1-桌面软件/101-Mediova/代码
./build_v4.1.1.ps1 -FFmpegBin "C:\path\to\ffmpeg\bin"
```

输出位于：

```text
代码/build/Runtime/
代码/build/Mediova-v4.1.1-Runtime.zip
代码/build/SHA256.txt
```

## 架构摘要

Mediova 保留一个直接启动的 `Mediova.exe`，公开运行依赖位于透明 Runtime，配置、历史、缓存和日志位于独立 Data。完整边界、迁移规则和设计原因分别以 `开发约束.md` 与 `软件开发总结.md` 为准，README 不重复保存完整架构。

## 分支与发布

```text
最新 main
→ p101-exp
→ PR：p101-exp → p101-stable
→ 完整准入与 UI 截图复核
→ PR：p101-stable → main
→ 标签与 Release
→ main 回流 p101-stable / p101-exp
```

正式标签和 Release 只能从 `main` 建立。P101 不得修改 AtlasDesk 的产品、CI、分支或发布记录。

## 版权

Copyright © 2026 FenLynn. All rights reserved.

项目源码未附带开源许可证。完整 Runtime 中的第三方组件按其自身许可证单独披露。