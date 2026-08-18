# 模型策略

默认不随程序打包任何模型。模型由内置 catalog 提供官方下载地址，下载后解压到设置中的 ASR 根目录。默认根目录为 EXE 同级 `ASR`。

首批模型：

1. SenseVoice Small INT8，默认推荐，适合后台与模拟流式。
2. Streaming Paraformer bilingual zh/en，极速实时。
3. Streaming Paraformer trilingual zh/yue/en，粤语实时。
4. Fun-ASR-Nano INT8，高质量后台模式。

下载器支持显式 SOCKS5 代理，例如 `socks5://127.0.0.1:7890`，也支持包含用户名密码的 SOCKS5 URL。模型目录变更后只重新扫描，不自动移动原目录。
