/**
 * Общий каркас для браузерных проверок: запуск Chrome for Testing с загруженным
 * распакованным расширением + минимальный CDP-клиент.
 *
 * Важно: с Chrome 137 branded Chrome игнорирует --load-extension, поэтому нужен
 * Chrome for Testing / Chromium. Порядок поиска: CHROME_BIN → tools/chrome-linux64
 * → кэш Playwright → системный бинарь (с предупреждением).
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "..");
export const DIST = path.join(ROOT, "dist");
export const ARTIFACTS = path.join(ROOT, "artifacts");
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function extensionId(absPath) {
  const hex = createHash("sha256").update(absPath).digest("hex").slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
}

export async function findChrome() {
  if (process.env.CHROME_BIN) return { bin: process.env.CHROME_BIN, why: "CHROME_BIN" };
  const local = path.join(ROOT, "tools", "chrome-linux64", "chrome");
  if (existsSync(local)) return { bin: local, why: "tools/chrome-linux64" };
  const playwright = path.join(os.homedir(), ".cache", "ms-playwright");
  if (existsSync(playwright)) {
    const dirs = (await readdir(playwright)).filter((dir) => dir.startsWith("chromium-")).sort().reverse();
    for (const dir of dirs) {
      const bin = path.join(playwright, dir, "chrome-linux64", "chrome");
      if (existsSync(bin)) return { bin, why: `Playwright ${dir}` };
    }
  }
  for (const bin of ["/usr/bin/google-chrome", "/usr/bin/chromium"]) {
    if (existsSync(bin)) return { bin, why: `${bin} (--load-extension может быть заблокирован)` };
  }
  throw new Error("Chrome не найден: задайте CHROME_BIN или положите Chrome for Testing в tools/");
}

export async function waitFor(fn, { timeout = 20_000, interval = 200 } = {}) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeout) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(interval);
  }
  throw lastError ?? new Error(`timeout ${timeout}ms`);
}

/** Минимальный CDP-клиент: send + накопление событий. */
export async function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error(`не удалось подключиться к CDP: ${wsUrl}`));
  });
  let seq = 0;
  const pending = new Map();
  const events = [];
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.method) events.push(message);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(`${message.error.message} (${entry.method})`));
    else entry.resolve(message.result);
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject, method });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  return { send, events, close: () => socket.close() };
}

/**
 * Запуск браузера с расширением. Язык задаётся и флагом --lang, и
 * intl.app_locale — именно последний читает chrome.i18n.getMessage().
 */
