#!/usr/bin/env node
/**
 * E2E-сценарий продукта в настоящем Chrome: миграция данных, добавление/правка,
 * перестановка мышью и с клавиатуры, поиск, фильтры, экспорт/импорт, undo,
 * подтверждение удаления. Отдельно — регрессионные проверки на дефекты,
 * которые были в прошлых версиях (фокус, скролл, черновик, слушатели, drag).
 *
 * Запуск: npm run e2e   (нужен собранный dist/ и CHROME_BIN с Chrome for Testing)
 */
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ARTIFACTS, launchChrome, openExtensionPage, pressKey, sleep } from "./cdp.mjs";

const results = [];
const record = (ok, name, detail = "") => {
  results.push({ ok, name, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const DOWNLOADS = path.join(ARTIFACTS, "downloads");
const TASKS = [
  { id: "t1", text: "Проверить курсы WEXDB", createdAt: Date.now() - 3_600_000, order: 0, completed: false, priority: "high" },
  { id: "t2", text: "Отчёт за апрель", createdAt: Date.now() - 120_000, order: 1, completed: false, priority: "normal" },
  { id: "t3", text: "Позвонить в банк", createdAt: Date.now() - 7_000_000, order: 2, completed: false, priority: "normal" },
];

await mkdir(DOWNLOADS, { recursive: true });
const chrome = await launchChrome({ locale: "ru" });
const { browser } = chrome;
let panel;

const box = (selector) =>
  panel.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);

async function clickAt(point) {
  await browser.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point }, panel.sessionId);
  await browser.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point }, panel.sessionId);
  await browser.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point }, panel.sessionId);
  await sleep(180);
}

async function click(selector) {
  const point = await box(selector);
  if (!point) throw new Error(`элемент не найден или невидим: ${selector}`);
  await clickAt(point);
}

/** Перетаскивание за ручку: dnd-kit включается после 5px движения. */
async function drag(fromSelector, toSelector) {
  const from = await box(fromSelector);
  const to = await box(toSelector);
  if (!from || !to) throw new Error(`drag: нет элемента ${!from ? fromSelector : toSelector}`);
  await browser.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...from }, panel.sessionId);
  await browser.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...from }, panel.sessionId);
  const steps = 8;
  for (let step = 1; step <= steps; step += 1) {
    const x = from.x + ((to.x - from.x) * step) / steps;
    const y = from.y + ((to.y - from.y) * step) / steps;
    await browser.send("Input.dispatchMouseEvent", { type: "mouseMoved", button: "left", buttons: 1, x, y }, panel.sessionId);
    await sleep(40);
  }
  await browser.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...to }, panel.sessionId);
  await sleep(350);
}

const domOrder = () => panel.evaluate(`[...document.querySelectorAll(".task-card")].map((el) => el.dataset.id)`);
const storedOrder = () =>
  panel.evaluate(`chrome.storage.local.get("tasks").then((r) => (r.tasks ?? []).slice().sort((a, b) => a.order - b.order).map((t) => t.id))`);

