package media

import (
	"context"
	"os"
	"sync"
)

type processControllerKey struct{}

// ProcessController tracks FFmpeg child processes belonging to one conversion run.
// It allows the desktop app to pause/resume the actual encoders instead of merely
// delaying the next queued task.
type ProcessController struct {
	mu        sync.Mutex
	processes map[int]*os.Process
	paused    bool
}

func NewProcessController() *ProcessController {
	return &ProcessController{processes: make(map[int]*os.Process)}
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

func (c *ProcessController) register(p *os.Process) {
	if c == nil || p == nil {
		return
	}
	c.mu.Lock()
	c.processes[p.Pid] = p
	paused := c.paused
	c.mu.Unlock()
	if paused {
		_ = suspendProcess(p.Pid)
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
	c.paused = true
	pids := make([]int, 0, len(c.processes))
	for pid := range c.processes {
		pids = append(pids, pid)
	}
	c.mu.Unlock()
	var first error
	for _, pid := range pids {
		if err := suspendProcess(pid); err != nil && first == nil {
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
	c.paused = false
	pids := make([]int, 0, len(c.processes))
	for pid := range c.processes {
		pids = append(pids, pid)
	}
	c.mu.Unlock()
	var first error
	for _, pid := range pids {
		if err := resumeProcess(pid); err != nil && first == nil {
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
