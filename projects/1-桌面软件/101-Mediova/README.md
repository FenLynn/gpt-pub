# Mediova

Mediova 是面向 Windows 10/11 x64 的本地媒体处理与创作工作站。当前正式版本为 **v4.0.0**，当前候选版本为 **v4.1.0**。v4.1.0 已完成界面统一、输出母目录增强、真实压缩体积条和轻量 Runtime/Data 分离，正在按正式分支流程完成准入与发布。

## 新对话接续顺序

后续新建对话或自动化代理在修改软件前，应按以下顺序阅读：

1. [开发约束](开发约束.md)：项目边界、Runtime/Data、界面、测试、分支和发布硬约束；
2. [软件开发总结](软件开发总结.md)：软件从早期版本到 v4.1.0 的发展脉络与架构结论；
3. [工作记录](工作记录.md)：已完成、进行中、计划和暂缓项目的实时状态；
4. [阶段记录](阶段记录.md)：当前候选、正式版本和固定验证结果；
5. [迁移校验清单](迁移校验清单.md)：v4.0.0 公开迁移与仓库切换验收；
6. [v4.1.0 版本说明](Mediova_v4.1.0_版本说明.md)：当前候选版本的功能、架构和部署变化。

旧聊天记录只能作为补充，仓库内上述文件是后续接续的主要依据。

## 当前能力

- 视频与图片批量导入、文件夹递归、中文路径和混合队列；
- 自动方向修正、缩放、时长裁剪和画面裁剪；
- H.264/H.265、质量、码率和目标体积模式；
- JPG/PNG 图片处理；
- 多音轨、文本字幕、位图字幕安全处理和 VFR；
- NVENC、QSV、AMF 检测及失败自动回退 CPU；
- 动态并发、大批量扫描保护、任务状态闭环和输出完整性检查；
- 配置、历史和会话恢复；
- PotPlayer 源文件与输出文件对比；
- Windows 原生自检和真实 FFmpeg Runtime 验证。

## v4.1.0 界面方向

v4.1.0 使用统一底色和轻边线，减少层层底纹与重复框线。顶部工具栏保持单行，图标、状态灯、折叠按钮、右侧参数区和底部参数栏采用统一尺寸与五态交互。

输出区域统一为“输出母目录”，支持可编辑地址、最近目录、浏览和直接打开当前目录。进度条与体积条使用单层绘制，文字在条内居中。体积条按输入与输出的真实体积比例显示，黄色优先覆盖 ±10% 和“输出变大但仍小于 15 MB”，明显压缩使用分级绿色，明显增长使用分级红色。

## v4.1.0 Runtime/Data 架构

v4.1.0 保留一个直接启动的 `Mediova.exe`，但完整交付改为透明 Runtime 文件夹：

```text
Mediova/
├── Mediova.exe
├── Components/
│   └── FFmpeg/
│       └── bin/
├── runtime-manifest.json
├── THIRD_PARTY_NOTICES.md
└── README.txt
```

Runtime 只包含可公开、可替换、可重新下载的程序和组件。配置、历史、缓存、日志和私人路径不会进入 Runtime 或 Release。

Data 继续使用：

```text
%APPDATA%\Mediova       # 配置、历史、会话和备份
%LOCALAPPDATA%\Mediova  # 缓存、临时文件、缩略图、本机状态和崩溃信息
```

旧 `%LOCALAPPDATA%\Mediova\ffmpeg` 仅在 Runtime 缺少有效组件时复制到 `Components\FFmpeg\bin`；旧目录不会删除，Runtime 已有文件不会覆盖。用户明确选择的外部 FFmpeg 路径不会被强制改写。

## 构建

进入源码目录：

```powershell
cd projects/1-桌面软件/101-Mediova/代码
```

构建完整 v4.1.0 Runtime：

```powershell
./build_v4.1.0.ps1 -FFmpegBin "C:\path\to\ffmpeg\bin"
```

输出：

```text
build/
├── Runtime/
│   ├── Mediova.exe
│   ├── Components/FFmpeg/bin/
│   ├── runtime-manifest.json
│   ├── THIRD_PARTY_NOTICES.md
│   └── README.txt
├── Mediova-v4.1.0-Runtime.zip
└── SHA256.txt
```

构建脚本会执行测试、`go vet`、资源嵌入、组件复制、Runtime 清单生成、逐文件 SHA-256 和完整 ZIP 打包。CI 中普通测试与竞态测试使用相互独立的 Data 根目录。

## 部署和更新

v4.1.0 因部署形态发生变化，首次必须解压完整 Runtime ZIP，不应只替换一个 EXE。建议把整个 `Mediova` 文件夹放在用户有写权限的位置，然后直接启动 `Mediova.exe`。

Runtime 和 Data 独立，因此覆盖或重建 Runtime 不会自动删除 `%APPDATA%\Mediova` 与 `%LOCALAPPDATA%\Mediova`。任何更新前仍建议保留 Data 备份。

后续只有单个公开运行文件变化时，可以提供按 Runtime 原相对路径组织的增量更新；多个组件或目录结构变化时，应继续提供完整 Runtime ZIP。

## 分支

```text
p101-exp → p101-stable → main → 标签与 Release → 回流 p101-stable / p101-exp
```

日常开发只在 `p101-exp` 推进；完整验收后提升到 `p101-stable`；正式版本只从 `main` 建立标签和 Release。P101 不得修改 AtlasDesk 的产品目录、源码、CI、分支或发布记录。

## 版权与第三方组件

Mediova 源码未附带开源 LICENSE，保留全部权利。完整 Runtime 中的 FFmpeg 属于独立第三方组件，其来源和许可证在 `THIRD_PARTY_NOTICES.md` 中说明。
