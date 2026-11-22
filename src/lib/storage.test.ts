import { beforeEach, describe, expect, it } from "vitest";
import { installFakeChrome, installFakeLocalStorage, type FakeChrome } from "@/lib/testUtils";
import { KEYS, LEGACY_LOCAL_STORAGE_KEY, SCHEMA_VERSION } from "@/lib/storageKeys";
import { loadState, normalizePrefs, onTasksChanged, savePrefs, saveTasks } from "@/lib/storage";

const v3Task = (id: string, order: number, patch: Record<string, unknown> = {}) => ({
  id,
  text: `задача ${id}`,
  createdAt: 1_700_000_000_000 + order * 1000,
  order,
  completed: false,
  priority: "normal",
  ...patch,
});

let chrome: FakeChrome;

beforeEach(() => {
  chrome = installFakeChrome();
  installFakeLocalStorage();
});

describe("normalizePrefs", () => {
  it("подставляет значения по умолчанию", () => {
    expect(normalizePrefs(null)).toEqual({ compact: false, filter: "all" });
    expect(normalizePrefs({ compact: "да", filter: "что-то" })).toEqual({ compact: false, filter: "all" });
  });

  it("сохраняет известные значения", () => {
    expect(normalizePrefs({ compact: true, filter: "active" })).toEqual({ compact: true, filter: "active" });
  });
});

describe("loadState: чистый запуск", () => {
  it("возвращает пустой список и не пишет схему зря", async () => {
    const result = await loadState();
    expect(result).toMatchObject({ tasks: [], source: "empty", changed: false });
    expect(chrome.store.has(KEYS.schema)).toBe(false);
  });
});

describe("loadState: миграция из версии 3.0 (chrome.storage.tasks_v3)", () => {
  it("переносит задачи, пишет схему и сохраняет копию исходных данных", async () => {
    await chrome.local.set({ [KEYS.legacyV3]: [v3Task("b", 1), v3Task("a", 0, { completed: true, priority: "high" })] });

    const result = await loadState();
    expect(result.source).toBe("v3");
    expect(result.tasks.map((task) => task.id)).toEqual(["a", "b"]);
    expect(result.tasks[0]).toMatchObject({ completed: true, priority: "high" });
    expect(chrome.store.get(KEYS.schema)).toBe(SCHEMA_VERSION);
    expect(chrome.store.has(KEYS.legacy)).toBe(true);
  });

  it("повторный запуск ничего не мигрирует", async () => {
    await chrome.local.set({ [KEYS.legacyV3]: [v3Task("a", 0)] });
    await loadState();
    const second = await loadState();
    expect(second).toMatchObject({ source: "storage", changed: false });
  });
});

describe("loadState: миграция из версии 1.x (localStorage)", () => {
  it("переносит задачи и очищает старый ключ", async () => {
    localStorage.setItem(LEGACY_LOCAL_STORAGE_KEY, JSON.stringify([{ id: "old-1", text: "старая задача", createdAt: 1 }]));

    const result = await loadState();
    expect(result.source).toBe("v1");
    expect(result.tasks.map((task) => task.id)).toEqual(["old-1"]);
    expect(result.tasks[0].completed).toBe(false);
    expect(localStorage.getItem(LEGACY_LOCAL_STORAGE_KEY)).toBeNull();
  });

  it("битый JSON не ломает запуск", async () => {
    localStorage.setItem(LEGACY_LOCAL_STORAGE_KEY, "{не json");
    const result = await loadState();
    expect(result).toMatchObject({ tasks: [], source: "empty" });
  });
});

describe("loadState: обе версии сразу", () => {
  it("объединяет списки без дублей", async () => {
    const shared = v3Task("same", 0, { text: "одна и та же", createdAt: 5 });
    await chrome.local.set({ [KEYS.legacyV3]: [shared, v3Task("only-v3", 1)] });
    localStorage.setItem(
      LEGACY_LOCAL_STORAGE_KEY,
      JSON.stringify([
        { id: "same", text: "одна и та же", createdAt: 5 },
        { id: "only-v1", text: "только из v1", createdAt: 9 },
      ]),
    );

    const result = await loadState();
    expect(result.source).toBe("v3+v1");
    expect(result.tasks.map((task) => task.id)).toEqual(["same", "only-v3", "only-v1"]);
  });
});

describe("loadState: схема уже актуальна", () => {
  it("читает задачи из актуального ключа и игнорирует legacy", async () => {
    await chrome.local.set({
      [KEYS.schema]: SCHEMA_VERSION,
      [KEYS.tasks]: [{ id: "t", text: "актуальная", order: 0, createdAt: 1, completed: false, priority: "normal" }],
      [KEYS.legacyV3]: [v3Task("legacy", 0)],
    });
    const result = await loadState();
    expect(result.source).toBe("storage");
    expect(result.tasks.map((task) => task.id)).toEqual(["t"]);
  });
});

describe("запись и подписка", () => {
  it("saveTasks пишет схему и задачи", async () => {
    await saveTasks([{ id: "a", text: "x", createdAt: 1, order: 0, completed: false, priority: "normal" }]);
    expect(chrome.store.get(KEYS.schema)).toBe(SCHEMA_VERSION);
    expect((chrome.store.get(KEYS.tasks) as unknown[]).length).toBe(1);
  });

  it("savePrefs пишет настройки", async () => {
    await savePrefs({ compact: true, filter: "completed" });
    expect(chrome.store.get(KEYS.prefs)).toEqual({ compact: true, filter: "completed" });
  });

  it("onTasksChanged сообщает о внешней записи и отписывается", async () => {
    const seen: string[][] = [];
    const unsubscribe = onTasksChanged((tasks) => seen.push(tasks.map((task) => task.id)));

    await chrome.local.set({ [KEYS.tasks]: [v3Task("a", 0), v3Task("b", 1)] });
    await chrome.local.set({ [KEYS.tasks]: [v3Task("b", 0)] });
    unsubscribe();
    await chrome.local.set({ [KEYS.tasks]: [v3Task("c", 0)] });

    expect(seen).toEqual([["a", "b"], ["b"]]);
  });
});
