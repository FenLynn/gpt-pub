package media

import (
	"encoding/base64"
	"path/filepath"
	"strings"
	"unicode"
)

const rootContextPrefix = "mediova-root-v1|"

// NormalizeOutputPrefix reduces a generated or restored volume label to one
// safe directory component. It never permits a session value to escape the
// configured output root.
func NormalizeOutputPrefix(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	var b strings.Builder
	lastSeparator := false
	for _, r := range value {
		allowed := unicode.IsLetter(r) || unicode.IsNumber(r) ||
			r == ' ' || r == '-' || r == '_' || r == '(' || r == ')' || r == '.'
		if allowed {
			b.WriteRune(r)
			lastSeparator = false
			continue
		}
		if !lastSeparator {
			b.WriteByte('_')
			lastSeparator = true
		}
	}
	result := strings.Trim(b.String(), " ._-")
	for strings.Contains(result, "..") {
		result = strings.ReplaceAll(result, "..", ".")
	}
	runes := []rune(result)
	if len(runes) > 64 {
		result = string(runes[:64])
	}
	return strings.Trim(result, " ._-")
}

// EncodeRootContext stores a multi-volume output prefix inside the existing
// persistent Root field. This preserves compatibility with old sessions while
// allowing the prefix to survive restart, hold/edit, and queue recovery.
func EncodeRootContext(root, outputPrefix string) string {
	outputPrefix = NormalizeOutputPrefix(outputPrefix)
	if outputPrefix == "" {
		return root
	}
	encoded := base64.RawURLEncoding.EncodeToString([]byte(outputPrefix))
	return rootContextPrefix + encoded + "|" + root
}

// DecodeRootContext returns the real source root and its optional output
// prefix. Malformed values safely fall back to the original root string.
func DecodeRootContext(value string) (root, outputPrefix string) {
	if !strings.HasPrefix(value, rootContextPrefix) {
		return value, ""
	}
	rest := strings.TrimPrefix(value, rootContextPrefix)
	separator := strings.IndexByte(rest, '|')
	if separator <= 0 {
		return value, ""
	}
	decoded, err := base64.RawURLEncoding.DecodeString(rest[:separator])
	if err != nil {
		return value, ""
	}
	outputPrefix = NormalizeOutputPrefix(string(decoded))
	if outputPrefix == "" {
		return value, ""
	}
	return rest[separator+1:], outputPrefix
}

// ResolveRootContext decodes persisted multi-volume context and, for files
// selected through the file dialog, derives a common top-folder root from the
// dialog's LastInputDir. Empty legacy roots remain flat when no reliable
// selection directory is available.
func ResolveRootContext(input, root, lastInputDir string) (sourceRoot, outputPrefix string) {
	sourceRoot, outputPrefix = DecodeRootContext(root)
	if strings.TrimSpace(sourceRoot) != "" {
		return sourceRoot, outputPrefix
	}
	lastInputDir = strings.TrimSpace(lastInputDir)
	if lastInputDir == "" {
		return "", outputPrefix
	}
	inputDir := filepath.Dir(input)
	rel, err := filepath.Rel(lastInputDir, inputDir)
	if err != nil || (rel != "." && (rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)))) {
		return "", outputPrefix
	}
	parent := filepath.Dir(filepath.Clean(lastInputDir))
	if parent == "." || parent == "" {
		return "", outputPrefix
	}
	return parent, outputPrefix
}

// OutputRootWithPrefix applies one safe prefix to a configured output root.
func OutputRootWithPrefix(outputRoot, outputPrefix string) string {
	outputPrefix = NormalizeOutputPrefix(outputPrefix)
	if outputPrefix == "" {
		return outputRoot
	}
	return filepath.Join(outputRoot, outputPrefix)
}

// OutputRootForContext applies the safe prefix stored in Root to one configured
// output root.
func OutputRootForContext(outputRoot, rootContext string) string {
	_, prefix := DecodeRootContext(rootContext)
	return OutputRootWithPrefix(outputRoot, prefix)
}
