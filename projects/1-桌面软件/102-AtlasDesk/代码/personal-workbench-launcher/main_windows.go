//go:build windows

package main

import (
    "crypto/sha256"
    "embed"
    "errors"
    "fmt"
    "io"
    "net/http"
    "os"
    "os/exec"
    "path/filepath"
    "sort"
    "strings"
    "syscall"
    "time"
    "unsafe"
)

const (
    productName       = "AtlasDesk"
    legacyStorageName = "PersonalWorkbench"
    appVersion        = "0.3.1"
    dotnetURL         = "https://aka.ms/dotnet/8.0/windowsdesktop-runtime-win-x64.exe"
    webviewURL        = "https://go.microsoft.com/fwlink/p/?LinkId=2124703"

    mbOK              = 0x00000000
    mbYesNo           = 0x00000004
    mbIconError       = 0x00000010
    mbIconInformation = 0x00000040
    mbTopMost         = 0x00040000
    idYes             = 6
)

// The build workflow places the framework-dependent WPF application here.
//go:embed payload/*
var payloadFS embed.FS

var (
    user32          = syscall.NewLazyDLL("user32.dll")
    messageBoxWProc = user32.NewProc("MessageBoxW")
)

func main() {
    migrateLegacyRoamingData()
    logLine("launcher start version=" + appVersion)

    missingDotnet := !hasDotNetDesktop8()
    missingWebView := !hasWebView2Runtime()

    if missingDotnet || missingWebView {
        names := make([]string, 0, 2)
        if missingDotnet {
            names = append(names, ".NET 8 Desktop Runtime (x64)")
        }
        if missingWebView {
            names = append(names, "Microsoft Edge WebView2 Runtime")
        }

        text := "检测到缺少以下运行组件：\n\n• " + strings.Join(names, "\n• ") +
            "\n\n是否立即从微软官方下载并安装？安装结束后 AtlasDesk 会自动启动。"
        if messageBox(productName, text, mbYesNo|mbIconInformation|mbTopMost) != idYes {
            logLine("dependency installation declined")
            return
        }

        if err := installMissingDependencies(missingDotnet, missingWebView); err != nil {
            logLine("dependency installation failed: " + err.Error())
            messageBox(productName, "运行组件安装失败：\n\n"+err.Error()+"\n\n请检查网络或管理员权限后重试。", mbOK|mbIconError|mbTopMost)
            return
        }

        time.Sleep(1500 * time.Millisecond)
        if !hasDotNetDesktop8() || !hasWebView2Runtime() {
            logLine("dependency verification failed after installer")
            messageBox(productName, "安装程序已结束，但仍未检测到所需运行组件。请重新启动电脑后再试；若仍失败，请手动安装 .NET 8 Desktop Runtime 与 WebView2 Runtime。", mbOK|mbIconError|mbTopMost)
            return
        }
    }

    appPath, err := extractApplication()
    if err != nil {
        logLine("payload extraction failed: " + err.Error())
        messageBox(productName, "AtlasDesk 程序释放失败：\n\n"+err.Error(), mbOK|mbIconError|mbTopMost)
        return
    }

    cmd := exec.Command(appPath)
    cmd.Dir = filepath.Dir(appPath)
    cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
    if err := cmd.Start(); err != nil {
        logLine("application start failed: " + err.Error())
        messageBox(productName, "AtlasDesk 启动失败：\n\n"+err.Error(), mbOK|mbIconError|mbTopMost)
        return
    }
    logLine("application started pid=" + fmt.Sprint(cmd.Process.Pid))
}

