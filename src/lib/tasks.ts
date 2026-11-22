/**
 * Чистая доменная логика списка задач: сортировка, фильтры, поиск, экспорт/импорт.
 * Никакого DOM и chrome.* — всё покрыто юнит-тестами (tasks.test.ts).
 */
import type { BackupFile, Filter, Priority, Task } from "@/types";
import { SCHEMA_VERSION } from "@/lib/storageKeys";

export const MAX_TEXT = 500;
/** Верхняя граница на количество задач: полный список пишется в storage целиком. */
export const MAX_TASKS = 2000;

const PRIORITIES: readonly Priority[] = ["high", "normal"];

export function clampText(text: string): string {
  return text.trim().slice(0, MAX_TEXT);
}

export function isPriority(value: unknown): value is Priority {
  return typeof value === "string" && (PRIORITIES as readonly string[]).includes(value);
}

export function newId(): string {
  // crypto.randomUUID есть во всех целевых версиях Chrome (>=92).
  return crypto.randomUUID();
}

export function makeTask(text: string, opts: { order?: number; now?: number } = {}): Task | null {
  const clean = clampText(text);
  if (!clean) return null;
  return {
    id: newId(),
    text: clean,
    createdAt: opts.now ?? Date.now(),
    order: opts.order ?? 0,
    completed: false,
    priority: "normal",
  };
}

/**
 * Приводит произвольную запись из storage/файла к Task.
 * Возвращает null, если восстановить нечего (нет текста).
 */
export function normalizeTask(raw: unknown, fallbackOrder = 0): Task | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const text = typeof rec.text === "string" ? clampText(rec.text) : "";
  if (!text) return null;
  const createdAt = typeof rec.createdAt === "number" && Number.isFinite(rec.createdAt) ? rec.createdAt : Date.now();
  const order = typeof rec.order === "number" && Number.isFinite(rec.order) ? rec.order : fallbackOrder;
  return {
    id: typeof rec.id === "string" && rec.id ? rec.id : newId(),
    text,
    createdAt,
    order,
    completed: rec.completed === true,
    priority: isPriority(rec.priority) ? rec.priority : "normal",
  };
}

/** Сортировка для отображения: только по order, при равенстве — по времени создания. */
export function sortTasks(tasks: readonly Task[]): Task[] {
  return [...tasks].sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}

/** Присваивает order по позиции в переданном массиве (порядок не меняется). */
export function reindex(tasks: readonly Task[]): Task[] {
  return tasks.map((task, index) => (task.order === index ? task : { ...task, order: index }));
}

/** Сортирует по order и перенумеровывает в 0..n-1. */
export function normalizeOrder(tasks: readonly Task[]): Task[] {
  return reindex(sortTasks(tasks));
}

export function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

/** Фильтр по статусу + поиск по всем словам запроса (регистронезависимо). */
export function filterTasks(tasks: readonly Task[], filter: Filter, query = ""): Task[] {
  let list = sortTasks(tasks);
  if (filter === "active") list = list.filter((task) => !task.completed);
  if (filter === "completed") list = list.filter((task) => task.completed);
  const tokens = tokenize(query);
  if (tokens.length) {
    list = list.filter((task) => {
      const haystack = task.text.toLowerCase();
      return tokens.every((token) => haystack.includes(token));
    });
  }
  return list;
}

export function countTasks(tasks: readonly Task[]): Record<Filter, number> {
  let active = 0;
  for (const task of tasks) if (!task.completed) active += 1;
  return { all: tasks.length, active, completed: tasks.length - active };
}

export function arrayMove<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Перестановка внутри отфильтрованного списка: позиции скрытых задач не двигаются.
 * Так drag&drop работает и при активном фильтре/поиске, не сбивая order остальных.
 */
export function reorderVisible(all: readonly Task[], visible: readonly Task[], fromId: string, toId: string): Task[] {
  const fromIdx = visible.findIndex((task) => task.id === fromId);
  const toIdx = visible.findIndex((task) => task.id === toId);
  if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return sortTasks(all);

  const sorted = sortTasks(all);
  const visibleIds = new Set(visible.map((task) => task.id));
  const slots: number[] = [];
  sorted.forEach((task, index) => {
    if (visibleIds.has(task.id)) slots.push(index);
  });

  const moved = arrayMove(visible, fromIdx, toIdx);
  const next = [...sorted];
  slots.forEach((slot, index) => {
    next[slot] = moved[index];
  });
  return reindex(next);
}

export interface HighlightPart {
  text: string;
  match: boolean;
}

/** Разбивает текст на подсвеченные/обычные куски. React рендерит их как текст — XSS невозможен. */
export function highlightParts(text: string, query: string): HighlightPart[] {
  const tokens = tokenize(query);
  if (!tokens.length) return [{ text, match: false }];
  const pattern = tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const re = new RegExp(`(${pattern})`, "gi");
  const parts: HighlightPart[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match[0].length === 0) {
      re.lastIndex += 1;
      continue;
    }
    if (match.index > last) parts.push({ text: text.slice(last, match.index), match: false });
    parts.push({ text: match[0], match: true });
    last = match.index + match[0].length;
  }
  if (!parts.length) return [{ text, match: false }];
  if (last < text.length) parts.push({ text: text.slice(last), match: false });
  return parts;
}

export function serializeBackup(tasks: readonly Task[], now = new Date()): string {
  const payload: BackupFile = {
    app: "chrome-task-manager",
    version: SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    tasks: sortTasks(tasks),
  };
  return JSON.stringify(payload, null, 2);
}

export function backupFileName(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `tasks-${stamp}.json`;
}

export type ParseResult =
  | { ok: true; tasks: Task[]; skipped: number; truncated: number }
  | { ok: false; error: "not-json" | "not-a-list" | "empty" };

/**
 * Разбор файла импорта. Битые элементы пропускаются, а не валят весь импорт;
 * старые форматы (просто массив, `tasks_v3`) поддерживаются.
 */
export function parseBackup(raw: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, error: "not-json" };
  }
  const list = Array.isArray(data) ? data : (data as { tasks?: unknown } | null)?.tasks;
  if (!Array.isArray(list)) return { ok: false, error: "not-a-list" };

  const tasks: Task[] = [];
  const seenIds = new Set<string>();
  let skipped = 0;
  let truncated = 0;
  let index = 0;
  for (const item of list) {
    const task = normalizeTask(item, index);
    if (!task || seenIds.has(task.id)) {
      skipped += 1;
      continue;
    }
    if (tasks.length >= MAX_TASKS) {
      truncated += 1;
      continue;
    }
    seenIds.add(task.id);
    tasks.push(task);
    index += 1;
  }
  if (!tasks.length) return { ok: false, error: "empty" };
  return { ok: true, tasks: normalizeOrder(tasks), skipped, truncated };
}

/** Относительная дата на языке интерфейса. */
export function relativeDate(timestamp: number, lang: string, now = Date.now()): string {
  const diff = timestamp - now;
  const abs = Math.abs(diff);
  // style: "narrow" в русской локали даёт «-2 мин» (без «назад») — берём short.
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto", style: "short" });
  if (abs < 60_000) return rtf.format(Math.round(diff / 1000), "second");
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), "hour");
  if (abs < 7 * 86_400_000) return rtf.format(Math.round(diff / 86_400_000), "day");
  return new Intl.DateTimeFormat(lang, { day: "numeric", month: "short" }).format(timestamp);
}
