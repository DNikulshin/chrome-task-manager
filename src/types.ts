/** Доменные типы. Всё, что попадает в storage, описано здесь. */

export type Priority = "high" | "normal";

export type Filter = "all" | "active" | "completed";

export interface Task {
  id: string;
  text: string;
  createdAt: number;
  /** Единственный ключ сортировки. Приоритет на порядок не влияет. */
  order: number;
  completed: boolean;
  priority: Priority;
}

export interface Prefs {
  compact: boolean;
  filter: Filter;
}

/** Формат файла экспорта. `version` — версия схемы, не версия расширения. */
export interface BackupFile {
  app: "chrome-task-manager";
  version: number;
  exportedAt: string;
  tasks: Task[];
}

/** Сообщение панель → service worker. */
export interface PanelHello {
  type: "panel:hello";
  windowId: number;
}
