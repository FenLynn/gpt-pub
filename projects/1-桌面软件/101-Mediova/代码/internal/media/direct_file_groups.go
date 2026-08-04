package media

import (
	"path"
	"sort"
	"strings"
	"unicode"
)

// DroppedImportGroup describes one output-tree context. Root is the source
// ancestor used to calculate relative paths. OutputPrefix is empty for a
// single source volume; when multiple volumes are dragged together it keeps
// otherwise identical directory trees isolated under a stable volume label.
type DroppedImportGroup struct {
	Root         string
	OutputPrefix string
	Paths        []string
}

type portablePath struct {
	volume     string
	separator  string
	absolute   bool
	components []string
}

func parsePortablePath(value string) portablePath {
	value = strings.TrimSpace(value)
	separator := "/"
	if strings.Contains(value, `\`) && !strings.Contains(value, "/") {
		separator = `\`
	}
	normalized := strings.ReplaceAll(value, `\`, "/")
	parsed := portablePath{separator: separator}

	// path.Clean intentionally collapses multiple leading slashes. Detect UNC
	// server/share authority before cleaning so distinct network volumes remain
	// distinct on both Windows and non-Windows test hosts.
	if strings.HasPrefix(normalized, "//") {
		uncBody := path.Clean(strings.TrimLeft(normalized, "/"))
		parts := splitPortableComponents(uncBody)
		if len(parts) >= 2 {
			parsed.volume = "//" + parts[0] + "/" + parts[1]
			parsed.absolute = true
			parsed.components = append([]string(nil), parts[2:]...)
			return parsed
		}
	}

	cleaned := path.Clean(normalized)
	if cleaned == "." && normalized != "." {
		cleaned = normalized
	}
	if len(cleaned) >= 2 && cleaned[1] == ':' && unicode.IsLetter(rune(cleaned[0])) {
		parsed.volume = strings.ToUpper(cleaned[:2])
		cleaned = strings.TrimPrefix(cleaned[2:], "/")
		parsed.absolute = true
	} else if strings.HasPrefix(cleaned, "/") {
		parsed.volume = "/"
		cleaned = strings.TrimPrefix(cleaned, "/")
		parsed.absolute = true
	}
	parsed.components = splitPortableComponents(cleaned)
	return parsed
}

func splitPortableComponents(value string) []string {
	if value == "" || value == "." {
		return nil
	}
	parts := strings.Split(value, "/")
	result := parts[:0]
	for _, part := range parts {
		if part == "" || part == "." {
			continue
		}
		result = append(result, part)
	}
	return result
}

func (p portablePath) directory() portablePath {
	if len(p.components) > 0 {
		p.components = append([]string(nil), p.components[:len(p.components)-1]...)
	}
	return p
}

func (p portablePath) parent() portablePath {
	if len(p.components) > 0 {
		p.components = append([]string(nil), p.components[:len(p.components)-1]...)
	}
	return p
}

func (p portablePath) string() string {
	joined := strings.Join(p.components, p.separator)
	switch {
	case strings.HasPrefix(p.volume, "//"):
		volume := strings.ReplaceAll(strings.TrimPrefix(p.volume, "//"), "/", p.separator)
		if joined == "" {
			return p.separator + p.separator + volume
		}
		return p.separator + p.separator + volume + p.separator + joined
	case len(p.volume) == 2 && p.volume[1] == ':':
		if joined == "" {
			return p.volume + p.separator
		}
		return p.volume + p.separator + joined
	case p.volume == "/":
		if joined == "" {
			return "/"
		}
		return "/" + strings.ReplaceAll(joined, p.separator, "/")
	default:
		return joined
	}
}

func portableVolumeKey(p portablePath) string {
	if p.volume == "" {
		return "."
	}
	return strings.ToLower(strings.ReplaceAll(p.volume, `\`, "/"))
}

func commonPortableDirectory(paths []portablePath) portablePath {
	if len(paths) == 0 {
		return portablePath{}
	}
	common := paths[0].directory()
	for _, candidatePath := range paths[1:] {
		candidate := candidatePath.directory()
		limit := len(common.components)
		if len(candidate.components) < limit {
			limit = len(candidate.components)
		}
		i := 0
		for i < limit && strings.EqualFold(common.components[i], candidate.components[i]) {
			i++
		}
		common.components = common.components[:i]
	}
	return common
}

func volumeOutputPrefix(volume string) string {
	volume = strings.TrimSpace(strings.ReplaceAll(volume, `\`, "/"))
	if volume == "" || volume == "/" || volume == "." {
		return "本地根目录"
	}
	if len(volume) == 2 && volume[1] == ':' {
		return strings.ToUpper(volume[:1]) + "盘"
	}
	volume = strings.TrimPrefix(volume, "//")
	parts := strings.FieldsFunc(volume, func(r rune) bool {
		return r == '/' || r == ':' || r == '\\' || unicode.IsSpace(r)
	})
	if len(parts) == 0 {
		return "其他卷"
	}
	return strings.Join(parts, "_")
}

// GroupDirectMediaFiles groups directly selected or dropped media by source
// volume. Within each volume it chooses the parent of the nearest common
// directory as Root, so the common top folder itself is retained in output.
// Multiple volumes receive stable prefixes encoded into Root so the context
// survives the existing task/session/queue lifecycle without a schema break.
func GroupDirectMediaFiles(values []string) []DroppedImportGroup {
	type volumeGroup struct {
		key    string
		volume string
		order  int
		paths  []string
		parsed []portablePath
	}
	groupsByKey := make(map[string]*volumeGroup)
	orderedKeys := make([]string, 0)
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		parsed := parsePortablePath(value)
		key := portableVolumeKey(parsed)
		group := groupsByKey[key]
		if group == nil {
			group = &volumeGroup{key: key, volume: parsed.volume, order: len(orderedKeys)}
			groupsByKey[key] = group
			orderedKeys = append(orderedKeys, key)
		}
		group.paths = append(group.paths, value)
		group.parsed = append(group.parsed, parsed)
	}
	if len(orderedKeys) == 0 {
		return nil
	}

	groups := make([]*volumeGroup, 0, len(orderedKeys))
	for _, key := range orderedKeys {
		groups = append(groups, groupsByKey[key])
	}
	sort.SliceStable(groups, func(i, j int) bool { return groups[i].order < groups[j].order })

	result := make([]DroppedImportGroup, 0, len(groups))
	multiVolume := len(groups) > 1
	for _, group := range groups {
		common := commonPortableDirectory(group.parsed)
		root := common
		if len(common.components) > 0 {
			root = common.parent()
		}
		prefix := ""
		if multiVolume {
			prefix = volumeOutputPrefix(group.volume)
		}
		plainRoot := root.string()
		result = append(result, DroppedImportGroup{
			Root:         EncodeRootContext(plainRoot, prefix),
			OutputPrefix: prefix,
			Paths:        append([]string(nil), group.paths...),
		})
	}
	return result
}
