/**
 * Локализация интерфейса. Строки живут в _locales/<lang>/messages.json и
 * читаются через chrome.i18n.getMessage (учитывает intl.app_locale).
 */

export type Lang = "ru" | "en";

const SUPPORTED: readonly Lang[] = ["ru", "en"];

/** Язык, на котором реально отдаёт строки chrome.i18n. */
export function currentLang(): Lang {
  const raw = (globalThis.chrome?.i18n?.getUILanguage?.() ?? "en").toLowerCase();
  const base = raw.split("-")[0] as Lang;
  return SUPPORTED.includes(base) ? base : "en";
}

/**
 * getMessage возвращает "" для неизвестного ключа, поэтому в dev-сборке
 * подставляем сам ключ — validate.mjs проверяет, что таких не остаётся.
 */
export function t(key: string, substitutions?: string | string[]): string {
  const message = globalThis.chrome?.i18n?.getMessage?.(key, substitutions);
  return message || key;
}
