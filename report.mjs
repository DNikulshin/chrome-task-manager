#!/usr/bin/env node
/**
 * Собирает artifacts/report.html (+ index.html для публикации) из результатов
 * всех слоёв проверок: юнит-тесты, статика, браузерный дым, E2E, скриншоты.
 *
 * Запуск: npm run report   (или node report.mjs — данные берутся из artifacts/)
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const ROOT = import.meta.dirname;
const ART = path.join(ROOT, "artifacts");
await mkdir(ART, { recursive: true });

const readJson = async (file, fallback = null) => {
  try {
    return JSON.parse(await readFile(path.join(ART, file), "utf8"));
  } catch {
    return fallback;
  }
};

// --- юнит-тесты: прогоняем с json-репортёром, чтобы цифры были настоящими
let unit = { total: 0, passed: 0, failed: 0 };
try {
  await run("npx", ["vitest", "run", "--reporter=json", "--outputFile", path.join(ART, "unit.json")], {
    cwd: ROOT,
  });
} catch {
  /* падение тестов отразится в unit.json */
}
const unitJson = await readJson("unit.json");
if (unitJson) {
  unit = {
    total: unitJson.numTotalTests ?? 0,
    passed: unitJson.numPassedTests ?? 0,
    failed: unitJson.numFailedTests ?? 0,
    files: (unitJson.testResults ?? []).length,
    duration: unitJson.testResults?.reduce((sum, file) => sum + (file.endTime - file.startTime), 0) ?? 0,
  };
}

const validate = await readJson("validate.json", { results: [], failed: 0 });
const load = await readJson("load-test.json", []);
const e2e = await readJson("e2e.json", []);
const screenshotFiles = (await readdir(ART).catch(() => [])).filter((file) => file.endsWith(".png")).sort();

const manifest = validate.manifest ?? {};
const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));

const total = (arr) => arr.length;
const failedCount = (arr) => arr.filter((item) => item.ok === false || item.status === "✗").length;

const layers = [
  {
    name: "Юнит-тесты",
    command: "npm test",
    total: unit.total,
    failed: unit.failed,
    detail: `${unit.files ?? 0} файлов, ${Math.round((unit.duration ?? 0) / 100) / 10} с`,
  },
  {
    name: "Статика (манифест, локали, иконки)",
    command: "npm run validate",
    total: total(validate.results),
    failed: validate.failed ?? 0,
    detail: `manifest_version ${manifest.manifest_version}, ${manifest.permissions?.length ?? 0} разрешения`,
  },
  {
    name: "Браузерный дым (ru + en)",
    command: "npm run load-test",
    total: total(load),
    failed: failedCount(load),
    detail: "Chrome for Testing, headless",
  },
  {
    name: "E2E-сценарий",
    command: "npm run e2e",
    total: total(e2e),
    failed: failedCount(e2e),
    detail: "миграция, drag&drop, поиск, экспорт/импорт, undo",
  },
];

const esc = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const statusRow = (ok, name, detail) =>
  `<tr><td class="st ${ok ? "ok" : "bad"}">${ok ? "✓" : "✗"}</td><td>${esc(name)}</td><td class="mut">${esc(detail)}</td></tr>`;

const loadRows = load
  .map((row) => statusRow(row.ok, `[${row.locale}] ${row.name}`, row.detail))
  .join("");
const e2eRows = e2e.map((row) => statusRow(row.ok, row.name, row.detail)).join("");
const validateRows = validate.results
  .map((row) => statusRow(row.ok, row.name, row.detail))
  .join("");
const failures = [...load, ...e2e].filter((row) => !row.ok);

const layerCards = layers
  .map(
    (layer) => `<div class="card">
      <div class="num ${layer.failed ? "bad" : "ok"}">${layer.failed ? `${layer.failed}/${layer.total}` : layer.total}</div>
      <div class="card-name">${esc(layer.name)}</div>
      <div class="mut">${esc(layer.detail)}</div>
      <code>${esc(layer.command)}</code>
    </div>`,
  )
  .join("");

const shots = screenshotFiles
  .map((file) => `<figure><img src="${esc(file)}" alt="${esc(file)}"><figcaption>${esc(file)}</figcaption></figure>`)
  .join("");

const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Менеджер Задач ${esc(pkg.version)} — отчёт о проверках</title>
<style>
  :root {
    --ink: #16181d; --mut: #6b7280; --line: #e5e7eb; --bg: #f6f7fb;
    --card: #fff; --ok: #15803d; --bad: #b91c1c; --brand: #4f46e5;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--ink); background: var(--bg); }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 34px 20px 70px; }
  h1 { font-size: 1.7rem; margin: 0 0 4px; letter-spacing: -0.01em; }
  h2 { font-size: 1.08rem; margin: 36px 0 12px; padding-bottom: 6px; border-bottom: 2px solid var(--line); }
  .sub { color: var(--mut); margin: 0 0 26px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(215px, 1fr)); gap: 14px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px; }
  .num { font-size: 1.9rem; font-weight: 700; line-height: 1.1; }
  .num.ok { color: var(--ok); } .num.bad { color: var(--bad); }
  .card-name { font-weight: 600; margin-top: 2px; }
  .mut { color: var(--mut); font-size: 0.82rem; }
  code { display: inline-block; margin-top: 6px; padding: 1px 6px; border-radius: 5px; background: #eef2ff; font-size: 0.78rem; color: #3730a3; }
  table { width: 100%; border-collapse: collapse; background: var(--card); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; font-size: 0.86rem; }
  td { padding: 8px 11px; border-top: 1px solid var(--line); vertical-align: top; }
  tr:first-child td { border-top: none; }
  td.st { width: 26px; text-align: center; font-weight: 700; }
  td.st.ok { color: var(--ok); } td.st.bad { color: var(--bad); }
  .shots { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px; }
  figure { margin: 0; background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 8px; }
  figure img { width: 100%; display: block; border-radius: 7px; }
  figcaption { font-size: 0.72rem; color: var(--mut); padding-top: 6px; }
  .verdict { padding: 12px 16px; border-radius: 12px; font-weight: 600; }
  .verdict.ok { background: #ecfdf5; color: var(--ok); border: 1px solid #a7f3d0; }
  .verdict.bad { background: #fef2f2; color: var(--bad); border: 1px solid #fecaca; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Менеджер Задач ${esc(pkg.version)} — отчёт о проверках</h1>
  <p class="sub">Собрано ${new Date().toLocaleString("ru")} · Chrome for Testing (headless) · расширение загружено распакованным</p>

  <div class="verdict ${failures.length ? "bad" : "ok"}">
    ${failures.length ? `Провалов: ${failures.length}` : "Все проверки пройдены"}
  </div>

  <h2>Слои проверок</h2>
  <div class="grid">${layerCards}</div>

  <h2>Статика: манифест, локали, иконки</h2>
  <table>${validateRows}</table>

  <h2>Браузерный дым</h2>
  <table>${loadRows}</table>

  <h2>E2E-сценарий</h2>
  <table>${e2eRows}</table>

  <h2>Скриншоты</h2>
  <div class="shots">${shots}</div>
</div>
</body>
</html>`;

await writeFile(path.join(ART, "report.html"), html);
await writeFile(path.join(ART, "index.html"), html);
console.log(`artifacts/report.html (${Math.round(html.length / 1024)} КБ) · провалов: ${failures.length}`);
if (failures.length) process.exitCode = 1;
