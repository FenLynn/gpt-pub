# LocalSub 架构

## 核心模块

- LiveCapture: PotPlayer Process Loopback / Windows All Audio Loopback
- ModelManager: 模型 catalog、目录扫描、下载、校验、删除、升级
- DownloadClient: 直连、系统代理、显式 SOCKS5
- Recognizer: streaming / offline 统一接口
- SubtitleOverlay: WebView2 + HTML/CSS
- BatchEngine: 媒体解码、波形、VAD、离线 ASR、关键词标记
- TranscriptStore: 结构化项目数据与 TXT 导出

## 数据流

实时：AudioCapture -> 16 kHz mono float -> Recognizer -> Transcript -> HTML Overlay

后台：Video/File -> Media Decode -> Waveform + VAD -> Offline Recognizer -> Keyword Marker -> Transcript -> HTML/TXT
