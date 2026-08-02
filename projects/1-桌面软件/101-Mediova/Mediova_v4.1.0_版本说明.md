# Mediova v4.1.0 版本说明

> 当前状态：已正式发布。标签与 GitHub Release 为 `p101-v4.1.0`。

## 版本定位

Mediova v4.1.0 是 v4.0.0 公开基线后的首个架构与界面升级版本。它不改变本地媒体批处理的核心定位，也不通过删减能力制造“轻量版”，而是集中解决两类长期问题：

1. 统一界面底色、边线、图标、按钮状态、进度和压缩体积表达；
2. 把可公开运行组件从 AppData 中移出，建立轻量透明 Runtime 与独立 Data。

## 界面改进

### 全局视觉与状态反馈

- 主界面采用统一底色，减少层层卡片、白块、厚重底纹和重复框线；
- 分区主要依靠留白、对齐和极淡分隔线；
- 顶部主图标缩小并统一尺寸；
- 顶部文件操作按钮默认背景透明，仅保留淡边线；
- 右侧参数区与底部参数栏使用统一控件语言；
- 可点击按钮统一默认、悬停、按下、选中、禁用五态；
- FFmpeg、GPU、PotPlayer 等状态灯放大到接近文字高度；
- 开始、暂停、停止使用一致的实心操作按钮体系；
- 禁用状态保持可辨认，不与普通输入框混淆。

### 输出母目录

- “输出目录”统一改为“输出母目录”；
- 支持可编辑地址、最近使用目录、自动去重与数量限制；
- 支持浏览选择文件夹和直接打开当前目录；
- 清除地址栏和底部参数区重复边框造成的黑线。

### 进度与压缩体积条

- 进度条和体积条改为单层绘制；
- 未完成区域只保留极淡背景；
- 文字在完整条形区域内水平和垂直居中；
- 行内条形保持完整行高和统一上下留白；
- 体积条按照输入体积与输出体积总和绘制真实左右比例，而不是把压缩率直接当作条形宽度。

颜色规则：

- 变化在 ±10% 内：黄色；
- 输出变大但最终仍小于 15 MB：黄色，优先级最高；
- 明显压缩：绿色，压缩越多颜色越深；
- 明显增长：红色，增长越多颜色越深。

上述比例、颜色和几何规则均有自动测试覆盖。

### 参数宽度与布局

- 输出分辨率、格式、质量、体积和旋转下拉框不再机械等宽；
- 宽度根据常用内容与可用空间分别确定；
- 不为极端最长文本无限增加宽度；
- 顶部严格保持单行，底部操作区保持稳定布局；
- 自动几何测试继续覆盖 DPI 和窗口尺寸基线。

## Runtime/Data 架构升级

### 透明 Runtime

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

- `Mediova.exe` 仍是唯一直接主程序；
- 不增加启动器、后台服务或无必要宿主；
- FFmpeg、FFprobe 和相关 DLL 位于 `Components/FFmpeg/bin/`；
- 正式运行组件不再作为 Data 存入 AppData；
- Runtime 可以公开、复制、覆盖、校验和删除后重建；
- Runtime 不依赖上一次运行留下的隐藏组件才能启动。

### 独立 Data

```text
%APPDATA%\Mediova
```

保存配置、历史、会话和备份。

```text
%LOCALAPPDATA%\Mediova
```

保存缓存、临时文件、缩略图、本机状态、日志和崩溃信息。

正式 Runtime ZIP 不包含配置、历史、日志、缓存、私人路径、真实媒体、Token 或凭据。

### Runtime 清单与第三方说明

`runtime-manifest.json` 记录产品、版本、平台、部署形态以及每个 Runtime 文件的相对路径、大小和 SHA-256。正式准入和发布补全均会重新展开 Runtime，并逐文件校验路径、大小与哈希。

完整 Runtime 包含 `THIRD_PARTY_NOTICES.md`，说明 FFmpeg 的来源、许可证与运行时分发边界。Mediova 源码未附带开源 LICENSE，仍保留全部权利；第三方二进制按其自身许可证处理。

