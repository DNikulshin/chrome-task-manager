/**
 * Доступ к chrome.storage.local + миграция данных из прошлых версий расширения.
 *
 * Версия 1.x хранила задачи в localStorage (ключ `tasks`), версия 3.0 — в
 * chrome.storage.local (ключ `tasks_v3`). Обе читаются один раз и переносятся в
 * `tasks` (схема 4). Исходные данные не теряются: копия кладётся в `legacyBackup`.
 */
import type { Filter, Prefs, Task } from "@/types";
import { normalizeOrder, normalizeTask, reindex } from "@/lib/tasks";
import { KEYS, LEGACY_LOCAL_STORAGE_KEY, SCHEMA_VERSION } from "@/lib/storageKeys";

export const DEFAULT_PREFS: Prefs = { compact: false, filter: "all" };

const FILTERS: readonly Filter[] = ["all", "active", "completed"];

export function normalizePrefs(raw: unknown): Prefs {
  const rec = (raw ?? {}) as Record<string, unknown>;
  const filter = FILTERS.includes(rec.filter as Filter) ? (rec.filter as Filter) : DEFAULT_PREFS.filter;
  return { compact: rec.compact === true, filter };
}

function toTaskList(raw: unknown): Task[] {
  if (!Array.isArray(raw)) return [];
  const tasks: Task[] = [];
  raw.forEach((item, index) => {
    const task = normalizeTask(item, index);
    if (task) tasks.push(task);
  });
  return normalizeOrder(tasks);
}

/** localStorage есть только у страниц расширения; при недоступности — пусто. */
export function readLegacyLocalStorage(): Task[] {
  try {
    const raw = globalThis.localStorage?.getItem(LEGACY_LOCAL_STORAGE_KEY);
    if (!raw) return [];
    return toTaskList(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function clearLegacyLocalStorage(): void {
  try {
    globalThis.localStorage?.removeItem(LEGACY_LOCAL_STORAGE_KEY);
  } catch {
    /* localStorage может быть недоступен — не критично */
  }
}

export interface MigrationResult {
  tasks: Task[];
  prefs: Prefs;
  /** Откуда взялись задачи: актуальный ключ, v3, v1 или ничего. */
  source: "storage" | "v3" | "v1" | "v3+v1" | "empty";
  changed: boolean;
}

function mergeById(primary: Task[], secondary: Task[]): { tasks: Task[]; added: number } {
  const ids = new Set(primary.map((task) => task.id));
  const texts = new Set(primary.map((task) => `${task.text}\u0000${task.createdAt}`));
  const added: Task[] = [];
  for (const task of secondary) {
    if (ids.has(task.id)) continue;
    // Одна и та же задача, перенесённая двумя путями (v1 → v3 → v4), не дублируется.
    if (texts.has(`${task.text}\u0000${task.createdAt}`)) continue;
    ids.add(task.id);
    added.push(task);
  }
  return { tasks: [...primary, ...added], added: added.length };
}

/**
 * Читает задачи и настройки, при необходимости переносит их из старых ключей.
 * Идемпотентна: повторный вызов при уже записанной схеме ничего не меняет.
 */
export async function loadState(): Promise<MigrationResult> {
  const stored = await chrome.storage.local.get([KEYS.tasks, KEYS.prefs, KEYS.schema, KEYS.legacyV3]);
  const prefs = normalizePrefs(stored[KEYS.prefs]);

  if (stored[KEYS.schema] === SCHEMA_VERSION && Array.isArray(stored[KEYS.tasks])) {
    return { tasks: toTaskList(stored[KEYS.tasks]), prefs, source: "storage", changed: false };
  }

  const current = toTaskList(stored[KEYS.tasks]);
  const fromV3 = toTaskList(stored[KEYS.legacyV3]);
  const fromV1 = readLegacyLocalStorage();

  let tasks = current;
  const parts: string[] = [];
  if (fromV3.length) {
    tasks = mergeById(tasks, fromV3).tasks;
    parts.push("v3");
  }
  if (fromV1.length) {
    tasks = mergeById(tasks, fromV1).tasks;
    parts.push("v1");
  }
  const source = (parts.join("+") || (current.length ? "storage" : "empty")) as MigrationResult["source"];

  // Порядок сборки: текущий ключ → v3 → v1. Пере-сортировка здесь недопустима.
  tasks = reindex(tasks);
  const changed = tasks.length > 0 || fromV3.length > 0 || fromV1.length > 0;

  if (fromV3.length || fromV1.length) {
    // Копия исходных данных — на случай, если перенос что-то испортил.
    await chrome.storage.local.set({
      [KEYS.legacy]: {
        createdAt: new Date().toISOString(),
        tasksV3: stored[KEYS.legacyV3] ?? null,
        localStorageV1: fromV1.length ? fromV1 : null,
      },
    });
    clearLegacyLocalStorage();
  }

  if (changed) {
    await chrome.storage.local.set({ [KEYS.tasks]: tasks, [KEYS.schema]: SCHEMA_VERSION });
  }
  return { tasks, prefs, source, changed };
}

export async function saveTasks(tasks: readonly Task[]): Promise<void> {
  await chrome.storage.local.set({ [KEYS.tasks]: tasks, [KEYS.schema]: SCHEMA_VERSION });
}

export async function savePrefs(prefs: Prefs): Promise<void> {
  await chrome.storage.local.set({ [KEYS.prefs]: prefs });
}

/**
 * Подписка на изменения списка задач (другое окно панели, соседняя вкладка).
 * Возвращает функцию отписки. Собственные записи отфильтровывает вызывающая сторона.
 */
export function onTasksChanged(callback: (tasks: Task[]) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
    if (areaName !== "local" || !changes[KEYS.tasks]) return;
    callback(toTaskList(changes[KEYS.tasks].newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export function isQuotaError(error: unknown): boolean {
  return error instanceof Error && /quota|QUOTA/i.test(error.message);
}
