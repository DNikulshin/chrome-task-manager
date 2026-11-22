/**
 * Единственное место, где живут задачи и настройки.
 * Хранилище — chrome.storage.local; запись всегда целым списком (атомарно),
 * поэтому гонок «частями» нет. Свой отзвук в onChanged отфильтрован.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Filter, Prefs, Task } from "@/types";
import {
  MAX_TASKS,
  clampText,
  countTasks,
  makeTask,
  normalizeOrder,
  reorderVisible,
  sortTasks,
} from "@/lib/tasks";
import { loadState, normalizePrefs, onTasksChanged, savePrefs, saveTasks } from "@/lib/storage";
import { t } from "@/lib/i18n";

export interface UndoEntry {
  tasks: Task[];
  message: string;
}

export interface Store {
  tasks: Task[];
  prefs: Prefs;
  counts: Record<Filter, number>;
  ready: boolean;
  error: string | null;
  undo: UndoEntry | null;
  /** Данные, перенесённые из версии 1.x/3.0 — показывается один раз. */
  migrated: { source: string; count: number } | null;
  dismissMigration: () => void;
  add: (text: string) => boolean;
  rename: (id: string, text: string) => void;
  toggleCompleted: (id: string) => void;
  togglePriority: (id: string) => void;
  remove: (id: string) => void;
  clearCompleted: () => void;
  reorder: (visible: Task[], fromId: string, toId: string) => void;
  replaceAll: (tasks: Task[], message: string) => void;
  runUndo: () => void;
  dismissUndo: () => void;
  setPrefs: (patch: Partial<Prefs>) => void;
}

const MAX_TRACKED_WRITES = 8;

export function useStore(): Store {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [prefs, setPrefsState] = useState<Prefs>(() => normalizePrefs(null));
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoEntry | null>(null);
  /**
   * Снимок для отмены держим ещё и в ref: колбэк из уведомления создаётся в том
   * же тике, что и setUndo, и через state увидел бы ещё старое значение.
   */
  const undoRef = useRef<UndoEntry | null>(null);
  const [migrated, setMigrated] = useState<{ source: string; count: number } | null>(null);

  /** Сериализованные снимки, которые записал этот документ: их отзвук игнорируем. */
  const written = useRef<string[]>([]);
  const tasksRef = useRef<Task[]>([]);
  tasksRef.current = tasks;

  const rememberWrite = useCallback((snapshot: string) => {
    written.current = [...written.current.slice(-MAX_TRACKED_WRITES + 1), snapshot];
  }, []);

  const persist = useCallback(
    (next: Task[]): Task[] => {
      const normalized = normalizeOrder(next);
      setTasks(normalized);
      rememberWrite(JSON.stringify(normalized));
      void saveTasks(normalized).catch((cause: unknown) => {
        console.error("storage write failed", cause);
        setError(t("errorStorageWrite"));
      });
      return normalized;
    },
    [rememberWrite],
  );

  // Первичная загрузка + миграция из прошлых версий.
  useEffect(() => {
    let cancelled = false;
    loadState()
      .then((result) => {
        if (cancelled) return;
        rememberWrite(JSON.stringify(result.tasks));
        setTasks(result.tasks);
        setPrefsState(result.prefs);
        if (result.changed && result.tasks.length && result.source !== "storage") {
          setMigrated({ source: result.source, count: result.tasks.length });
        }
        setReady(true);
      })
      .catch((cause: unknown) => {
        console.error("storage read failed", cause);
        if (cancelled) return;
        setError(t("errorStorageRead"));
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [rememberWrite]);

  // Изменения из другого окна панели.
  useEffect(() => {
    const unsubscribe = onTasksChanged((incoming) => {
      if (written.current.includes(JSON.stringify(incoming))) return;
      setTasks(incoming);
    });
    return unsubscribe;
  }, []);

  const pushUndo = useCallback((entry: UndoEntry) => {
    undoRef.current = entry;
    setUndo(entry);
  }, []);

  const setPrefs = useCallback(
    (patch: Partial<Prefs>) => {
      setPrefsState((prev) => {
        const next = normalizePrefs({ ...prev, ...patch });
        void savePrefs(next).catch(() => setError(t("errorStorageWrite")));
        return next;
      });
    },
    [setPrefsState],
  );

  const guardCapacity = useCallback((next: Task[]): boolean => {
    if (next.length <= MAX_TASKS) return true;
    setError(t("errorTooManyTasks", [String(MAX_TASKS)]));
    return false;
  }, []);

  const add = useCallback(
    (text: string): boolean => {
      const task = makeTask(text, { order: -1 });
      if (!task) return false;
      const next = [task, ...tasksRef.current];
      if (!guardCapacity(next)) return false;
      persist(next);
      return true;
    },
    [guardCapacity, persist],
  );

  const rename = useCallback(
    (id: string, text: string) => {
      const clean = clampText(text);
      if (!clean) return;
      persist(tasksRef.current.map((task) => (task.id === id ? { ...task, text: clean } : task)));
    },
    [persist],
  );

  const toggleCompleted = useCallback(
    (id: string) => {
      persist(tasksRef.current.map((task) => (task.id === id ? { ...task, completed: !task.completed } : task)));
    },
    [persist],
  );

  const togglePriority = useCallback(
    (id: string) => {
      persist(
        tasksRef.current.map((task) =>
          task.id === id ? { ...task, priority: task.priority === "high" ? "normal" : "high" } : task,
        ),
      );
    },
    [persist],
  );

  const remove = useCallback(
    (id: string) => {
      const target = tasksRef.current.find((task) => task.id === id);
      if (!target) return;
      pushUndo({ tasks: tasksRef.current, message: t("toastTaskDeleted") });
      persist(tasksRef.current.filter((task) => task.id !== id));
    },
    [persist, pushUndo],
  );

  const clearCompleted = useCallback(() => {
    const completed = tasksRef.current.filter((task) => task.completed).length;
    if (!completed) return;
    pushUndo({ tasks: tasksRef.current, message: t("toastCleared", [String(completed)]) });
    persist(tasksRef.current.filter((task) => !task.completed));
  }, [persist, pushUndo]);

  const reorder = useCallback(
    (visible: Task[], fromId: string, toId: string) => {
      persist(reorderVisible(tasksRef.current, visible, fromId, toId));
    },
    [persist],
  );

  const replaceAll = useCallback(
    (next: Task[], message: string) => {
      if (!guardCapacity(next)) return;
      pushUndo({ tasks: tasksRef.current, message });
      persist(normalizeOrder(next));
    },
    [guardCapacity, persist, pushUndo],
  );

  const runUndo = useCallback(() => {
    const entry = undoRef.current;
    if (!entry) return;
    undoRef.current = null;
    setUndo(null);
    persist(normalizeOrder(entry.tasks));
  }, [persist]);

  const dismissUndo = useCallback(() => {
    undoRef.current = null;
    setUndo(null);
  }, []);
  const dismissMigration = useCallback(() => setMigrated(null), []);

  const counts = useMemo(() => countTasks(tasks), [tasks]);
  const sortedTasks = useMemo(() => sortTasks(tasks), [tasks]);

  return {
    tasks: sortedTasks,
    prefs,
    counts,
    ready,
    error,
    undo,
    migrated,
    dismissMigration,
    add,
    rename,
    toggleCompleted,
    togglePriority,
    remove,
    clearCompleted,
    reorder,
    replaceAll,
    runUndo,
    dismissUndo,
    setPrefs,
  };
}