## 旧组件迁移

v4.1.0 对旧 `%LOCALAPPDATA%\Mediova\ffmpeg` 采用保守迁移：

- Runtime 已有有效 `ffmpeg.exe` 与 `ffprobe.exe` 时不迁移；
- Runtime 缺失且旧组件完整时只复制缺失文件；
- 不删除旧目录；
- 不覆盖 Runtime 已有文件；
- 复制后验证组件对；
- 旧 AppData 配置路径在 Runtime 有效时自动归一化；
- 用户明确指定的系统路径、外部目录或自定义构建不会被强制改写。

配置、历史和会话格式继续兼容 v4.0.0。

## 安装与更新

首次部署必须下载并解压完整：

```text
Mediova-v4.1.0-Runtime.zip
```

建议把完整 `Mediova` 文件夹放在用户有写权限的位置，并从文件夹内启动 `Mediova.exe`。不要只复制主程序，否则 Runtime 组件和清单可能缺失。

覆盖或重建 Runtime 不会自动删除 `%APPDATA%\Mediova` 和 `%LOCALAPPDATA%\Mediova`。更新前仍建议保留 Data 备份。

后续若只修改单个公开运行文件，可以按 Runtime 原相对路径提供增量更新；多个组件或目录结构变化时继续交付完整 Runtime ZIP。

## 构建

```powershell
cd projects/1-桌面软件/101-Mediova/代码
./build_v4.1.0.ps1 -FFmpegBin "C:\path\to\ffmpeg\bin"
```

输出：

```text
build/
├── Runtime/
├── Mediova-v4.1.0-Runtime.zip
└── SHA256.txt
```

构建脚本完成测试、`go vet`、主程序资源嵌入、组件复制、Runtime 清单、逐文件 SHA-256 和 ZIP 打包。

## 正式来源与验证

- 正式源提交：`27435598978ec8e16944742ce0de7c56f489dded`
- 正式源文件树：`8021b5621eb0db7a0a054e3e41d07cec35ebc593`
- 正式主线 PR：`#83`
- 正式主线 CI：`30727129758`
- 正式 Artifact：`P101-Mediova-v4.1.0-CI`
- Release 补全运行：`30728888940`
- 标签与正式源提交比较：`identical`

验证覆盖：

- P101 自动范围门禁；
- Linux 与 Windows Go 全量测试；
- 竞态检查与 `go vet`；
- 真实 FFmpeg/FFprobe；
- 完整 Runtime 构建与展开复核；
- Runtime manifest 逐文件大小与 SHA-256；
- 私人 Data 泄漏检查；
- 正式原生自检 57/57。

正式资产：

```text
Mediova.exe
大小：3,761,152 bytes
SHA-256：f4a084b365b50712dbffb45f19b4098782212caf25dcc9d61eb8defe8a894d81

Mediova-v4.1.0-Runtime.zip
大小：116,138,263 bytes
SHA-256：df4ec8c4db0b84b501faefebf81da84b1463fe69f8c53b234ad24d9e882f4f04
```

- Runtime manifest：通过
- 私人 Data 扫描：通过
- 原生自检：57/57
- Authenticode：`NotSigned`

## 已知后续工作

以下项目不属于 v4.1.0 已完成功能，继续保留在 `工作记录.md`：

- 真实 Windows 10/11、多显示器、特殊 DPI、显卡驱动和播放器长期观察；
- 右键菜单；
- 裁剪时间轴与预览优化；
- 文件级暂停和安全恢复；
- HEIC/HEIF；
- 手机 MOV 与 HDR 扩展；
- 音视频轨道选择；
- 字幕编辑与批量封装；
- 视频分段；
- 无损拼接与合并。

## 发布边界

- 正式标签与 Release：`p101-v4.1.0`；
- 正式资产只来源于 `main` 的已验证文件树；
- 正式交付以完整 Runtime ZIP 为主；
- Release 不包含任何私人 Data；
- 当前资产未进行 Authenticode 签名；
- P101 不修改 AtlasDesk 产品、CI、分支或发布记录。
