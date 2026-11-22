#!/usr/bin/env node
/**
 * Статическая проверка собранного расширения и исходников.
 * Быстро (без браузера) ловит то, что чаще всего ломает публикацию:
 * манифест, локали, иконки, неиспользуемые разрешения, i18n-ключи, гигиену кода.
 *
 * Запуск: npm run validate   (после npm run build)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist");
const SRC = path.join(ROOT, "src");

const results = [];
const fail = (name, detail = "") => results.push({ ok: false, name, detail });
const pass = (name, detail = "") => results.push({ ok: true, name, detail });

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function walk(dir, filter = () => true, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, filter, out);
    else if (filter(full)) out.push(full);
  }
  return out;
}

function pngSize(file) {
  const buffer = readFileSync(file);
  const isPng = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!isPng) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** Разрешённый минимум: всё остальное — лишние предупреждения в Web Store. */
const ALLOWED_PERMISSIONS = new Set(["sidePanel", "storage"]);
const REQUIRED_ICON_SIZES = [16, 32, 48, 128];

// ---------------------------------------------------------------- манифест
if (!existsSync(path.join(DIST, "manifest.json"))) {
  console.error("нет dist/manifest.json — сначала `npm run build`");
  process.exit(1);
}
const manifest = readJson(path.join(DIST, "manifest.json"));
const pkg = readJson(path.join(ROOT, "package.json"));

manifest.manifest_version === 3 ? pass("manifest_version = 3") : fail("manifest_version = 3", manifest.manifest_version);
manifest.version === pkg.version
  ? pass(`версия совпадает с package.json: ${manifest.version}`)
  : fail("версия совпадает с package.json", `manifest ${manifest.version} ≠ package ${pkg.version}`);
manifest.minimum_chrome_version
  ? pass(`minimum_chrome_version = ${manifest.minimum_chrome_version}`)
  : fail("minimum_chrome_version задан");
manifest.default_locale ? pass(`default_locale = ${manifest.default_locale}`) : fail("default_locale задан");

