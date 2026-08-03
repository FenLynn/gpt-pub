package media

import (
	"os"
	"sync"
	"testing"
	"time"
)

func TestProcessControllerSerializesPauseAndResumeSignals(t *testing.T) {
	suspendEntered := make(chan struct{})
	releaseSuspend := make(chan struct{})
	resumeEntered := make(chan struct{})
	var onceSuspend, onceResume sync.Once
	controller := &ProcessController{
		processes: map[int]*os.Process{42: {Pid: 42}},
		suspend: func(int) error {
			onceSuspend.Do(func() { close(suspendEntered) })
			<-releaseSuspend
			return nil
		},
		resume: func(int) error {
			onceResume.Do(func() { close(resumeEntered) })
			return nil
		},
	}

	pauseDone := make(chan error, 1)
	go func() { pauseDone <- controller.Pause() }()
	<-suspendEntered
	resumeAttempted := make(chan struct{})
	resumeDone := make(chan error, 1)
	go func() {
		close(resumeAttempted)
		resumeDone <- controller.Resume()
	}()
	<-resumeAttempted
	select {
	case <-resumeEntered:
		t.Fatal("resume signal overtook an in-flight pause signal")
	case <-time.After(100 * time.Millisecond):
	}
	close(releaseSuspend)
	if err := <-pauseDone; err != nil {
		t.Fatal(err)
	}
	select {
	case <-resumeEntered:
	case <-time.After(time.Second):
		t.Fatal("resume signal did not run after pause completed")
	}
	if err := <-resumeDone; err != nil {
		t.Fatal(err)
	}
	if controller.IsPaused() {
		t.Fatal("controller remained paused after serialized resume")
	}
}

func TestProcessControllerSerializesPausedRegistrationAndResume(t *testing.T) {
	suspendEntered := make(chan struct{})
	releaseSuspend := make(chan struct{})
	resumeEntered := make(chan struct{})
	controller := &ProcessController{
		processes: make(map[int]*os.Process),
		paused:    true,
		suspend: func(int) error {
			close(suspendEntered)
			<-releaseSuspend
			return nil
		},
		resume: func(int) error {
			close(resumeEntered)
			return nil
		},
	}
	registered := make(chan struct{})
	go func() {
		controller.register(&os.Process{Pid: 7})
		close(registered)
	}()
	<-suspendEntered
	resumeDone := make(chan error, 1)
	go func() { resumeDone <- controller.Resume() }()
	select {
	case <-resumeEntered:
		t.Fatal("resume overtook paused process registration")
	case <-time.After(100 * time.Millisecond):
	}
	close(releaseSuspend)
	<-registered
	select {
	case <-resumeEntered:
	case <-time.After(time.Second):
		t.Fatal("resume did not reconcile the newly registered process")
	}
	if err := <-resumeDone; err != nil {
		t.Fatal(err)
	}
	if controller.IsPaused() {
		t.Fatal("controller remained paused after registration race")
	}
}
