/**
 * Минимальная заглушка chrome.storage.local + localStorage для юнит-тестов.
 * Полноценный Chrome API в тестах не нужен: проверяем только нашу логику.
 */

type Listener = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void;

export interface FakeChrome {
  store: Map<string, unknown>;
  listeners: Set<Listener>;
  local: {
    get: (keys: string | string[] | null) => Promise<Record<string, unknown>>;
    set: (items: Record<string, unknown>) => Promise<void>;
    remove: (keys: string | string[]) => Promise<void>;
  };
  reset: () => void;
}

export function installFakeChrome(initial: Record<string, unknown> = {}): FakeChrome {
  const store = new Map<string, unknown>(Object.entries(structuredClone(initial)));
  const listeners = new Set<Listener>();

  const notify = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>) => {
    for (const listener of listeners) listener(structuredClone(changes), "local");
  };

  const fake = {
    store,
    listeners,
    local: {
      async get(keys: string | string[] | null) {
        const result: Record<string, unknown> = {};
        const list = keys == null ? [...store.keys()] : Array.isArray(keys) ? keys : [keys];
        for (const key of list) if (store.has(key)) result[key] = structuredClone(store.get(key));
        return result;
      },
      async set(items: Record<string, unknown>) {
        const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
        for (const [key, value] of Object.entries(items)) {
          changes[key] = { oldValue: store.get(key), newValue: structuredClone(value) };
          store.set(key, structuredClone(value));
        }
        notify(changes);
      },
      async remove(keys: string | string[]) {
        const changes: Record<string, { oldValue?: unknown }> = {};
        for (const key of Array.isArray(keys) ? keys : [keys]) {
          if (!store.has(key)) continue;
          changes[key] = { oldValue: store.get(key) };
          store.delete(key);
        }
        if (Object.keys(changes).length) notify(changes);
      },
    },
    reset() {
      store.clear();
      listeners.clear();
    },
  };

  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: fake.local,
      onChanged: {
        addListener: (listener: Listener) => listeners.add(listener),
        removeListener: (listener: Listener) => listeners.delete(listener),
      },
    },
    i18n: { getUILanguage: () => "ru", getMessage: (key: string) => key },
  };

  return fake;
}

export function installFakeLocalStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key),
      get length() {
        return map.size;
      },
      key: (index: number) => [...map.keys()][index] ?? null,
      clear: () => map.clear(),
    },
  });
  return map;
}
