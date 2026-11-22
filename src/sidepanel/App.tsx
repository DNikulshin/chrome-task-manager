import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { Task } from "@/types";
import { backupFileName, filterTasks, parseBackup, serializeBackup } from "@/lib/tasks";
import { t } from "@/lib/i18n";
import { useStore } from "@/hooks/useStore";
import { usePanelPort } from "@/hooks/usePanelPort";
import { Menu } from "@/components/Menu";
import { SearchBox } from "@/components/SearchBox";
import { FilterBar } from "@/components/FilterBar";
import { TaskForm } from "@/components/TaskForm";
import { TaskList } from "@/components/TaskList";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useToast } from "@/components/Toasts";
import { CompactIcon, RowsIcon } from "@/components/icons";

interface PendingImport {
  tasks: Task[];
  skipped: number;
  truncated: number;
}

export default function App() {
  const store = useStore();
  const toast = useToast();
  usePanelPort();

  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Task | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [, forceTick] = useState(0);

  const {
    tasks, prefs, counts, ready, error, migrated,
    add, rename, toggleCompleted, togglePriority, remove, clearCompleted,
    reorder, replaceAll, runUndo, dismissMigration, setPrefs,
  } = store;

  const visible = useMemo(() => filterTasks(tasks, prefs.filter, query), [tasks, prefs.filter, query]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Относительные даты («5 мин назад») должны обновляться сами.
  useEffect(() => {
    const timer = window.setInterval(() => forceTick((value) => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (migrated) {
      toast(t("toastMigrated", [String(migrated.count)]), { tone: "success" });
      dismissMigration();
    }
  }, [migrated, toast, dismissMigration]);

  useEffect(() => {
    if (error) toast(error, { tone: "error" });
  }, [error, toast]);

  // Alt+A / Alt+S / Esc — только когда фокус не в поле ввода текста задачи.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey && !event.ctrlKey && !event.metaKey && (event.code === "KeyA" || event.code === "KeyS")) {
        event.preventDefault();
        if (event.code === "KeyA") {
          setEditing(null);
          inputRef.current?.focus();
        } else {
          searchRef.current?.focus();
        }
        return;
      }
      if (event.key !== "Escape") return;
      if (editing) {
        setEditing(null);
        return;
      }
      if (query) {
        setQuery("");
        return;
      }
      (document.activeElement as HTMLElement | null)?.blur();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [editing, query]);

  useEffect(() => {
    if (ready && !editing) inputRef.current?.focus();
  }, [ready, editing]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      reorder(visible, String(active.id), String(over.id));
    },
    [reorder, visible],
  );

  const handleCopy = useCallback(
    (task: Task) => {
      navigator.clipboard.writeText(task.text).then(
        () => toast(t("toastCopied"), { tone: "success" }),
        () => toast(t("toastCopyFailed"), { tone: "error" }),
      );
    },
    [toast],
  );

  const handleExport = useCallback(() => {
    const blob = new Blob([serializeBackup(store.tasks)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = backupFileName();
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(t("toastExported"), { tone: "success" });
  }, [store.tasks, toast]);

  const handleImport = useCallback(
    async (file: File) => {
      const text = await file.text().catch(() => null);
      if (text === null) {
        toast(t("toastImportFailed"), { tone: "error" });
        return;
      }
      const result = parseBackup(text);
      if (!result.ok) {
        toast(result.error === "empty" ? t("toastImportEmpty") : t("toastImportFailed"), { tone: "error" });
        return;
      }
      setPendingImport({ tasks: result.tasks, skipped: result.skipped, truncated: result.truncated });
    },
    [toast],
  );

  const confirmImport = useCallback(() => {
    if (!pendingImport) return;
    const { tasks: imported, skipped, truncated } = pendingImport;
    const message = skipped || truncated ? t("toastImportedSkipped", [String(imported.length), String(skipped + truncated)]) : t("toastImported", [String(imported.length)]);
    replaceAll(imported, message);
    setPendingImport(null);
    toast(message, { tone: "success", action: { label: t("toastUndo"), onClick: runUndo } });
  }, [pendingImport, replaceAll, runUndo, toast]);

  const handleDelete = useCallback(
    (task: Task) => setDeleteTarget(task),
    [],
  );

  const confirmDelete = useCallback(() => {
    if (!deleteTarget) return;
    remove(deleteTarget.id);
    setDeleteTarget(null);
    toast(t("toastTaskDeleted"), { action: { label: t("toastUndo"), onClick: runUndo } });
  }, [deleteTarget, remove, runUndo, toast]);

  const handleClearCompleted = useCallback(() => {
    const removed = counts.completed;
    if (!removed) return;
    clearCompleted();
    toast(t("toastCleared", [String(removed)]), { action: { label: t("toastUndo"), onClick: runUndo } });
  }, [clearCompleted, counts.completed, runUndo, toast]);

  const emptyMessage = query ? t("emptySearch") : tasks.length ? t("emptyFilter") : t("emptyNone");
  const activeCount = counts.active;

  return (
    <div className={`panel${prefs.compact ? " compact" : ""}`}>
      <div className="panel-top">
        <header className="panel-header">
          <h1 className="panel-title">
            {t("appTitle")}
            <small>
              {activeCount}/{counts.all}
            </small>
          </h1>
          <div className="header-actions">
            <button
              type="button"
              className="icon-btn"
              aria-pressed={prefs.compact}
              title={prefs.compact ? t("headerCompactOn") : t("headerCompactOff")}
              aria-label={prefs.compact ? t("headerCompactOn") : t("headerCompactOff")}
              onClick={() => setPrefs({ compact: !prefs.compact })}
            >
              {prefs.compact ? <RowsIcon size={15} /> : <CompactIcon size={15} />}
            </button>
            <Menu
              onExport={handleExport}
              onImport={handleImport}
              onClearCompleted={handleClearCompleted}
              canClearCompleted={counts.completed > 0}
            />
          </div>
        </header>

        <TaskForm
          editing={editing}
          inputRef={inputRef}
          onSubmit={add}
          onUpdate={(id, text) => {
            rename(id, text);
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />

        <div className="tools">
          <SearchBox value={query} onChange={setQuery} inputRef={searchRef} />
          <FilterBar
            filter={prefs.filter}
            counts={counts}
            onChange={(filter) => setPrefs({ filter })}
            onClearCompleted={handleClearCompleted}
          />
        </div>
      </div>

      <main className="panel-list">
        {ready ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <TaskList
              tasks={visible}
              query={query}
              canReorder
              emptyMessage={emptyMessage}
              onToggle={toggleCompleted}
              onTogglePriority={togglePriority}
              onEdit={(task) => setEditing(task)}
              onDelete={handleDelete}
              onCopy={handleCopy}
            />
          </DndContext>
        ) : (
          <div className="empty">
            <p>…</p>
          </div>
        )}
      </main>

      <footer className="panel-foot">
        <div>{t("hintKeys")}</div>
        <div>{t("hintReorder")}</div>
      </footer>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("dialogDeleteTitle")}
        message={t("dialogDeleteBody")}
        confirmLabel={t("taskDelete")}
        cancelLabel={t("formCancel")}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={pendingImport !== null}
        title={t("dialogImportTitle")}
        message={t("dialogImportBody", [String(pendingImport?.tasks.length ?? 0)])}
        confirmLabel={t("menuImport")}
        cancelLabel={t("formCancel")}
        tone="primary"
        onConfirm={confirmImport}
        onCancel={() => setPendingImport(null)}
      />
    </div>
  );
}
