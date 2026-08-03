//go:build windows

package config

import "strings"

func init() {
	path, err := Path()
	if err != nil {
		setStartupConfigNotice("配置目录不可用：" + err.Error())
		return
	}

	var notices []string
	source, prepareErr := prepareInstalledConfig(path)
	if prepareErr != nil {
		notices = append(notices, "配置保护未完成："+prepareErr.Error())
	} else {
		switch source {
		case "backup":
			notices = append(notices, "主配置异常，已从最近原子备份恢复。")
		case "lastgood":
			notices = append(notices, "主配置异常，已从最近有效配置恢复。")
		}
	}

	migrated, migrationErr := migrateGoNamedInstalledConfig(path)
	if migrationErr != nil {
		notices = append(notices, "原配置继承未完成："+migrationErr.Error())
	} else if migrated {
		notices = append(notices, "已继承原软件配置，并保留迁移前副本。")
		if _, err := prepareInstalledConfig(path); err != nil {
			notices = append(notices, "迁移后配置保护未完成："+err.Error())
		}
	}

	setStartupConfigNotice(strings.Join(notices, " "))
}