func installMissingDependencies(dotnet, webview bool) error {
    tempDir, err := os.MkdirTemp("", productName+"-Setup-")
    if err != nil {
        return fmt.Errorf("无法创建临时目录：%w", err)
    }
    defer os.RemoveAll(tempDir)

    client := &http.Client{Timeout: 20 * time.Minute}

    if dotnet {
        messageBox(productName, "即将下载并安装 .NET 8 Desktop Runtime。下载期间请稍候，随后可能出现 Windows 管理员确认窗口。", mbOK|mbIconInformation|mbTopMost)
        installer := filepath.Join(tempDir, "windowsdesktop-runtime-8-win-x64.exe")
        if err := downloadFile(client, dotnetURL, installer); err != nil {
            return fmt.Errorf("下载 .NET 8 Desktop Runtime 失败：%w", err)
        }
        if err := runInstaller(installer, "/install", "/quiet", "/norestart"); err != nil {
            return fmt.Errorf("安装 .NET 8 Desktop Runtime 失败：%w", err)
        }
    }

    if webview {
        messageBox(productName, "即将下载并安装 WebView2 Runtime。下载期间请稍候，随后可能出现 Windows 管理员确认窗口。", mbOK|mbIconInformation|mbTopMost)
        installer := filepath.Join(tempDir, "MicrosoftEdgeWebview2Setup.exe")
        if err := downloadFile(client, webviewURL, installer); err != nil {
            return fmt.Errorf("下载 WebView2 Runtime 失败：%w", err)
        }
        if err := runInstaller(installer, "/silent", "/install"); err != nil {
            return fmt.Errorf("安装 WebView2 Runtime 失败：%w", err)
        }
    }

    return nil
}

func downloadFile(client *http.Client, url, destination string) error {
    logLine("download start url=" + url)
    req, err := http.NewRequest(http.MethodGet, url, nil)
    if err != nil {
        return err
    }
    req.Header.Set("User-Agent", productName+"/"+appVersion)

    resp, err := client.Do(req)
    if err != nil {
        return err
    }
    defer resp.Body.Close()
    if resp.StatusCode < 200 || resp.StatusCode >= 300 {
        return fmt.Errorf("服务器返回 HTTP %d", resp.StatusCode)
    }

    file, err := os.Create(destination)
    if err != nil {
        return err
    }
    _, copyErr := io.Copy(file, resp.Body)
    closeErr := file.Close()
    if copyErr != nil {
        return copyErr
    }
    if closeErr != nil {
        return closeErr
    }

    info, err := os.Stat(destination)
    if err != nil {
        return err
    }
    if info.Size() < 100*1024 {
        return fmt.Errorf("下载文件异常，大小仅 %d 字节", info.Size())
    }
    logLine(fmt.Sprintf("download complete bytes=%d", info.Size()))
    return nil
}

func runInstaller(path string, args ...string) error {
    logLine("installer start file=" + filepath.Base(path))
    cmd := exec.Command(path, args...)
    cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
    err := cmd.Run()
    if err == nil {
        logLine("installer exit=0")
        return nil
    }

    var exitErr *exec.ExitError
    if errors.As(err, &exitErr) {
        code := exitErr.ExitCode()
        logLine(fmt.Sprintf("installer exit=%d", code))
        if code == 0 || code == 3010 {
            return nil
        }
        return fmt.Errorf("安装程序退出代码 %d", code)
    }
    return err
}

func hasDotNetDesktop8() bool {
    candidates := uniqueNonEmpty([]string{
        filepath.Join(os.Getenv("ProgramW6432"), "dotnet", "dotnet.exe"),
        filepath.Join(os.Getenv("ProgramFiles"), "dotnet", "dotnet.exe"),
        filepath.Join(os.Getenv("DOTNET_ROOT"), "dotnet.exe"),
        "dotnet.exe",
    })

    for _, candidate := range candidates {
        cmd := exec.Command(candidate, "--list-runtimes")
        cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
        output, err := cmd.Output()
        if err != nil {
            continue
        }
        for _, line := range strings.Split(string(output), "\n") {
            if strings.HasPrefix(strings.TrimSpace(line), "Microsoft.WindowsDesktop.App 8.") {
                logLine("dotnet desktop runtime detected via " + candidate)
                return true
            }
        }
    }
    logLine("dotnet desktop runtime 8 not detected")
    return false
}

func hasWebView2Runtime() bool {
    roots := uniqueNonEmpty([]string{
        filepath.Join(os.Getenv("ProgramFiles(x86)"), "Microsoft", "EdgeWebView", "Application"),
        filepath.Join(os.Getenv("ProgramFiles"), "Microsoft", "EdgeWebView", "Application"),
        filepath.Join(os.Getenv("LOCALAPPDATA"), "Microsoft", "EdgeWebView", "Application"),
    })

    for _, root := range roots {
        matches, _ := filepath.Glob(filepath.Join(root, "*", "msedgewebview2.exe"))
        if len(matches) > 0 {
            sort.Strings(matches)
            logLine("webview2 runtime detected path=" + matches[len(matches)-1])
            return true
        }
    }
    logLine("webview2 runtime not detected")
    return false
}

