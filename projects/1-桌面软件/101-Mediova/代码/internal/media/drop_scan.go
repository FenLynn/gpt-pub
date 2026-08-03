package media

import "os"

// DroppedScanResult is the complete, explicit outcome of decoding dropped
// filesystem paths. Every dropped path is either represented in Groups or
// counted as unsupported, unreadable, or a failed directory scan.
type DroppedScanResult struct {
	Groups      []DroppedImportGroup
	Unsupported int
	Unreadable  int
	ScanErrors  int
}

// ScanDroppedPaths performs filesystem work away from the Win32 message
// handler so the behavior can be tested without synthesizing GUI events.
func ScanDroppedPaths(paths []string, recursive bool) DroppedScanResult {
	result := DroppedScanResult{Groups: make([]DroppedImportGroup, 0, len(paths)+1)}
	direct := make([]string, 0, len(paths))

	for _, path := range paths {
		st, err := os.Stat(path)
		if err != nil {
			result.Unreadable++
			continue
		}
		if st.IsDir() {
			scan, err := ListMixedFiles(path, recursive)
			if err != nil {
				result.ScanErrors++
				continue
			}
			files := append(append([]string{}, scan.Videos...), scan.Images...)
			if len(files) > 0 {
				result.Groups = append(result.Groups, DroppedImportGroup{Root: ImportTreeRoot(path), Paths: files})
			}
			result.Unsupported += scan.Unsupported
			result.Unreadable += scan.Unreadable
			continue
		}
		if _, ok := DetectKind(path); !ok {
			result.Unsupported++
			continue
		}
		direct = append(direct, path)
	}

	if len(direct) > 0 {
		directGroups := GroupDirectMediaFiles(direct)
		result.Groups = append(directGroups, result.Groups...)
	}
	return result
}
