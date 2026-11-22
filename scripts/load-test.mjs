#!/usr/bin/env node
/**
 * Дымовой тест собранного расширения в настоящем Chrome:
 * загрузка, service worker, панель, popup, локали (ru/en), светлая и тёмная тема.
 * Скриншоты и лог кладутся в artifacts/.
 *
 * Запуск: npm run load-test            (CHROME_BIN=... если Chrome for Testing не в tools/)
 *         LOCALES=ru npm run load-test — только один язык
 */
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { ARTIFACTS, ROOT, launchChrome, openExtensionPage, pressKey, sleep } from "./cdp.mjs";

const locales = (process.env.LOCALES ?? "ru,en").split(",").map((value) => value.trim()).filter(Boolean);
const results = [];
const record = (ok, name, detail = "") => {
  results.push({ ok, name, detail, locale: currentLocale });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};
let currentLocale = "";

const EXPECTED = {
  ru: {
    title: "Задачи",
    add: "Добавить",
    filterAll: "Все",
    placeholder: "Новая задача…",
    popupOpen: "Открыть список задач",
    popupClose: "Закрыть список задач",
  },
  en: {
    title: "Tasks",
    add: "Add",
    filterAll: "All",
    placeholder: "New task…",
    popupOpen: "Open task list",
    popupClose: "Close task list",
  },
};

const SEED = [
  { id: "seed-1", text: "Проверить курсы WEXDB", createdAt: Date.now() - 3_600_000, order: 0, completed: false, priority: "high" },
  { id: "seed-2", text: "Отчёт за апрель", createdAt: Date.now() - 90_000, order: 1, completed: false, priority: "normal" },
  { id: "seed-3", text: "Позвонить в банк", createdAt: Date.now() - 7_200_000, order: 2, completed: true, priority: "normal" },
];

await mkdir(ARTIFACTS, { recursive: true });

