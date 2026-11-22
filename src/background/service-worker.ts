/**
 * Service worker: учёт того, в каких окнах открыта боковая панель.
 *
 * Источник истины — chrome.sidePanel.onOpened/onClosed (Chrome 141+).
 * На более старых версиях этих событий нет, поэтому состояние собирается
 * из жизни порта, который открывает страница панели (она присылает windowId).
 *
 * Обратите внимание: сам open()/close() вызывается из popup или из обработчика
 * команды — там, где есть user gesture. Через сообщение жест не передаётся,
 * поэтому в SW этих вызовов нет.
 */
import { applyPanelEvent, closePanel, hasPanelEvents, openPanel } from "@/lib/panel";
import type { PanelEvent } from "@/lib/panel";
import type { PanelHello } from "@/types";

const OPEN_COMMAND = "open-panel";
const PANEL_MESSAGE = "panel:state";
const GET_STATE_MESSAGE = "panel:get-state";

let openWindows = new Set<number>();
const eventsAvailable = hasPanelEvents();

function broadcast() {
  // Popup может быть закрыт — ошибка доставки ожидаема.
  chrome.runtime.sendMessage({ type: PANEL_MESSAGE, windows: [...openWindows] }).catch(() => {});
}

function update(event: PanelEvent) {
  const next = applyPanelEvent(openWindows, event);
  if (next.size === openWindows.size && [...next].every((id) => openWindows.has(id))) return;
  openWindows = next;
  broadcast();
}

if (eventsAvailable) {
  chrome.sidePanel.onOpened.addListener((info) => update({ type: "opened", windowId: info.windowId }));
  chrome.sidePanel.onClosed.addListener((info) => update({ type: "closed", windowId: info.windowId }));
}

/**
 * Порт панели. При подключении всегда отмечаем окно открытым: это лечит случай,
 * когда service worker выгрузился и потерял накопленное состояние. Закрытие
 * определяют события (Chrome 141+); на старых версиях — обрыв порта.
 */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "sidepanel") return;
  let windowId: number | null = null;
  port.onMessage.addListener((message: PanelHello) => {
    if (message?.type !== "panel:hello" || typeof message.windowId !== "number") return;
    windowId = message.windowId;
    update({ type: "port-connected", windowId });
  });
  port.onDisconnect.addListener(() => {
    if (!eventsAvailable && windowId !== null) update({ type: "port-disconnected", windowId });
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== GET_STATE_MESSAGE) return;
  sendResponse({ windows: [...openWindows], isOpen: openWindows.has(message.windowId) });
  return true;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== OPEN_COMMAND) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || tab.windowId === undefined) return;
  const windowId = tab.windowId;
  try {
    if (openWindows.has(windowId)) await closePanel({ windowId, tabId: tab.id });
    else await openPanel(tab.id);
  } catch (error) {
    // Системные страницы (chrome://, chrome-extension://) панель не открывают.
    console.warn("panel toggle failed", error);
  }
});
