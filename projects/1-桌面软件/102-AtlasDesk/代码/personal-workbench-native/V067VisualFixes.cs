using System.Windows;
using System.Windows.Controls;
using System.Windows.Markup;

namespace PersonalWorkbench;

public sealed class V067VisualFixes
{
    private V067VisualFixes()
    {
        InstallReadableToolTips();
    }

    public static V067VisualFixes Attach() => new();

    private static void InstallReadableToolTips()
    {
        const string xaml = """
<Style xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
       xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
       TargetType="{x:Type ToolTip}">
    <Setter Property="Foreground" Value="#27384F"/>
    <Setter Property="Background" Value="#FFFDFE"/>
    <Setter Property="BorderBrush" Value="#D6E0EB"/>
    <Setter Property="BorderThickness" Value="1"/>
    <Setter Property="Padding" Value="9,6"/>
    <Setter Property="FontFamily" Value="Segoe UI, Microsoft YaHei UI"/>
    <Setter Property="FontSize" Value="11.5"/>
    <Setter Property="HasDropShadow" Value="False"/>
    <Setter Property="Template">
        <Setter.Value>
            <ControlTemplate TargetType="{x:Type ToolTip}">
                <Border Background="{TemplateBinding Background}"
                        BorderBrush="{TemplateBinding BorderBrush}"
                        BorderThickness="{TemplateBinding BorderThickness}"
                        CornerRadius="7"
                        Padding="{TemplateBinding Padding}"
                        SnapsToDevicePixels="True">
                    <Border.Effect>
                        <DropShadowEffect Color="#51647C" BlurRadius="12" ShadowDepth="2" Opacity="0.16"/>
                    </Border.Effect>
                    <ContentPresenter Content="{TemplateBinding Content}"
                                      ContentTemplate="{TemplateBinding ContentTemplate}"
                                      TextElement.Foreground="{TemplateBinding Foreground}"
                                      TextElement.FontFamily="{TemplateBinding FontFamily}"
                                      TextElement.FontSize="{TemplateBinding FontSize}"/>
                </Border>
            </ControlTemplate>
        </Setter.Value>
    </Setter>
</Style>
""";

        try
        {
            Application.Current.Resources[typeof(ToolTip)] = (Style)XamlReader.Parse(xaml);
        }
        catch (Exception ex)
        {
            App.Log("Install v0.6.7 tooltip style failed: " + ex.Message);
        }
    }
}