// ---------------------------------------------------------------- локали
const localeDirs = existsSync(path.join(DIST, "_locales"))
  ? readdirSync(path.join(DIST, "_locales"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  : [];
localeDirs.length ? pass(`локали в сборке: ${localeDirs.join(", ")}`) : fail("каталог _locales в сборке");

const messages = {};
for (const locale of localeDirs) {
  const file = path.join(DIST, "_locales", locale, "messages.json");
  if (!existsSync(file)) {
    fail(`_locales/${locale}/messages.json существует`);
    continue;
  }
  messages[locale] = readJson(file);
}

const locales = Object.keys(messages);

// Chrome молча не загружает расширение, если запись в messages.json не объект
// с непустым message. Такое легко получить скриптом — проверяем явно.
const malformed = [];
for (const [locale, table] of Object.entries(messages)) {
  for (const [key, value] of Object.entries(table)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) malformed.push(`${locale}:${key} — не объект`);
    else if (typeof value.message !== "string" || !value.message.trim()) malformed.push(`${locale}:${key} — пустой message`);
  }
}
malformed.length
  ? fail("записи messages.json корректной формы", malformed.slice(0, 6).join("; "))
  : pass(`записи messages.json корректны (${Object.keys(messages[locales[0]] ?? {}).length} ключей)`);
if (messages[manifest.default_locale ?? "ru"]) pass(`локаль по умолчанию (${manifest.default_locale}) присутствует`);
else fail(`локаль по умолчанию (${manifest.default_locale}) присутствует`);

const keySets = locales.map((locale) => new Set(Object.keys(messages[locale])));
if (keySets.length > 1) {
  const union = new Set(keySets.flatMap((set) => [...set]));
  const missing = locales.flatMap((locale, index) => [...union].filter((key) => !keySets[index].has(key)).map((key) => `${locale}:${key}`));
  missing.length ? fail("набор i18n-ключей одинаков во всех локалях", missing.slice(0, 8).join(", ")) : pass("набор i18n-ключей одинаков во всех локалях");
}

// подстановки $1/$2 должны совпадать по количеству
const placeholderIssues = [];
for (const key of keySets[0] ?? []) {
  const counts = locales.map((locale) => (messages[locale]?.[key]?.message?.match(/\$\d/g) ?? []).length);
  if (new Set(counts).size > 1) placeholderIssues.push(`${key} (${counts.join("/")})`);
}
placeholderIssues.length ? fail("подстановки $n согласованы между локалями", placeholderIssues.join(", ")) : pass("подстановки $n согласованы между локалями");

// __MSG_*__ в манифесте должны разрешаться во всех локалях
const msgRefs = new Set();
JSON.stringify(manifest).replace(/__MSG_([A-Za-z0-9_@]+)__/g, (_match, key) => {
  msgRefs.add(key);
  return "";
});
const unresolved = [...msgRefs].filter((key) => locales.some((locale) => !messages[locale]?.[key]?.message));
unresolved.length ? fail("все __MSG_*__ из манифеста есть в локалях", unresolved.join(", ")) : pass(`__MSG_*__ из манифеста разрешаются (${[...msgRefs].join(", ")})`);

// ---------------------------------------------------------------- иконки
const icons = manifest.icons ?? {};
const iconIssues = [];
for (const size of REQUIRED_ICON_SIZES) {
  const file = icons[size];
  if (!file) {
    iconIssues.push(`нет ${size}px`);
    continue;
  }
  const full = path.join(DIST, file);
  if (!existsSync(full)) {
    iconIssues.push(`${file} отсутствует`);
    continue;
  }
  const dimensions = pngSize(full);
  if (!dimensions) iconIssues.push(`${file} не PNG`);
  else if (dimensions.width !== size || dimensions.height !== size) iconIssues.push(`${file} ${dimensions.width}×${dimensions.height} ≠ ${size}`);
}
iconIssues.length ? fail("иконки 16/32/48/128 на месте и нужного размера", iconIssues.join("; ")) : pass("иконки 16/32/48/128 на месте и нужного размера");

// ---------------------------------------------------------------- файлы из манифеста
const referenced = [
  manifest.action?.default_popup,
  manifest.side_panel?.default_path,
  manifest.background?.service_worker,
  ...Object.values(manifest.action?.default_icon ?? {}),
].filter(Boolean);
const missingFiles = referenced.filter((file) => !existsSync(path.join(DIST, file)));
missingFiles.length ? fail("все пути из манифеста есть в сборке", missingFiles.join(", ")) : pass(`пути из манифеста существуют (${referenced.length})`);

// ---------------------------------------------------------------- разрешения
const permissions = manifest.permissions ?? [];
const extra = permissions.filter((permission) => !ALLOWED_PERMISSIONS.has(permission));
extra.length ? fail("нет лишних разрешений", extra.join(", ")) : pass(`разрешения минимальны: ${permissions.join(", ")}`);
permissions.includes("tabs") ? fail("разрешение tabs не требуется", "id вкладки доступен без него") : pass("разрешение tabs не запрошено");
permissions.includes("commands") ? fail("commands не является разрешением", "уберите из permissions") : pass("commands не указан в permissions");

// ---------------------------------------------------------------- i18n в коде
const tsxFiles = walk(SRC, (file) => file.endsWith(".ts") || file.endsWith(".tsx"));
const usedKeys = new Set();
for (const file of tsxFiles) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/\bt\(\s*"([A-Za-z0-9_@]+)"/g)) usedKeys.add(match[1]);
}
const definedKeys = new Set(Object.keys(messages[manifest.default_locale] ?? {}));
const unknown = [...usedKeys].filter((key) => !definedKeys.has(key));
unknown.length ? fail("все ключи t() определены в локалях", unknown.join(", ")) : pass(`ключи t() определены (${usedKeys.size})`);
const unused = [...definedKeys].filter((key) => !usedKeys.has(key) && !msgRefs.has(key));
unused.length ? pass("есть ключи без использования (не ошибка)", unused.join(", ")) : pass("все ключи используются");

