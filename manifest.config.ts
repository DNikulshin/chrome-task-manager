import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json" with { type: "json" };

/**
 * Манифест собирается из одного источника: версия — из package.json,
 * тексты — из _locales (public/_locales/ru|en/messages.json).
 *
 * Разрешений только два: sidePanel и storage. tabs/activeTab не нужны —
 * id вкладки и окна доступны без разрешений, а недоступность панели на
 * системных страницах ловится по ошибке sidePanel.open().
 */
export default defineManifest({
  manifest_version: 3,
  name: "__MSG_extName__",
  description: "__MSG_extDescription__",
  version: pkg.version,
  default_locale: "ru",
  // sidePanel.open() — Chrome 116. Более новые API определяются в рантайме.
  minimum_chrome_version: "116",
  icons: {
    16: "icon/icon16.png",
    32: "icon/icon32.png",
    48: "icon/icon48.png",
    128: "icon/icon128.png",
  },
  action: {
    default_title: "__MSG_extName__",
    default_icon: {
      16: "icon/icon16.png",
      32: "icon/icon32.png",
      48: "icon/icon48.png",
      128: "icon/icon128.png",
    },
    default_popup: "src/popup/index.html",
  },
  side_panel: {
    default_path: "src/sidepanel/index.html",
  },
  background: {
    service_worker: "src/background/service-worker.ts",
    type: "module",
  },
  permissions: ["sidePanel", "storage"],
  commands: {
    "open-panel": {
      suggested_key: {
        default: "Ctrl+B",
        mac: "Command+B",
      },
      description: "__MSG_commandOpenPanel__",
    },
  },
});
