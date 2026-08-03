//go:build windows

package config

func init() {
	dir, err := appDataDir()
	if err != nil {
		appendStartupConfigNotices("持久化文件预检失败，配置、会话和历史将分别按各自默认策略加载：" + err.Error())
		return
	}
	appendStartupConfigNotices(preparePersistentSnapshots(dir)...)
}
