//go:build !windows

package media

import "os/exec"

func configureCommand(cmd *exec.Cmd) {}
