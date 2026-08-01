//go:build windows

package main

import (
    "crypto/sha256"
    "fmt"
    "os"
    "path/filepath"
)

func init() {
    if err := extractAdditionalPayload("PersonalWorkbench.TerminalHost.exe", 16*1024); err != nil {
        logLine("terminal host extraction failed: " + err.Error())
    }
}

func extractAdditionalPayload(name string, minimumBytes int) error {
    payload, err := payloadFS.ReadFile("payload/" + name)
    if err != nil {
        return fmt.Errorf("missing %s: %w", name, err)
    }
    if len(payload) < minimumBytes {
        return fmt.Errorf("%s is unexpectedly small: %d bytes", name, len(payload))
    }

    root := filepath.Join(os.Getenv("LOCALAPPDATA"), "PersonalWorkbench", "App", appVersion)
    if err := os.MkdirAll(root, 0o755); err != nil {
        return err
    }
    target := filepath.Join(root, name)
    wanted := sha256.Sum256(payload)
    if existing, readErr := os.ReadFile(target); readErr == nil && sha256.Sum256(existing) == wanted {
        return nil
    }

    temp := target + ".tmp"
    if err := os.WriteFile(temp, payload, 0o755); err != nil {
        return err
    }
    _ = os.Remove(target)
    if err := os.Rename(temp, target); err != nil {
        _ = os.Remove(temp)
        return err
    }
    logLine("additional payload extracted path=" + target)
    return nil
}
