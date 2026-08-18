# Build

目标为 Windows x64 self-contained 绿色包。模型不进入发布目录。CI 构建应执行 `dotnet publish -c Release -r win-x64 --self-contained true`，然后将 publish 目录整体压缩为 ZIP。
