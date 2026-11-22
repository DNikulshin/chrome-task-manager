import { useEffect } from "react";
import type { PanelHello } from "@/types";

/**
 * Постоянное соединение панели с service worker.
 *
 * SW в MV3 выгружается при простое, и вместе с ним теряется порт. Поэтому панель
 * переподключается (с паузой) и каждый раз заново сообщает свой windowId —
 * так состояние «в каком окне открыта панель» восстанавливается само.
 */
export function usePanelPort(): void {
  useEffect(() => {
    let port: chrome.runtime.Port | null = null;
    let retry: number | undefined;
    let disposed = false;

    const schedule = () => {
      if (disposed || retry !== undefined) return;
      retry = window.setTimeout(() => {
        retry = undefined;
        connect();
      }, 1000);
    };

    const connect = () => {
      if (disposed) return;
      try {
        port = chrome.runtime.connect({ name: "sidepanel" });
      } catch {
        schedule();
        return;
      }
      port.onDisconnect.addListener(() => {
        port = null;
        schedule();
      });
      void chrome.windows
        .getCurrent()
        .then((win) => {
          if (win.id === undefined || !port) return;
          const hello: PanelHello = { type: "panel:hello", windowId: win.id };
          port.postMessage(hello);
        })
        .catch(() => {});
    };

    connect();

    return () => {
      disposed = true;
      if (retry !== undefined) window.clearTimeout(retry);
      port?.disconnect();
      port = null;
    };
  }, []);
}
