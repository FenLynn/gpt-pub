import { useCallback, useState } from "react";

interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
}

export function useHistoryState<T>(initialValue: T, limit = 80) {
  const [history, setHistory] = useState<HistoryState<T>>({
    past: [],
    present: initialValue,
    future: []
  });

  const commit = useCallback(
    (updater: T | ((current: T) => T)) => {
      setHistory((current) => {
        const next =
          typeof updater === "function"
            ? (updater as (value: T) => T)(current.present)
            : updater;

        if (Object.is(next, current.present)) return current;

        return {
          past: [...current.past, current.present].slice(-limit),
          present: next,
          future: []
        };
      });
    },
    [limit]
  );

  const updateWithoutHistory = useCallback(
    (updater: T | ((current: T) => T)) => {
      setHistory((current) => {
        const next =
          typeof updater === "function"
            ? (updater as (value: T) => T)(current.present)
            : updater;
        if (Object.is(next, current.present)) return current;
        return { ...current, present: next };
      });
    },
    []
  );

  const replace = useCallback((value: T) => {
    setHistory({ past: [], present: value, future: [] });
  }, []);

  const undo = useCallback(() => {
    setHistory((current) => {
      if (current.past.length === 0) return current;
      const previous = current.past[current.past.length - 1];
      return {
        past: current.past.slice(0, -1),
        present: previous,
        future: [current.present, ...current.future]
      };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory((current) => {
      if (current.future.length === 0) return current;
      const next = current.future[0];
      return {
        past: [...current.past, current.present].slice(-limit),
        present: next,
        future: current.future.slice(1)
      };
    });
  }, [limit]);

  return {
    value: history.present,
    commit,
    updateWithoutHistory,
    replace,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0
  };
}
