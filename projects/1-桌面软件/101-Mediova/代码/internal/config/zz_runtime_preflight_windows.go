//go:build windows

package config

func init() {
	access := InspectRuntimeFFmpegAccess()
	if notice := RuntimeFFmpegAccessNotice(access); notice != "" {
		appendStartupConfigNotices(notice)
	}
}