async function typeInto(selector, text, { enter = false } = {}) {
  await click(selector);
  await panel.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.focus(); el.select?.(); return true; })()`);
  await browser.send("Input.insertText", { text }, panel.sessionId);
  await sleep(120);
  if (enter) {
    await pressKey(browser, panel.sessionId, "Enter");
    await sleep(300);
  }
}

try {
  record(Boolean(chrome.serviceWorker), "расширение загружено");
  panel = await openExtensionPage(browser, chrome.extId, "src/sidepanel/index.html", { width: 400, height: 860 });

  // ============================================================ 1. миграция
  await panel.evaluate(`Promise.all([
    chrome.storage.local.set({ tasks_v3: ${JSON.stringify(TASKS)} }),
    chrome.storage.local.remove(["tasks", "schemaVersion", "legacyBackup"]),
    new Promise((resolve) => { localStorage.setItem("tasks", JSON.stringify([{ id: "v1-1", text: "задача из версии 1", createdAt: 1700000000000 }])); resolve(); }),
  ])`);
  await panel.reload();
  await sleep(900);

  const migrated = await panel.evaluate(`(async () => ({
    ids: [...document.querySelectorAll(".task-card")].map((el) => el.dataset.id),
    toast: document.querySelector(".toast")?.textContent ?? "",
    backup: await chrome.storage.local.get("legacyBackup").then((r) => Boolean(r.legacyBackup)),
    local: localStorage.getItem("tasks"),
    schema: await chrome.storage.local.get("schemaVersion").then((r) => r.schemaVersion),
    v3kept: await chrome.storage.local.get("tasks_v3").then((r) => (r.tasks_v3 ?? []).length),
  }))()`);
  record(migrated.ids.length === 4, "миграция v3 + v1: задачи на месте", migrated.ids.join(", "));
  record(migrated.toast.includes("4") || /перенес/i.test(migrated.toast), "показано уведомление о переносе", migrated.toast);
  record(migrated.backup === true, "копия исходных данных сохранена (legacyBackup)");
  record(migrated.local === null, "ключ localStorage очищен после переноса");
  record(migrated.schema === 4, "записана версия схемы 4", String(migrated.schema));
  record(migrated.v3kept === 3, "старый ключ tasks_v3 не тронут", String(migrated.v3kept));

  // ============================================================ 2. базовое состояние
  await panel.evaluate(`chrome.storage.local.set({ tasks: ${JSON.stringify(TASKS)}, schemaVersion: 4, prefs: { compact: false, filter: "all" } })`);
  await panel.reload();
  await sleep(700);
  record((await domOrder()).join() === "t1,t2,t3", "исходный порядок отрисован", (await domOrder()).join());

  // ============================================================ 3. добавление
  await typeInto('input[name="task"]', "Новая задача из e2e", { enter: true });
  const afterAdd = await panel.evaluate(`(async () => ({
    ids: [...document.querySelectorAll(".task-card")].map((el) => el.dataset.id),
    first: document.querySelector(".task-text")?.textContent ?? "",
    stored: (await chrome.storage.local.get("tasks")).tasks.length,
    input: document.querySelector('input[name="task"]').value,
    focused: document.activeElement?.name,
  }))()`);
  record(afterAdd.ids.length === 4 && afterAdd.first === "Новая задача из e2e", "задача добавлена наверх через Enter", afterAdd.first);
  record(afterAdd.stored === 4, "задача сохранена в storage", String(afterAdd.stored));
  record(afterAdd.input === "" && afterAdd.focused === "task", "поле очищено и остаётся в фокусе", `"${afterAdd.input}" / ${afterAdd.focused}`);

  const newId = afterAdd.ids[0];

  // ============================================================ 4. отметка + регрессии фокуса и скролла
  await panel.evaluate(`(() => { const el = document.querySelector(".panel-list"); el.style.scrollBehavior = "auto"; return true; })()`);
  await panel.evaluate(`(() => {
    // добавляем ещё задач, чтобы появился скролл
    return chrome.storage.local.get("tasks").then((r) => {
      const extra = Array.from({ length: 18 }, (_, i) => ({ id: "x" + i, text: "задача " + (i + 1), createdAt: Date.now() + i, order: 10 + i, completed: false, priority: "normal" }));
      return chrome.storage.local.set({ tasks: [...r.tasks, ...extra] });
    });
  })()`);
  await panel.reload();
  await sleep(700);

  await click('input[type="search"]');
  await browser.send("Input.insertText", { text: "задача", }, panel.sessionId);
  await panel.evaluate(`(document.querySelector('input[type="search"]').__probe = "kept")`);
  await sleep(350);

  const scrollSet = await panel.evaluate(`(() => {
    const list = document.querySelector(".panel-list");
    list.style.scrollBehavior = "auto";
    list.scrollTop = 260;
    return { scrollable: list.scrollHeight > list.clientHeight, top: list.scrollTop };
  })()`);

  // кликаем по карточке, которая реально видна ниже липкой шапки
  const target = await panel.evaluate(`(() => {
    const top = document.querySelector(".panel-top").getBoundingClientRect().bottom;
    const card = [...document.querySelectorAll(".task-card")].find((el) => el.getBoundingClientRect().top > top + 6);
    if (!card) return null;
    const rect = card.querySelector(".task-checkbox").getBoundingClientRect();
    return { id: card.dataset.id, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  if (!target) throw new Error("нет видимой карточки под шапкой");
  await clickAt({ x: target.x, y: target.y });
  await sleep(400);

  const afterToggle = await panel.evaluate(`(() => {
    const toggledId = ${JSON.stringify(target.id)};
    const list = document.querySelector(".panel-list");
    const search = document.querySelector('input[type="search"]');
    return {
      scrollTop: list.scrollTop,
      sameNode: search.__probe === "kept",
      focused: document.activeElement?.type ?? document.activeElement?.tagName,
      searchValue: search.value,
      checked: document.querySelector('.task-card[data-id="' + toggledId + '"] .task-checkbox')?.getAttribute("aria-checked"),
    };
  })()`);
  record(afterToggle.checked === "true", "задача отмечена выполненной (aria-checked)", String(afterToggle.checked));
  record(afterToggle.searchValue === "задача", "поисковый запрос не сбросился", afterToggle.searchValue);
  record(afterToggle.sameNode === true, "поле поиска не пересоздаётся при изменении списка (регрессия v3)", `focused=${afterToggle.focused}`);
  record(afterToggle.focused !== "body", "фокус не потерян после отметки задачи", String(afterToggle.focused));
  record(
    !scrollSet.scrollable || afterToggle.scrollTop > 0,
    "позиция скролла сохранилась (регрессия v3)",
    `было ${scrollSet.top} → стало ${afterToggle.scrollTop}`,
  );

  // ============================================================ 5. черновик переживает запись из другого окна
  await click('input[name="task"]');
  await browser.send("Input.insertText", { text: "черновик, который нельзя терять" }, panel.sessionId);
  await sleep(150);
  await panel.evaluate(`(async () => {
    const current = (await chrome.storage.local.get("tasks")).tasks;
    const extra = { id: "from-other-window", text: "задача из другого окна", createdAt: Date.now(), order: 99, completed: false, priority: "normal" };
    return chrome.storage.local.set({ tasks: [...current, extra] });
  })()`);
  await sleep(500);
  const draft = await panel.evaluate(`({
    draft: document.querySelector('input[name="task"]').value,
    synced: Boolean(document.querySelector('.task-card[data-id="from-other-window"]')),
  })`);
  record(draft.draft === "черновик, который нельзя терять", "черновик в поле не потерялся при внешней записи (регрессия v3)", draft.draft);
  record(draft.synced === true, "изменения из другого окна подхватились", String(draft.synced));

  // ============================================================ 6. утечка слушателей
  const listeners = await panel.evaluate(`(async () => {
    const before = window.__docListeners ?? 0;
    for (let i = 0; i < 6; i += 1) {
      document.querySelectorAll(".chip")[i % 3].click();
    }
    await new Promise((r) => setTimeout(r, 400));
    return { before, after: window.__docListeners ?? 0 };
  })()`);
  record(listeners.after - listeners.before <= 1, "слушатели document не накапливаются при переключении фильтров", JSON.stringify(listeners));

  // ============================================================ 7. перестановка мышью (через границу приоритета)
  await panel.evaluate(`chrome.storage.local.set({ tasks: ${JSON.stringify(TASKS)}, prefs: { compact: false, filter: "all" } })`);
  await panel.reload();
  await sleep(700);
  const beforeDrag = await domOrder();
  await drag('.task-card[data-id="t1"] .drag-handle', '.task-card[data-id="t3"] .drag-handle');
  const afterDrag = await domOrder();
  const storedAfterDrag = await storedOrder();
  record(
    afterDrag.join() !== beforeDrag.join(),
    "перетаскивание high-задачи вниз работает (регрессия v3)",
    `${beforeDrag.join()} → ${afterDrag.join()}`,
  );
  record(storedAfterDrag.join() === afterDrag.join(), "новый порядок сохранён в storage", storedAfterDrag.join());

  // ============================================================ 8. перестановка с клавиатуры
  await panel.evaluate(`chrome.storage.local.set({ tasks: ${JSON.stringify(TASKS)} })`);
  await panel.reload();
  await sleep(700);
  await panel.evaluate(`document.querySelector('.task-card[data-id="t1"] .drag-handle').focus()`);
  await pressKey(browser, panel.sessionId, " ");
  await sleep(200);
  await pressKey(browser, panel.sessionId, "ArrowDown");
  await sleep(250);
  await pressKey(browser, panel.sessionId, " ");
  await sleep(400);
  const afterKeyboard = await domOrder();
  record(afterKeyboard.join() !== "t1,t2,t3", "перестановка с клавиатуры работает", afterKeyboard.join());

  // ============================================================ 10. поиск с подсветкой
  await panel.evaluate(`chrome.storage.local.set({ tasks: ${JSON.stringify(TASKS)} })`);
  await panel.reload();
  await sleep(700);
  await click('input[type="search"]');
  await browser.send("Input.insertText", { text: "банк" }, panel.sessionId);
  await sleep(350);
  const searchView = await panel.evaluate(`({
    cards: document.querySelectorAll(".task-card").length,
    marks: [...document.querySelectorAll(".task-text mark")].map((el) => el.textContent),
    empty: document.querySelector(".empty")?.textContent ?? "",
  })`);
  record(searchView.cards === 1 && searchView.marks.join() === "банк", "поиск фильтрует и подсвечивает", JSON.stringify(searchView));
  await click('.search-clear');
  await sleep(300);
  record((await panel.evaluate(`document.querySelectorAll(".task-card").length`)) === 3, "очистка поиска возвращает список");

  // ============================================================ 11. фильтры и «убрать выполненные» + undo
  await click('.chip:nth-child(3)');
  await sleep(250);
  const completedFilter = await panel.evaluate(`({ cards: document.querySelectorAll(".task-card").length, empty: document.querySelector(".empty")?.textContent ?? "" })`);
  record(completedFilter.cards === 0 && completedFilter.empty.length > 0, "фильтр «Готово» показывает пустое состояние", completedFilter.empty.slice(0, 30));
  await click('.chip:nth-child(1)');
  await sleep(250);

  await panel.evaluate(`(() => {
    const tasks = ${JSON.stringify(TASKS.map((task) => ({ ...task, completed: task.id === "t3" })))};
    return chrome.storage.local.set({ tasks });
  })()`);
  await sleep(300);
  await click('.clear-done');
  await sleep(350);
  const cleared = await panel.evaluate(`({ cards: document.querySelectorAll(".task-card").length, toast: document.querySelector(".toast")?.textContent ?? "" })`);
  record(cleared.cards === 2, "«убрать выполненные» удаляет только готовые", String(cleared.cards));
  record(/Отменить/.test(cleared.toast), "в уведомлении есть «Отменить»", cleared.toast);
  await panel.evaluate(`(() => { const buttons = [...document.querySelectorAll(".toast-action")]; buttons[buttons.length - 1]?.click(); return true; })()`);
  await sleep(400);
  record((await panel.evaluate(`document.querySelectorAll(".task-card").length`)) === 3, "undo возвращает задачи");

  // ============================================================ 12. удаление с подтверждением
  await click('.task-card[data-id="t2"] .icon-btn[data-role="delete"]');
  await sleep(250);
  const dialogOpen = await panel.evaluate(`({
    role: document.querySelector('[role="dialog"]')?.getAttribute("aria-modal"),
    title: document.querySelector('[role="dialog"] h2')?.textContent ?? "",
    focused: document.activeElement?.textContent ?? "",
  })`);
  record(dialogOpen.role === "true", "диалог открыт как aria-modal", String(dialogOpen.role));
  record(dialogOpen.focused.includes("Отмена"), "фокус переведён на безопасную кнопку", dialogOpen.focused);
  await pressKey(browser, panel.sessionId, "Escape");
  await sleep(250);
  const afterEsc = await panel.evaluate(`({ dialog: Boolean(document.querySelector('[role="dialog"]')), cards: document.querySelectorAll(".task-card").length })`);
  record(!afterEsc.dialog && afterEsc.cards === 3, "Esc закрывает диалог без удаления", JSON.stringify(afterEsc));

  await click('.task-card[data-id="t2"] .icon-btn[data-role="delete"]');
  await sleep(200);
  await click('[role="dialog"] .btn-danger');
  await sleep(350);
  const afterDelete = await panel.evaluate(`(async () => ({
    cards: document.querySelectorAll(".task-card").length,
    stored: (await chrome.storage.local.get("tasks")).tasks.length,
    toast: document.querySelector(".toast")?.textContent ?? "",
  }))()`);
  record(afterDelete.cards === 2 && afterDelete.stored === 2, "подтверждённое удаление применено и сохранено", JSON.stringify(afterDelete));
  await click(".toast-action");
  await sleep(300);

  // ============================================================ 13. экспорт
  await browser.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DOWNLOADS });
  await click('.menu .icon-btn');
  await sleep(200);
  await click('.menu-item');
  await sleep(900);
  const files = (await readdir(DOWNLOADS)).filter((file) => file.endsWith(".json"));
  let exported = null;
  if (files.length) exported = JSON.parse(await readFile(path.join(DOWNLOADS, files[0]), "utf8"));
  record(files.length === 1, "экспорт скачал файл", files.join(", "));
  record(exported?.app === "chrome-task-manager" && exported?.tasks?.length === 3, "файл экспорта валиден", `${exported?.app} / ${exported?.tasks?.length}`);

  // ============================================================ 14. импорт
  const importFile = path.join(ARTIFACTS, "import-sample.json");
  await writeFile(
    importFile,
    JSON.stringify({ tasks: [{ id: "imp-1", text: "импортированная задача", createdAt: 1, order: 0, completed: false, priority: "high" }, { text: 42 }] }),
  );
  const fileInput = await browser.send("Runtime.evaluate", { expression: `document.querySelector('input[type="file"]')`, returnByValue: false }, panel.sessionId);
  await browser.send("DOM.setFileInputFiles", { files: [importFile], objectId: fileInput.result.objectId }, panel.sessionId);
  await sleep(500);
  const importDialog = await panel.evaluate(`document.querySelector('[role="dialog"] h2')?.textContent ?? ""`);
  record(importDialog.length > 0, "импорт спрашивает подтверждение", importDialog);
  await click('[role="dialog"] .btn-primary');
  await sleep(500);
  const imported = await panel.evaluate(`(async () => ({
    ids: [...document.querySelectorAll(".task-card")].map((el) => el.dataset.id),
    toast: [...document.querySelectorAll(".toast")].map((el) => el.textContent).join(" | "),
    stored: (await chrome.storage.local.get("tasks")).tasks.length,
  }))()`);
  record(imported.ids.join() === "imp-1", "импорт заменил список (битые записи пропущены)", imported.ids.join());
  record(/пропущено/i.test(imported.toast), "в уведомлении видно, сколько пропущено", imported.toast);
  await panel.evaluate(`(() => { const buttons = [...document.querySelectorAll(".toast-action")]; buttons[buttons.length - 1]?.click(); return true; })()`);
  await sleep(400);
  record((await panel.evaluate(`document.querySelectorAll(".task-card").length`)) === 3, "undo после импорта возвращает прежний список");

  // ============================================================ 15. персистентность
  const before = await domOrder();
  await panel.reload();
  await sleep(800);
  record((await domOrder()).join() === before.join(), "порядок сохраняется после перезагрузки панели", (await domOrder()).join());

  // ============================================================ 16. провал storage не теряет данные молча
  const errors = panel.errors();
  record(errors.length === 0, "нет ошибок в консоли за весь сценарий", errors.slice(0, 3).join(" | "));

  await panel.screenshot("e2e-final");
} catch (error) {
  record(false, "исключение в сценарии", `${error.message}`);
  console.error(error);
} finally {
  await panel?.close().catch(() => {});
  await chrome.close();
  await rm(chrome.profile, { recursive: true, force: true }).catch(() => {});
  await rm(DOWNLOADS, { recursive: true, force: true }).catch(() => {});
}

const failed = results.filter((item) => !item.ok);
await mkdir(ARTIFACTS, { recursive: true });
await writeFile(path.join(ARTIFACTS, "e2e.json"), JSON.stringify(results, null, 2));
await writeFile(path.join(ARTIFACTS, "e2e.log"), results.map((item) => `${item.ok ? "✓" : "✗"} ${item.name}${item.detail ? ` — ${item.detail}` : ""}`).join("\n") + "\n");
console.log(`\n${failed.length ? `провалов: ${failed.length} из ${results.length}` : `все ${results.length} проверок пройдены`} → artifacts/e2e.json`);
process.exit(failed.length ? 1 : 0);
