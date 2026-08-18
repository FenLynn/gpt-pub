//go:build !windows

package media

import (
	"context"
	"fmt"
)

func ProbeModernImageWIC(context.Context, string) (ProbeInfo, error) {
	return ProbeInfo{}, fmt.Errorf("Windows HEIF 图像扩展仅在 Windows 上可用")
}

func DecodeModernImageToPNG(context.Context, string, string) (ProbeInfo, error) {
	return ProbeInfo{}, fmt.Errorf("Windows HEIF 图像扩展仅在 Windows 上可用")
}
