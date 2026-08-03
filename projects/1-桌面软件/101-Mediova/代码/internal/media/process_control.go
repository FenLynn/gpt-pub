package media

import (
	"context"
	"os"
	"sync"
)

type processControllerKey struct{}
type processSignalFunc func(int) error

// ProcessController tracks FFmpeg child processes belonging to one conversion run.
// State changes and operating-system signals are serialized under one lock so a
// concurrent Pause/Resume cannot leave the real process state behind the UI state.
type ProcessController struct {
	mu        sync.Mutex
	processes map[int]*os.Process
	paused    bool
	suspend   processSignalFunc
	resume    processSignalFunc
}

func NewProcessController() *ProcessController {
	return &ProcessController{
		processes: make(map[int]*os.Process),
		suspend:   suspendProcess,
		resume:    resumeProcess,
	}
}

func WithProcessController(ctx context.Context, c *ProcessController) context.Context {
	if c == nil {
		return ctx
	}
	return context.WithValue(ctx, processControllerKey{}, c)
}

func processControllerFromContext(ctx context.Context) *ProcessController {
	if ctx == nil {
		return nil
	}
	c, _ := ctx.Value(processControllerKey{}).(*ProcessController)
	return c
}

func (c *ProcessController) suspendPID(pid int) error {
	if c.suspend == nil {
		return suspendProcess(pid)
	}
	return c.suspend(pid)
}

func (c *ProcessController) resumePID(pid int) error {
	if c.resume == nil {
		return resumeProcess(pid)
	}
	return c.resume(pid)
}

func (c *ProcessController) register(p *os.Process) {
	if c == nil || p == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.processes == nil {
		c.processes = make(map[int]*os.Process)
	}
	c.processes[p.Pid] = p
	if c.paused {
		_ = c.suspendPID(p.Pid)
	}
}

func (c *ProcessController) unregister(p *os.Process) {
	if c == nil || p == nil {
		return
	}
	c.mu.Lock()
	delete(c.processes, p.Pid)
	c.mu.Unlock()
}

func (c *ProcessController) Pause() error {
	if c == nil {
		return nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.paused = true
	var first error
	for pid := range c.processes {
		if err := c.suspendPID(pid); err != nil && first == nil {
			first = err
		}
	}
	return first
}

func (c *ProcessController) Resume() error {
	if c == nil {
		return nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.paused = false
	var first error
	for pid := range c.processes {
		if err := c.resumePID(pid); err != nil && first == nil {
			first = err
		}
	}
	return first
}

func (c *ProcessController) IsPaused() bool {
	if c == nil {
		return false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.paused
}
