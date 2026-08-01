//go:build !windows

package media

import (
	"fmt"
	"syscall"
)

func suspendProcess(pid int) error {
	if err := syscall.Kill(pid, syscall.SIGSTOP); err != nil {
		return fmt.Errorf("pause process %d: %w", pid, err)
	}
	return nil
}

func resumeProcess(pid int) error {
	if err := syscall.Kill(pid, syscall.SIGCONT); err != nil {
		return fmt.Errorf("resume process %d: %w", pid, err)
	}
	return nil
}
