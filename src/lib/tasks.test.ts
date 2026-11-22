import { describe, expect, it } from "vitest";
import {
  MAX_TASKS,
  MAX_TEXT,
  arrayMove,
  backupFileName,
  clampText,
  countTasks,
  filterTasks,
  highlightParts,
  makeTask,
  normalizeOrder,
  normalizeTask,
  parseBackup,
  relativeDate,
  reorderVisible,
  serializeBackup,
  sortTasks,
  tokenize,
  type ParseResult,
} from "@/lib/tasks";
import type { Task } from "@/types";

const task = (id: string, order: number, patch: Partial<Task> = {}): Task => ({
  id,
  text: `задача ${id}`,
  createdAt: 1_700_000_000_000 + order * 1000,
  order,
  completed: false,
  priority: "normal",
  ...patch,
});

describe("clampText / normalizeTask", () => {
  it("обрезает пробелы и длину", () => {
    expect(clampText("  привет  ")).toBe("привет");
    expect(clampText("я".repeat(600))).toHaveLength(MAX_TEXT);
  });

  it("отбрасывает записи без текста", () => {
    expect(normalizeTask(null)).toBeNull();
    expect(normalizeTask({})).toBeNull();
    expect(normalizeTask({ text: "   " })).toBeNull();
    expect(normalizeTask({ text: 123 })).toBeNull();
  });

  it("достраивает отсутствующие поля", () => {
    const result = normalizeTask({ text: "  купить хлеб ", order: 3 })!;
    expect(result.text).toBe("купить хлеб");
    expect(result.order).toBe(3);
    expect(result.completed).toBe(false);
    expect(result.priority).toBe("normal");
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.createdAt).toBeGreaterThan(0);
  });

  it("сохраняет неизвестный приоритет как normal", () => {
    expect(normalizeTask({ text: "x", priority: "urgent" })!.priority).toBe("normal");
    expect(normalizeTask({ text: "x", priority: "high" })!.priority).toBe("high");
  });
});

describe("makeTask", () => {
  it("создаёт задачу с заданным order и временем", () => {
    const created = makeTask("  новая  ", { order: -1, now: 42 })!;
    expect(created.text).toBe("новая");
    expect(created.order).toBe(-1);
    expect(created.createdAt).toBe(42);
  });

  it("возвращает null на пустой текст", () => {
    expect(makeTask("   ")).toBeNull();
  });

  it("генерирует разные идентификаторы", () => {
    const ids = new Set(Array.from({ length: 50 }, () => makeTask("x")!.id));
    expect(ids.size).toBe(50);
  });
});

describe("сортировка и нормализация порядка", () => {
  it("сортирует по order, при равенстве — по createdAt", () => {
    const list = [task("b", 1), task("a", 0), task("c", 1, { createdAt: 1 })];
    expect(sortTasks(list).map((item) => item.id)).toEqual(["a", "c", "b"]);
  });

  it("перенумеровывает order в 0..n-1", () => {
    const list = [task("b", 7), task("a", 3), task("c", 9)];
    expect(normalizeOrder(list).map((item) => [item.id, item.order])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
    ]);
  });

  it("не создаёт новые объекты, если порядок уже верный", () => {
    const list = [task("a", 0), task("b", 1)];
    expect(normalizeOrder(list)[0]).toBe(list[0]);
  });
});

describe("фильтры и поиск", () => {
  const list = [
    task("1", 0, { text: "Позвонить в банк", completed: true }),
    task("2", 1, { text: "Купить хлеб и молоко" }),
    task("3", 2, { text: "Отчёт WEXDB за апрель" }),
  ];

  it("фильтрует по статусу", () => {
    expect(filterTasks(list, "all").map((item) => item.id)).toEqual(["1", "2", "3"]);
    expect(filterTasks(list, "active").map((item) => item.id)).toEqual(["2", "3"]);
    expect(filterTasks(list, "completed").map((item) => item.id)).toEqual(["1"]);
  });

  it("ищет по всем словам запроса в любом порядке и регистре", () => {
    expect(filterTasks(list, "all", "ХЛЕБ купить").map((item) => item.id)).toEqual(["2"]);
    expect(filterTasks(list, "all", "wexdb").map((item) => item.id)).toEqual(["3"]);
    expect(filterTasks(list, "all", "хлеб банк")).toEqual([]);
  });

  it("считает по статусам", () => {
    expect(countTasks(list)).toEqual({ all: 3, active: 2, completed: 1 });
  });

  it("токенизирует запрос", () => {
    expect(tokenize("  a   B ")).toEqual(["a", "b"]);
    expect(tokenize("   ")).toEqual([]);
  });
});

