/** Ключи и версия схемы storage. Отдельный модуль, чтобы не было циклов импортов. */

export const SCHEMA_VERSION = 4;

export const KEYS = {
  /** Актуальный список задач (схема 4). */
  tasks: "tasks",
  /** Настройки интерфейса. */
  prefs: "prefs",
  /** Версия схемы, записанная последней миграцией. */
  schema: "schemaVersion",
  /** Копия данных, перенесённых из прошлых версий расширения. */
  legacy: "legacyBackup",
  /** Ключ, которым пользовалась версия 3.0 (vanilla JS). */
  legacyV3: "tasks_v3",
} as const;

/** Ключ, которым пользовалась версия 1.x (React + localStorage). */
export const LEGACY_LOCAL_STORAGE_KEY = "tasks";
