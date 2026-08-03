//go:build windows

package config

func init() {
	path, err := Path()
	if err != nil {
		return
	}
	_, _ = migrateGoNamedInstalledConfig(path)
}