export async function launchChrome({ locale = "ru", userDataDir } = {}) {
  if (!existsSync(path.join(DIST, "manifest.json"))) {
    throw new Error("нет dist/manifest.json — сначала `npm run build`");
  }
  const { bin, why } = await findChrome();
  const profile = userDataDir ?? (await mkdtemp(path.join(os.tmpdir(), "ctm-profile-")));
  await mkdir(path.join(profile, "Default"), { recursive: true });
  // Язык интерфейса задаёт именно intl.app_locale в профиле: одного --lang в
  // headless мало (getUILanguage() при этом продолжает врать — en-US).
  await writeFile(
    path.join(profile, "Default", "Preferences"),
    JSON.stringify({
      intl: { app_locale: locale, accept_languages: locale, selected_languages: locale },
      browser: { enabled_labs_experiments: [] },
    }),
  );

  // Проверено на Chrome 158 (Linux, headless): язык расширения берётся из
  // окружения процесса (LANGUAGE/LANG). --lang меняет только navigator.language,
  // а intl.app_locale в Preferences игнорируется.
  const env = {
    ...process.env,
    LANGUAGE: locale,
    LANG: locale === "ru" ? "ru_RU.utf8" : "en_US.UTF-8",
    LC_ALL: locale === "ru" ? "ru_RU.utf8" : "en_US.UTF-8",
  };

  const child = spawn(
    bin,
    [
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--no-sandbox",
      "--disable-features=Translate,DisableLoadExtensionCommandLineSwitch",
      `--lang=${locale}`,
      `--accept-lang=${locale}`,
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      `--load-extension=${DIST}`,
      `--disable-extensions-except=${DIST}`,
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"], env },
  );
  let log = "";
  child.stderr.on("data", (chunk) => (log += chunk));
  child.stdout.on("data", (chunk) => (log += chunk));

  const port = await waitFor(async () => {
    const file = path.join(profile, "DevToolsActivePort");
    if (!existsSync(file)) return null;
    return Number.parseInt((await readFile(file, "utf8")).split("\n")[0], 10) || null;
  }, { timeout: 30_000 });

  const base = `http://127.0.0.1:${port}`;
  const version = await fetch(`${base}/json/version`).then((response) => response.json());
  const browser = await connect(version.webSocketDebuggerUrl);
  const extId = extensionId(DIST);

  const targets = () => fetch(`${base}/json/list`).then((response) => response.json());

  const serviceWorker = await waitFor(async () => {
    const list = await targets();
    return list.find((target) => target.type === "service_worker" && target.url.startsWith(`chrome-extension://${extId}/`)) ?? null;
  }, { timeout: 25_000 }).catch(() => null);

  return {
    bin,
    why,
    browser,
    base,
    extId,
    serviceWorker,
    targets,
    log: () => log,
    async close() {
      child.kill("SIGKILL");
      await sleep(150);
    },
    profile,
  };
}

/** Открывает страницу расширения и возвращает удобные eval/скриншот/screenshot-хелперы. */
export async function openExtensionPage(browser, extId, file, { width = 400, height = 860 } = {}) {
  const url = `chrome-extension://${extId}/${file}`;
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  await browser.send("Page.enable", {}, sessionId);
  await browser.send("Runtime.enable", {}, sessionId);
  await browser.send("Log.enable", {}, sessionId).catch(() => {});
  await browser.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
  // Счётчик слушателей на document: ловит утечки вида «по слушателю на рендер».
  await browser.send(
    "Page.addScriptToEvaluateOnNewDocument",
    {
      source: `(() => {
        window.__docListeners = 0;
        const original = Document.prototype.addEventListener;
        Document.prototype.addEventListener = function (...args) {
          window.__docListeners += 1;
          return original.apply(this, args);
        };
      })();`,
    },
    sessionId,
  );
  await browser.send("Page.navigate", { url }, sessionId);
  await sleep(900);

  const errors = [];
  const collect = () => {
    for (const event of browser.events) {
      if (event.sessionId !== sessionId) continue;
      if (event.method === "Runtime.exceptionThrown") {
        errors.push(event.params.exceptionDetails?.exception?.description ?? "exception");
      }
      if (event.method === "Runtime.consoleAPICalled" && event.params.type === "error") {
        errors.push(event.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "));
      }
      if (event.method === "Log.entryAdded" && event.params.entry.level === "error") {
        errors.push(event.params.entry.text);
      }
    }
  };

  const evaluate = async (expression) => {
    const result = await browser.send(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true },
      sessionId,
    );
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? "ошибка в странице");
    }
    return result.result.value;
  };

  const screenshot = async (name) => {
    const { data } = await browser.send("Page.captureScreenshot", { format: "png" }, sessionId);
    await mkdir(ARTIFACTS, { recursive: true });
    const file = path.join(ARTIFACTS, `${name}.png`);
    await writeFile(file, Buffer.from(data, "base64"));
    return file;
  };

  return {
    url,
    targetId,
    sessionId,
    evaluate,
    screenshot,
    errors: () => {
      collect();
      return [...new Set(errors)];
    },
    reload: async () => {
      await browser.send("Page.navigate", { url }, sessionId);
      await sleep(900);
    },
    close: () => browser.send("Target.closeTarget", { targetId }).catch(() => {}),
  };
}

/**
 * Нажатие клавиши через CDP. Для Enter и пробела нужен type: keyDown + text,
 * иначе браузер не выполняет действие по умолчанию (submit формы, активация).
 */
export async function pressKey(browser, sessionId, key, { modifiers = 0 } = {}) {
  const code = key.length === 1 && key !== " " ? `Key${key.toUpperCase()}` : key === " " ? "Space" : key;
  const text = key === "Enter" ? "\r" : key === " " ? " " : undefined;
  const base = { key, code, windowsVirtualKeyCode: keyCode(key), nativeVirtualKeyCode: keyCode(key), modifiers };
  await browser.send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...base, ...(text ? { text, unmodifiedText: text } : {}) }, sessionId);
  await browser.send("Input.dispatchKeyEvent", { type: "keyUp", ...base }, sessionId);
}

function keyCode(key) {
  const map = { Enter: 13, Escape: 27, " ": 32, ArrowUp: 38, ArrowDown: 40, Tab: 9, Backspace: 8 };
  if (map[key]) return map[key];
  return key.toUpperCase().charCodeAt(0);
}
