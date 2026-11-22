# chrome-task-manager — правила для агента

Расширение Chrome MV3 «Менеджер Задач»: список задач в боковой панели.
Продукт, а не прототип: любое изменение проверяется тестами и попадает в CHANGELOG.

## Стек

React 19 + TypeScript, Vite 7 + @crxjs/vite-plugin, Tailwind CSS v4 (только как
сборщик утилит, основной UI — семантические классы в `src/styles/tailwind.css`),
@dnd-kit для перестановки, vitest для юнит-тестов. Зависимостей сверх этого не
добавлять без причины.

## Структура

```
src/
├── background/service-worker.ts  состояние панели по окнам (события + порт)
├── lib/                          чистая логика без DOM и chrome.*
│   ├── tasks.ts                  сортировка, фильтры, поиск, импорт/экспорт
│   ├── storage.ts                chrome.storage + миграция схем
│   ├── panel.ts                  open/close с fallback для Chrome < 141
│   ├── i18n.ts, storageKeys.ts
│   └── *.test.ts                 юнит-тесты рядом с модулем
├── hooks/useStore.ts             единственный источник состояния задач
├── hooks/usePanelPort.ts         порт панель → SW с переподключением
├── components/                    UI
├── sidepanel/, popup/             страницы
└── types.ts                      Task, Prefs, BackupFile
public/_locales/{ru,en}            строки интерфейса и манифеста
scripts/                           validate, load-test, e2e, cdp, make-icons
docs/                              knowledge-base, decisions, testing
```

## Инварианты

1. **Логика — в `src/lib`, без `chrome.*` и DOM.** Всё, что там лежит, покрыто
   юнит-тестами. Побочные эффекты (storage, clipboard, файлы) — в хуках и компонентах.
2. **Сортировка только по `order`.** Приоритет — визуальный атрибут. Иначе
   перестановка через границу приоритета снова станет no-op (так было в 3.0).
3. **Пишем в storage весь список целиком** и фильтруем отзвук своей записи по
   сериализованному снимку (`useStore`).
4. **Никаких новых разрешений.** Сейчас `sidePanel` + `storage`. Отказ
   `sidePanel.open()` обрабатывается сообщением, а не проверкой `tab.url`.
5. **Строки только через `t("key")`**, ключи — в обеих локалях. `npm run validate`
   проверяет набор ключей, форму `messages.json` и подстановки.
6. **`panel:hello` + переподключение порта** обязательны: service worker
   выгружается, состояние должно восстанавливаться.
7. **Не добавлять `console.log`, `innerHTML`, `eval`** — это ловит валидатор.

## Перед коммитом

```bash
npm run verify        # typecheck + test + build + validate
npm run load-test     # Chrome: панель, popup, локали, темы
npm run e2e           # полный сценарий + регрессионные проверки
npm run report        # artifacts/report.html
```

Все `✗` в отчёте — блокер. Новое поведение сопровождается тестом (юнит или e2e),
изменение — записью в `CHANGELOG.md`.

## Находки, которые нельзя забыть

- Chrome с версии 137 игнорирует `--load-extension` — нужен Chrome for Testing.
- CDP не видит `chrome.*` в контексте service worker: проверки делаются из страницы
  расширения.
- Локаль в headless задаётся переменными окружения (`LANGUAGE`, `LANG`), а не
  `--lang` и не `intl.app_locale`.
- Невалидный `messages.json` приводит к молчаливой неработе расширения.

Полный разбор — в `docs/knowledge-base.md`.