// ---------------------------------------------------------------- гигиена кода
const hygiene = [
  [/console\.log\(/, "console.log в коде"],
  [/innerHTML|dangerouslySetInnerHTML/, "innerHTML/dangerouslySetInnerHTML"],
  [/\beval\s*\(/, "eval()"],
  [/document\.write\(/, "document.write"],
];
const violations = [];
for (const file of tsxFiles) {
  if (file.endsWith(".test.ts") || file.includes("testUtils")) continue;
  const source = readFileSync(file, "utf8");
  for (const [pattern, label] of hygiene) if (pattern.test(source)) violations.push(`${path.relative(ROOT, file)}: ${label}`);
}
violations.length ? fail("гигиена кода", violations.join("; ")) : pass("нет console.log/innerHTML/eval в исходниках");

const storageUsers = tsxFiles
  .filter((file) => /(?:globalThis|window|self)\.localStorage|\blocalStorage\s*\./.test(readFileSync(file, "utf8")))
  .map((file) => path.relative(ROOT, file));
const storageAllowed = (file) => /storage(\.test)?\.ts$|testUtils\.ts$/.test(file);
const storageOk = storageUsers.every(storageAllowed);
storageOk ? pass("localStorage используется только в модуле миграции") : fail("localStorage вне модуля миграции", storageUsers.join(", "));

const swSource = readFileSync(path.join(SRC, "background/service-worker.ts"), "utf8");
/chrome\.sidePanel\.open|chrome\.sidePanel\.close/.test(swSource)
  ? fail("service worker не открывает панель напрямую", "жест теряется при вызове через сообщение")
  : pass("service worker не открывает панель напрямую");

// ---------------------------------------------------------------- HTML
const htmlFiles = walk(DIST, (file) => file.endsWith(".html"));
const remoteRefs = [];
for (const file of htmlFiles) {
  const html = readFileSync(file, "utf8");
  if (/<script[^>]+src="https?:/i.test(html) || /<link[^>]+href="https?:\/\//i.test(html)) remoteRefs.push(path.relative(DIST, file));
}
remoteRefs.length ? fail("в HTML нет внешних скриптов/стилей", remoteRefs.join(", ")) : pass(`HTML без внешних ресурсов (${htmlFiles.length} файл(а))`);

// ---------------------------------------------------------------- артефакты поставки
const releaseDir = path.join(ROOT, "release");
const zips = existsSync(releaseDir) ? readdirSync(releaseDir).filter((file) => file.endsWith(".zip")) : [];
if (!zips.length) fail("zip-архив для Web Store собран");
else {
  const zip = zips.map((file) => ({ file, size: statSync(path.join(releaseDir, file)).size })).sort((a, b) => b.size - a.size)[0];
  zip.size > 100_000 ? pass(`zip собран: release/${zip.file} (${Math.round(zip.size / 1024)} КБ)`) : fail("zip непустой", `${zip.size} B`);
  zip.file.includes(pkg.version) ? pass("версия в имени zip") : fail("версия в имени zip", zip.file);
}

// ---------------------------------------------------------------- вывод
let failed = 0;
const failures = results.filter((result) => !result.ok);
mkdirSync(path.join(ROOT, "artifacts"), { recursive: true });
writeFileSync(
  path.join(ROOT, "artifacts", "validate.json"),
  JSON.stringify({ results, manifest, failed: failures.length }, null, 2),
);
for (const result of results) {
  if (!result.ok) failed += 1;
  console.log(`  ${result.ok ? "✓" : "✗"} ${result.name}${result.detail ? ` — ${result.detail}` : ""}`);
}
console.log(`\n${result_summary()}`);
function result_summary() {
  const total = results.length;
  return failed ? `провалов: ${failed} из ${total}` : `все ${total} проверок пройдены`;
}
process.exit(failed ? 1 : 0);