describe("arrayMove", () => {
  it("переставляет элементы", () => {
    expect(arrayMove([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(arrayMove([1, 2, 3], 2, 0)).toEqual([3, 1, 2]);
  });

  it("не падает на некорректных индексах", () => {
    expect(arrayMove([1, 2, 3], -1, 0)).toEqual([1, 2, 3]);
    expect(arrayMove([1, 2, 3], 0, 5)).toEqual([1, 2, 3]);
    expect(arrayMove([1, 2, 3], 1, 1)).toEqual([1, 2, 3]);
  });
});

describe("reorderVisible — регрессия на перестановку внутри фильтра", () => {
  const all = [
    task("done-1", 0, { completed: true }),
    task("a", 1),
    task("done-2", 2, { completed: true }),
    task("b", 3),
    task("c", 4),
  ];

  it("не сдвигает скрытые задачи: видимый порядок меняется, скрытые остаются на местах", () => {
    const visible = filterTasks(all, "active");
    expect(visible.map((item) => item.id)).toEqual(["a", "b", "c"]);
    const result = reorderVisible(all, visible, "c", "a");
    expect(result.map((item) => item.id)).toEqual(["done-1", "c", "done-2", "a", "b"]);
    expect(result.map((item) => item.order)).toEqual([0, 1, 2, 3, 4]);
  });

  it("работает при активном поиске", () => {
    const visible = filterTasks(all, "all", "c");
    const result = reorderVisible(all, visible, "c", "c");
    expect(result.map((item) => item.id)).toEqual(all.map((item) => item.id));
  });

  it("игнорирует неизвестные идентификаторы", () => {
    const visible = filterTasks(all, "all");
    expect(reorderVisible(all, visible, "нет-такой", "a").map((item) => item.id)).toEqual(all.map((item) => item.id));
  });
});

describe("highlightParts", () => {
  it("возвращает цельный кусок без запроса", () => {
    expect(highlightParts("текст", "")).toEqual([{ text: "текст", match: false }]);
  });

  it("размечает совпадения", () => {
    expect(highlightParts("Купить хлеб", "хлеб")).toEqual([
      { text: "Купить ", match: false },
      { text: "хлеб", match: true },
    ]);
  });

  it("подсвечивает все слова запроса", () => {
    const parts = highlightParts("a b a", "a");
    expect(parts.filter((part) => part.match)).toHaveLength(2);
  });

  it("не ломается на спецсимволах регулярки", () => {
    expect(highlightParts("цена (руб) *", "(руб)")).toEqual([
      { text: "цена ", match: false },
      { text: "(руб)", match: true },
      { text: " *", match: false },
    ]);
    expect(highlightParts("a.b", ".")).toEqual([
      { text: "a", match: false },
      { text: ".", match: true },
      { text: "b", match: false },
    ]);
  });

  it("не экранирует HTML: куски возвращаются как обычный текст", () => {
    const parts = highlightParts("<img src=x onerror=alert(1)>", "img");
    expect(parts.map((part) => part.text).join("")).toBe("<img src=x onerror=alert(1)>");
  });
});

describe("экспорт / импорт", () => {
  const list = [task("b", 1), task("a", 0)];

  it("сериализует с метаданными и сохраняет порядок", () => {
    const parsed = JSON.parse(serializeBackup(list, new Date("2026-04-22T10:00:00Z")));
    expect(parsed.app).toBe("chrome-task-manager");
    expect(parsed.version).toBe(4);
    expect(parsed.exportedAt).toBe("2026-04-22T10:00:00.000Z");
    expect(parsed.tasks.map((item: Task) => item.id)).toEqual(["a", "b"]);
  });

  it("переживает round-trip", () => {
    const result = parseBackup(serializeBackup(list));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tasks.map((item) => item.id)).toEqual(["a", "b"]);
    expect(result.skipped).toBe(0);
  });

  it("принимает плоский массив и старый формат", () => {
    const flat = parseBackup(JSON.stringify([{ text: "одна" }, { text: "две", completed: true }]));
    expect(flat.ok && flat.tasks).toHaveLength(2);
    const legacy = parseBackup(JSON.stringify({ version: 3, tasks: [{ text: "старая", priority: "high" }] }));
    expect(legacy.ok && legacy.tasks[0].priority).toBe("high");
  });

  it("пропускает битые записи, а не валит весь импорт", () => {
    const result = parseBackup(JSON.stringify({ tasks: [{ text: 123 }, { text: "норм" }, {}, null] }));
    expect(result).toMatchObject({ ok: true, skipped: 3 });
    if (result.ok) expect(result.tasks).toHaveLength(1);
  });

  it("убирает дубли по id", () => {
    const result = parseBackup(JSON.stringify([{ id: "x", text: "a" }, { id: "x", text: "b" }]));
    expect(result).toMatchObject({ ok: true, skipped: 1 });
  });

  it("сообщает о причинах отказа", () => {
    expect(parseBackup("не json")).toEqual({ ok: false, error: "not-json" } satisfies ParseResult);
    expect(parseBackup("{}")).toEqual({ ok: false, error: "not-a-list" } satisfies ParseResult);
    expect(parseBackup("[]")).toEqual({ ok: false, error: "empty" } satisfies ParseResult);
    expect(parseBackup('{"tasks":[{"text":""}]}')).toEqual({ ok: false, error: "empty" } satisfies ParseResult);
  });

  it("ограничивает количество задач", () => {
    const many = Array.from({ length: MAX_TASKS + 3 }, (_, index) => ({ id: `t${index}`, text: `задача ${index}` }));
    const result = parseBackup(JSON.stringify(many));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tasks).toHaveLength(MAX_TASKS);
    expect(result.truncated).toBe(3);
  });

  it("формирует имя файла с датой и временем", () => {
    expect(backupFileName(new Date(2026, 3, 22, 7, 5))).toBe("tasks-2026-04-22_0705.json");
  });
});

describe("relativeDate", () => {
  const now = new Date("2026-04-22T12:00:00Z").getTime();

  it("описывает свежие задачи относительно текущего момента", () => {
    expect(relativeDate(now, "ru", now)).toBe("сейчас");
    expect(relativeDate(now - 5 * 60_000, "ru", now)).toContain("5");
    expect(relativeDate(now - 5 * 60_000, "ru", now)).toContain("назад");
    expect(relativeDate(now - 3 * 3_600_000, "ru", now)).toContain("3");
    expect(relativeDate(now - 3 * 3_600_000, "ru", now)).not.toContain("-");
    expect(relativeDate(now - 120_000, "en", now)).toBe("2 min. ago");
  });

  it("для давних задач выводит дату", () => {
    expect(relativeDate(now - 40 * 86_400_000, "ru", now)).toMatch(/\d/);
  });
});
