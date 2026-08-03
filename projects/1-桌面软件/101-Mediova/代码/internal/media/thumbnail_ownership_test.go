package media

import "testing"

func TestThumbnailOwnershipRejectsStaleGeneration(t *testing.T) {
	o := NewThumbnailOwnership()
	g1 := o.NextGeneration(1)
	g2 := o.NextGeneration(1)
	if g1 == g2 || o.Current(1, g1) || !o.Current(1, g2) {
		t.Fatalf("generations g1=%d g2=%d", g1, g2)
	}
	if stale, _ := o.Assign(1, g1, "old.bmp"); !stale {
		t.Fatal("stale generation unexpectedly assigned")
	}
	if stale, orphan := o.Assign(1, g2, "new.bmp"); stale || orphan != "" {
		t.Fatalf("assign stale=%v orphan=%q", stale, orphan)
	}
}

func TestThumbnailOwnershipDeletesOnlyFinalSharedOwner(t *testing.T) {
	o := NewThumbnailOwnership()
	g1 := o.NextGeneration(1)
	g2 := o.NextGeneration(2)
	if stale, _ := o.Assign(1, g1, "shared.bmp"); stale {
		t.Fatal("task 1 assignment was stale")
	}
	if stale, _ := o.Assign(2, g2, "shared.bmp"); stale {
		t.Fatal("task 2 assignment was stale")
	}
	if got := o.RefCount("shared.bmp"); got != 2 {
		t.Fatalf("refs=%d want=2", got)
	}
	if path, orphan := o.Release(1); path != "shared.bmp" || orphan {
		t.Fatalf("first release path=%q orphan=%v", path, orphan)
	}
	if path, orphan := o.Release(2); path != "shared.bmp" || !orphan {
		t.Fatalf("final release path=%q orphan=%v", path, orphan)
	}
}

func TestThumbnailOwnershipReplacementReturnsOldOrphan(t *testing.T) {
	o := NewThumbnailOwnership()
	g := o.NextGeneration(7)
	if stale, _ := o.Assign(7, g, "one.bmp"); stale {
		t.Fatal("first assignment stale")
	}
	if stale, orphan := o.Assign(7, g, "two.bmp"); stale || orphan != "one.bmp" {
		t.Fatalf("replacement stale=%v orphan=%q", stale, orphan)
	}
	if path, orphan := o.Release(7); path != "two.bmp" || !orphan {
		t.Fatalf("release path=%q orphan=%v", path, orphan)
	}
}

func TestThumbnailReleaseInvalidatesPendingGeneration(t *testing.T) {
	o := NewThumbnailOwnership()
	g := o.NextGeneration(9)
	if path, orphan := o.Release(9); path != "" || orphan {
		t.Fatalf("empty release path=%q orphan=%v", path, orphan)
	}
	if o.Current(9, g) {
		t.Fatal("released task still accepts pending generation")
	}
}
