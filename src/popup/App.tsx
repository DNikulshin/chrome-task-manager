import { useEffect, useState } from "react";
import { closePanel, describeOpenError, openPanel } from "@/lib/panel";
import { KEYS } from "@/lib/storageKeys";
import { countTasks } from "@/lib/tasks";
import { t } from "@/lib/i18n";
import type { Task } from "@/types";

interface PanelState {
  windows: number[];
  isOpen: boolean;
}

export default function App() {
  const [shortcut, setShortcut] = useState("Ctrl+B");
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [counts, setCounts] = useState({ active: 0, completed: 0 });

  useEffect(() => {
    chrome.commands.getAll((commands) => {
      const command = commands.find((item) => item.name === "open-panel");
      if (command?.shortcut) setShortcut(command.shortcut);
    });

    chrome.storage.local.get(KEYS.tasks).then((stored) => {
      const tasks = Array.isArray(stored[KEYS.tasks]) ? (stored[KEYS.tasks] as Task[]) : [];
      const totals = countTasks(tasks);
      setCounts({ active: totals.active, completed: totals.completed });
    });

    void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (!tab?.windowId) return;
      chrome.runtime.sendMessage({ type: "panel:get-state", windowId: tab.windowId }).then(
        (state: PanelState | undefined) => setIsOpen(Boolean(state?.isOpen)),
        () => setIsOpen(false),
      );
    });

    const onMessage = (message: { type?: string; windows?: number[] }) => {
      if (message?.type !== "panel:state" || !Array.isArray(message.windows)) return;
      void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
        if (tab?.windowId) setIsOpen(message.windows!.includes(tab.windowId));
      });
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || tab.windowId === undefined) {
        setError(t("errorPanelOpen"));
        return;
      }
      if (isOpen) {
        await closePanel({ windowId: tab.windowId, tabId: tab.id });
        setIsOpen(false);
        return;
      }
      try {
        await openPanel(tab.id);
        setIsOpen(true);
        window.close();
      } catch (cause) {
        const reason = describeOpenError(cause);
        setError(reason === "restricted" ? t("errorPanelRestricted") : t("errorPanelOpen"));
        console.warn("sidePanel.open failed", cause);
      }
    } catch (cause) {
      if (isOpen) setError(t("errorPanelClose"));
      else setError(t("errorPanelOpen"));
      console.warn("panel toggle failed", cause);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="popup">
      <div className="popup-head">
        <h1 className="popup-title">{t("extName")}</h1>
      </div>

      <button type="button" className="popup-toggle" data-open={isOpen} onClick={toggle} aria-busy={busy}>
        {isOpen ? t("popupClose") : t("popupOpen")}
      </button>

      <p className="popup-status" role="status">
        {isOpen ? t("popupStatusOpen") : t("popupStatusClosed")}
      </p>

      {error && (
        <p className="popup-error" role="alert">
          {error}
        </p>
      )}

      <p className="popup-status">{t("popupCounts", [String(counts.active), String(counts.completed)])}</p>

      <div className="popup-section">
        <p className="popup-label">{t("popupHotkeyLabel")}</p>
        <div className="popup-hotkey">
          <kbd>{shortcut}</kbd>
          <button
            type="button"
            className="popup-link"
            onClick={() => chrome.tabs.create({ url: "chrome://extensions/shortcuts" })}
          >
            {t("popupHotkeyChange")}
          </button>
        </div>
        <p className="popup-label" style={{ marginTop: 6 }}>
          {t("popupHotkeyHint")}
        </p>
      </div>
    </div>
  );
}