func extractApplication() (string, error) {
    payload, err := payloadFS.ReadFile("payload/PersonalWorkbench.App.exe")
    if err != nil {
        return "", errors.New("安装包中缺少内部应用载荷")
    }
    if len(payload) < 256*1024 {
        return "", fmt.Errorf("内置程序文件异常，大小仅 %d 字节", len(payload))
    }

    sum := sha256.Sum256(payload)
    root := filepath.Join(os.Getenv("LOCALAPPDATA"), productName, "App", appVersion)
    if err := os.MkdirAll(root, 0o755); err != nil {
        return "", err
    }
    target := filepath.Join(root, "AtlasDesk.App.exe")

    if existing, err := os.ReadFile(target); err == nil {
        existingSum := sha256.Sum256(existing)
        if existingSum == sum {
            return target, nil
        }
    }

    temp := target + ".tmp"
    if err := os.WriteFile(temp, payload, 0o755); err != nil {
        return "", err
    }
    _ = os.Remove(target)
    if err := os.Rename(temp, target); err != nil {
        _ = os.Remove(temp)
        return "", err
    }
    logLine("application payload extracted path=" + target)
    return target, nil
}

func migrateLegacyRoamingData() {
    appData := strings.TrimSpace(os.Getenv("APPDATA"))
    if appData == "" {
        return
    }
    legacy := filepath.Join(appData, legacyStorageName)
    target := filepath.Join(appData, productName)
    if _, err := os.Stat(target); err == nil {
        return
    }
    if _, err := os.Stat(legacy); err != nil {
        return
    }
    if err := os.Rename(legacy, target); err == nil {
        return
    }
    if err := copyDirectory(legacy, target); err != nil {
        _ = os.RemoveAll(target)
    }
}

func copyDirectory(source, target string) error {
    return filepath.Walk(source, func(path string, info os.FileInfo, walkErr error) error {
        if walkErr != nil {
            return walkErr
        }
        relative, err := filepath.Rel(source, path)
        if err != nil {
            return err
        }
        destination := filepath.Join(target, relative)
        if info.IsDir() {
            return os.MkdirAll(destination, info.Mode().Perm())
        }
        input, err := os.Open(path)
        if err != nil {
            return err
        }
        defer input.Close()
        if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
            return err
        }
        output, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, info.Mode().Perm())
        if err != nil {
            return err
        }
        _, copyErr := io.Copy(output, input)
        closeErr := output.Close()
        if copyErr != nil {
            return copyErr
        }
        return closeErr
    })
}

func messageBox(title, text string, flags uintptr) int {
    titlePtr, _ := syscall.UTF16PtrFromString(title)
    textPtr, _ := syscall.UTF16PtrFromString(text)
    result, _, _ := messageBoxWProc.Call(0, uintptr(unsafe.Pointer(textPtr)), uintptr(unsafe.Pointer(titlePtr)), flags)
    return int(result)
}

func uniqueNonEmpty(values []string) []string {
    seen := make(map[string]struct{}, len(values))
    result := make([]string, 0, len(values))
    for _, value := range values {
        value = strings.TrimSpace(value)
        if value == "" {
            continue
        }
        key := strings.ToLower(value)
        if _, ok := seen[key]; ok {
            continue
        }
        seen[key] = struct{}{}
        result = append(result, value)
    }
    return result
}

func logLine(message string) {
    appData := os.Getenv("APPDATA")
    if appData == "" {
        return
    }
    dir := filepath.Join(appData, productName, "logs")
    if err := os.MkdirAll(dir, 0o755); err != nil {
        return
    }
    file, err := os.OpenFile(filepath.Join(dir, "launcher.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
    if err != nil {
        return
    }
    defer file.Close()
    _, _ = fmt.Fprintf(file, "%s %s\n", time.Now().Format("2006-01-02 15:04:05.000"), message)
}
