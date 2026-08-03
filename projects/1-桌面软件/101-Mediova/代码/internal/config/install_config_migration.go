package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"reflect"

	"mediaworkbench/internal/model"
)

// migrateGoNamedInstalledConfig upgrades settings written by early builds that
// used exported Go field names such as Resolution, Codec and Concurrency.
// Modern snake_case settings and the original v2.8.4 schema continue through
// the existing loader. A fresh installation is never materialised here.
func migrateGoNamedInstalledConfig(path string) (bool, error) {
	if path == "" {
		return false, errors.New("empty config path")
	}
	data, err := readPrimaryOrBackup(path)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}

	settings := model.DefaultSettings()
	// Apply any modern keys first. Mixed files occasionally appeared during
	// recovery builds; explicit legacy Go-name keys below remain authoritative.
	_ = json.Unmarshal(data, &settings)
	applied, err := applyGoNamedSettings(data, &settings)
	if err != nil {
		return false, err
	}
	if applied == 0 {
		return false, nil
	}
	normalize(&settings)

	encoded, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return false, err
	}
	if len(encoded) == 0 {
		return false, errors.New("empty migrated config")
	}

	// Keep one exact pre-migration copy. It is intentionally not deleted after
	// success so an inherited installation can always be inspected or rolled
	// back without relying on a transient atomic-write backup.
	if err := preserveLegacyConfig(path+".legacy", data); err != nil {
		return false, err
	}

	saveMu.Lock()
	defer saveMu.Unlock()
	if err := atomicWrite(path, encoded, 0o644); err != nil {
		return false, err
	}
	return true, nil
}

func applyGoNamedSettings(data []byte, settings *model.Settings) (int, error) {
	if settings == nil {
		return 0, errors.New("nil settings")
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return 0, err
	}

	value := reflect.ValueOf(settings).Elem()
	typ := value.Type()
	applied := 0
	for i := 0; i < typ.NumField(); i++ {
		fieldType := typ.Field(i)
		encoded, ok := raw[fieldType.Name]
		if !ok {
			continue
		}
		field := value.Field(i)
		if !field.CanSet() {
			continue
		}
		target := reflect.New(field.Type())
		if err := json.Unmarshal(encoded, target.Interface()); err != nil {
			return applied, fmt.Errorf("decode legacy setting %s: %w", fieldType.Name, err)
		}
		field.Set(target.Elem())
		applied++
	}
	return applied, nil
}

func preserveLegacyConfig(path string, data []byte) error {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		if os.IsExist(err) {
			return nil
		}
		return err
	}
	ok := false
	defer func() {
		_ = file.Close()
		if !ok {
			_ = os.Remove(path)
		}
	}()
	if _, err := file.Write(data); err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	ok = true
	return nil
}
