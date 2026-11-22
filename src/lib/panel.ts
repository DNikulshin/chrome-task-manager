/**
 * Открытие/закрытие боковой панели и учёт её состояния.
 *
 * chrome.sidePanel.close() появился в Chrome 141, onOpened/onClosed — в 141/142.
 * Поэтому состояние ведём так:
 *   1) есть события onOpened/onClosed  → источник истины они;
 *   2) иначе — порт из панели (панель присылает свой windowId при подключении).
 * Для закрытия на старых версиях есть fallback через setOptions({enabled:false}).
 */

export type PanelEvent =
  | { type: "opened"; windowId: number }
  | { type: "closed"; windowId: number }
  | { type: "port-connected"; windowId: number }
  | { type: "port-disconnected"; windowId: number }
  | { type: "reset" };

/** Чистая функция перехода состояния: множество окон с открытой панелью. */
export function applyPanelEvent(open: ReadonlySet<number>, event: PanelEvent): Set<number> {
  const next = new Set(open);
  switch (event.type) {
    case "opened":
    case "port-connected":
      next.add(event.windowId);
      break;
    case "closed":
    case "port-disconnected":
      next.delete(event.windowId);
      break;
    case "reset":
      next.clear();
      break;
  }
  return next;
}

export function hasPanelEvents(): boolean {
  return typeof chrome?.sidePanel?.onOpened?.addListener === "function";
}

export function canClosePanelProgrammatically(): boolean {
  return typeof chrome?.sidePanel?.close === "function";
}

export const PANEL_PATH = "src/sidepanel/index.html";

/** Открыть панель в окне активной вкладки. Требует user gesture. */
export async function openPanel(tabId: number): Promise<void> {
  await chrome.sidePanel.open({ tabId });
}

/**
 * Закрыть панель. В Chrome 141+ есть close({windowId}). До этого API закрытия
 * не существовало: тогда гасим панель для активной вкладки через setOptions и
 * сразу включаем обратно, чтобы её можно было открыть снова.
 */
export async function closePanel(target: { windowId: number; tabId?: number }): Promise<void> {
  if (canClosePanelProgrammatically()) {
    await chrome.sidePanel.close({ windowId: target.windowId });
    return;
  }
  if (target.tabId === undefined) throw new Error("closing the side panel requires a tabId before Chrome 141");
  await chrome.sidePanel.setOptions({ tabId: target.tabId, enabled: false });
  await chrome.sidePanel.setOptions({ tabId: target.tabId, enabled: true, path: PANEL_PATH });
}

/** Человеческая причина отказа open() — чтобы не показывать «Ошибка запуска». */
export function describeOpenError(error: unknown): "restricted" | "unknown" {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /cannot|not allowed|user gesture|invalid|tab/i.test(message) ? "restricted" : "unknown";
}