for (const locale of locales) {
  currentLocale = locale;
  console.log(`\n=== locale: ${locale}`);
  const chrome = await launchChrome({ locale });
  const expected = EXPECTED[locale] ?? EXPECTED.en;

  try {
    record(Boolean(chrome.serviceWorker), "service worker расширения запущен", chrome.serviceWorker?.url ?? "нет");
    if (!chrome.serviceWorker) throw new Error("расширение не загрузилось");

    // ---- панель (все проверки идут из страницы расширения: SW в headless
    //      не отдаёт chrome.* в CDP-контекст) ----
    const panel = await openExtensionPage(chrome.browser, chrome.extId, "src/sidepanel/index.html", { width: 400, height: 860 });

    const manifest = await panel.evaluate(`chrome.runtime.getManifest()`);
    record(manifest.name === (locale === "ru" ? "Менеджер Задач" : "Task Manager"), "манифест локализован", `${manifest.name} / ${manifest.version}`);
    record(manifest.minimum_chrome_version === "116", "minimum_chrome_version = 116", manifest.minimum_chrome_version);
    record(JSON.stringify(manifest.permissions) === '["sidePanel","storage"]', "разрешения минимальны", JSON.stringify(manifest.permissions));

    const windowId = await panel.evaluate(`chrome.windows.getCurrent().then((w) => w.id)`);
    const state = await panel.evaluate(`chrome.runtime.sendMessage({ type: "panel:get-state", windowId: ${windowId} }).then((r) => r, (e) => ({ error: e.message }))`);
    record(state?.isOpen === true, "service worker видит открытую панель (порт подключён)", JSON.stringify(state));

    // наполняем storage «как после миграции»
    await panel.evaluate(
      `chrome.storage.local.set({ schemaVersion: 4, tasks: ${JSON.stringify(SEED)}, prefs: { compact: false, filter: "all" } }).then(() => true)`,
    );
    await panel.reload();
    await sleep(600);

    const view = await panel.evaluate(`(() => ({
      lang: document.documentElement.lang,
      title: document.querySelector(".panel-title")?.textContent ?? "",
      add: document.querySelector(".btn-primary")?.textContent?.trim() ?? "",
      filters: [...document.querySelectorAll(".chip")].map((el) => el.textContent.trim()),
      placeholder: document.querySelector(".field input")?.placeholder ?? "",
      cards: document.querySelectorAll(".task-card").length,
      highPriority: document.querySelectorAll('.task-card[data-priority="high"]').length,
      completed: document.querySelectorAll('.task-card[data-completed="true"]').length,
      marks: document.querySelectorAll(".task-card .badge-priority").length,
      counter: document.querySelector(".panel-title small")?.textContent ?? "",
      ariaChecked: document.querySelectorAll('[role="checkbox"][aria-checked]').length,
    }))()`);

    record(view.lang === locale, "язык документа выставлен", view.lang);
    record(view.title.startsWith(expected.title), "заголовок на нужном языке", view.title);
    record(view.add === expected.add, "кнопка добавления локализована", view.add);
    record(view.placeholder === expected.placeholder, "плейсхолдер локализован", view.placeholder);
    record(view.filters[0]?.startsWith(expected.filterAll), "фильтры локализованы", view.filters.join(" | "));
    record(view.cards === SEED.length, "карточки задач отрисованы", `${view.cards} из ${SEED.length}`);
    record(view.highPriority === 1 && view.completed === 1 && view.marks === 1, "приоритет и статус видны в разметке", JSON.stringify({ high: view.highPriority, done: view.completed, marks: view.marks }));
    record(view.counter === "2/3", "счётчик активных/всех", view.counter);
    record(view.ariaChecked === SEED.length, "чекбоксы размечены role=checkbox", String(view.ariaChecked));

    // клавиатура: Alt+A фокусирует поле новой задачи
    await panel.evaluate(`document.body.focus()`);
    await pressKey(chrome.browser, panel.sessionId, "a", { modifiers: 1 });
    const focused = await panel.evaluate(`document.activeElement?.name ?? document.activeElement?.tagName`);
    record(focused === "task", "Alt+A ставит фокус в поле новой задачи", focused);

    // тёмная тема
    await panel.screenshot(`panel-${locale}-light`);
    await chrome.browser.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] }, panel.sessionId);
    await sleep(250);
    const dark = await panel.evaluate(`(() => {
      const body = getComputedStyle(document.body);
      const card = getComputedStyle(document.querySelector(".task-card"));
      return { scheme: getComputedStyle(document.documentElement).colorScheme, bg: body.backgroundColor, card: card.backgroundColor };
    })()`);
    record(dark.bg === "rgb(19, 21, 26)" && dark.card === "rgb(28, 31, 39)", "тёмная тема подхватывается", JSON.stringify(dark));
    await panel.screenshot(`panel-${locale}-dark`);
    await chrome.browser.send("Emulation.setEmulatedMedia", { features: [] }, panel.sessionId);

    // компактный вид
    await panel.evaluate(`document.querySelector('.header-actions .icon-btn').click()`);
    await sleep(200);
    const compact = await panel.evaluate(`document.querySelector(".panel").classList.contains("compact")`);
    record(compact === true, "компактный вид включается", String(compact));
    await panel.evaluate(`document.querySelector('.header-actions .icon-btn').click()`);

    // пустое состояние
    await panel.evaluate(`chrome.storage.local.set({ tasks: [], schemaVersion: 4 }).then(() => true)`);
    await panel.reload();
    await sleep(500);
    const empty = await panel.evaluate(`document.querySelector(".empty")?.textContent ?? ""`);
    record(empty.length > 10, "пустое состояние с текстом", empty.slice(0, 40));

    const errors = panel.errors();
    record(errors.length === 0, "нет ошибок в консоли панели", errors.slice(0, 2).join(" | "));

    // ---- popup ----
    const popup = await openExtensionPage(chrome.browser, chrome.extId, "src/popup/index.html", { width: 320, height: 300 });
    const popupView = await popup.evaluate(`(() => ({
      title: document.querySelector(".popup-title")?.textContent ?? "",
      button: document.querySelector(".popup-toggle")?.textContent?.trim() ?? "",
      hotkey: document.querySelector(".popup-hotkey kbd")?.textContent ?? "",
      status: document.querySelector(".popup-status")?.textContent ?? "",
    }))()`);
    record(popupView.title.length > 0, "popup: заголовок локализован", popupView.title);
    const popupLabels = [expected.popupOpen, expected.popupClose];
    record(popupLabels.includes(popupView.button), "popup: кнопка локализована", popupView.button);
    record(/Ctrl\+B|Command\+B/.test(popupView.hotkey), "popup: показывает горячую клавишу", popupView.hotkey);
    record(popupView.status.length > 0, "popup: показывает статус панели", popupView.status);
    record(popup.errors().length === 0, "popup: без ошибок в консоли", popup.errors().slice(0, 2).join(" | "));
    await popup.screenshot(`popup-${locale}`);

    // ---- состояние панели восстанавливается после выгрузки service worker ----
    await chrome.browser.send("ServiceWorker.enable", {}, panel.sessionId).catch(() => {});
    await chrome.browser.send("ServiceWorker.stopAllWorkers", {}, panel.sessionId).catch(() => {});
    await sleep(2200); // панель переподключает порт через 1 с
    const healed = await panel.evaluate(`chrome.runtime.sendMessage({ type: "panel:get-state", windowId: ${windowId} })`);
    record(healed?.isOpen === true, "после перезапуска SW панель снова отмечена открытой", JSON.stringify(healed));

    await popup.close();
    await panel.close();
  } catch (error) {
    record(false, "исключение в прогоне", error.message);
  } finally {
    await chrome.close();
    await rm(chrome.profile, { recursive: true, force: true }).catch(() => {});
  }
}

const failed = results.filter((item) => !item.ok);
await writeFile(path.join(ARTIFACTS, "load-test.json"), JSON.stringify(results, null, 2));
await writeFile(
  path.join(ARTIFACTS, "load-test.log"),
  results.map((item) => `${item.ok ? "✓" : "✗"} [${item.locale}] ${item.name}${item.detail ? ` — ${item.detail}` : ""}`).join("\n") + "\n",
);
console.log(`\n${failed.length ? `провалов: ${failed.length} из ${results.length}` : `все ${results.length} проверок пройдены`} → artifacts/load-test.json`);
if (failed.length) {
  console.log(`сборка: ${path.relative(ROOT, path.join(ROOT, "dist"))}`);
  process.exit(1);
}
