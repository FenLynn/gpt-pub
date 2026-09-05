//go:build windows

package config

func init() {
	dir, err := appDataDir()
	if err != nil {
		// The persistent snapshot preflight reports path-resolution failures and
		// keeps the three data files isolated. Avoid duplicating the same notice.
		return
	}
	if notice := DataDirectoryAccessNotice(InspectDataDirectoryAccess(dir)); notice != "" {
		appendStartupConfigNotices(notice)
	}
}
