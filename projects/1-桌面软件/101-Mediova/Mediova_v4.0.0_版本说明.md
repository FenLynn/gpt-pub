# Mediova v4.0.0

v4.0.0 是新产品名称 **Mediova** 的首个正式版本。它继承 v3.9.4 已验证的视频、图片、复杂媒体、DPI、大批量工作池、动态并发和 UI 能力，并将公开项目、Windows 资源、界面文字、导出文件和用户数据目录统一到 Mediova。

## 主要更新

- 窗口、托盘、通知、关于、诊断、历史页面和导出报告统一使用 Mediova；
- 正式 EXE 为 `Mediova_v4.0.0.exe`；
- Windows 文件版本、产品版本与产品名统一为 4.0.0 / Mediova；
- 新数据目录为 `%APPDATA%\Mediova` 与 `%LOCALAPPDATA%\Mediova`；
- 首次运行安全复制旧数据，新旧目录并存，不删除旧数据；
- 便携目录改为 `MediovaData`，并兼容复制旧 `VideoUprightData`；
- 保留任务包格式、配置结构和内部 Go 模块名称，避免无价值的兼容性破坏；
- 公开项目采用 P101 的 `exp → stable → main` 分层维护。

## 兼容性

本版不修改源媒体，不主动删除旧配置目录，也不改变现有任务和历史 JSON 的结构。旧版生成的配置、会话、历史和任务包继续可读。

## 版权

Copyright © 2026 FenLynn. All rights reserved. 本项目未附带开源许可证。
