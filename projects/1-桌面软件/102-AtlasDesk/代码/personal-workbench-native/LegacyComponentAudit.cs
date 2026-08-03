namespace PersonalWorkbench;

public sealed record LegacyComponentDescriptor(
    string TypeName,
    string Responsibility,
    string RetirementBoundary);

public static class LegacyComponentAudit
{
    public static IReadOnlyList<LegacyComponentDescriptor> Retained { get; } =
        new[]
        {
            new LegacyComponentDescriptor(
                "V067VisualFixes",
                "早期 XAML 视觉纠偏入口",
                "仅保留现有修复；不得继续增加页面或生命周期职责"),
            new LegacyComponentDescriptor(
                "V061ExperienceEnhancer",
                "首页、全局搜索与既有模块桥接",
                "由显式 Home/Settings 页面所有权保护；后续新体验功能进入职责命名协调器"),
            new LegacyComponentDescriptor(
                "V063ProjectEnhancer",
                "项目中心弹窗入口与工作区/终端跳转",
                "不再扩展项目业务；下一阶段使用 ProjectWorkflowCoordinator 或新职责组件"),
            new LegacyComponentDescriptor(
                "V066BackupEnhancer",
                "备份与迁移弹窗入口",
                "仅负责单窗口入口；备份数据逻辑保持独立服务"),
            new LegacyComponentDescriptor(
                "V069UiFixEnhancer",
                "窗口外壳、树模板、Zotero 视觉与终端可靠性兼容",
                "WorkArea 已由 ShellResilienceCoordinator 接管；焦点与键盘由 AccessibilityCoordinator 最后覆盖"),
            new LegacyComponentDescriptor(
                "V0610TerminalPresentationEnhancer",
                "终端呈现兼容层",
                "不得接管终端传输或会话生命周期"),
            new LegacyComponentDescriptor(
                "V0611CorrectiveEnhancer",
                "既有页面纠偏与交互兼容",
                "不得新增业务模块或全局生命周期订阅"),
            new LegacyComponentDescriptor(
                "V0612ExperienceEnhancer",
                "首页、资料库及常用页面的既有体验润色",
                "仅保留已验证行为；新的 UI 规则统一进入 UiConvergenceCoordinator")
        };

    public static IReadOnlySet<string> RetainedTypeNames { get; } =
        Retained.Select(item => item.TypeName).ToHashSet(StringComparer.Ordinal);

    public static DiagnosticCheck CreateDiagnosticCheck()
        => new()
        {
            Name = "遗留层职责审计",
            Severity = DiagnosticSeverity.Ok,
            Detail = $"已冻结 {Retained.Count} 个历史兼容组件；禁止新增版本号组件，下一阶段必须使用职责命名并保持单一所有者"
        };
}
