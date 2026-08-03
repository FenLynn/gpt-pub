//go:build windows

package config

func init() {
	path, err := Path()
	if err != nil {
		appendStartupConfigNotices("组件配置目录不可用：" + err.Error())
		return
	}

	// Keep this init independently safe. Package file ordering must not decide
	// whether component inheritance sees a recovered or migrated config.
	_, _ = prepareInstalledConfig(path)
	_, _ = migrateGoNamedInstalledConfig(path)

	settings := Load()
	changed, notices := NormalizeInheritedComponentSettings(&settings)
	if changed {
		if err := Save(settings); err != nil {
			notices = append(notices, "组件路径继承结果未能保存："+err.Error())
		} else if _, err := prepareInstalledConfig(path); err != nil {
			notices = append(notices, "组件路径继承后的配置保护未完成："+err.Error())
		}
	}
	appendStartupConfigNotices(notices...)
}
