# Pinterest factory MVP

Локальная машина состояний для производства пинов. ИИ отвечает за research, концепцию, изображение и текст; CLI хранит состояние, запрещает перескакивать стадии и проверяет финальный файл перед публикацией.

## Быстрый старт

```bash
npm run factory:init
npm run factory:create -- --slug glass-apple --query "промпт для нейросети"
npm run factory:next
node factory/cli.mjs set-status 2026-09-21-glass-apple research_ready
npm run factory:render -- 2026-09-21-glass-apple
npm run factory:validate -- 2026-09-21-glass-apple
npm run factory:review
# После визуальной проверки:
node factory/cli.mjs approve 2026-09-21-glass-apple
npm run factory:prepare-host -- 2026-09-21-glass-apple
# После commit + push и появления файла на GitHub Pages:
npm run factory:confirm-host -- 2026-09-21-glass-apple
npm run factory:report
```

## Статусы

```text
queued → research_ready → concept_ready → generated → rendered
       → validated → hosted → scheduled → published
```

`needs_review` и `failed` — боковые состояния. Команда перехода разрешает только следующий линейный статус; повтор того же статуса идемпотентен.

## Где что хранится

- `config.json` — постоянные настройки поиска, формата и публикации;
- `state.json` — короткий индекс всех запусков;
- `runs/<id>/manifest.json` — источник правды по конкретному пину;
- `ROUTINE_PROMPT.md` — инструкция для ежедневной Claude Routine;
- `REVIEW_QUEUE.md` и `review/index.html` — очередь визуального предпросмотра;
- `manifest.schema.json` — контракт данных.

`config.json` также хранит подтверждённые параметры Metricool: бренд `musya_gpt`, `blog_id` `6880455`, таймзону `Europe/Moscow` и точное имя Pinterest-доски `Промпты для нейросетей`. Числовой `boardId` для планирования не нужен.

`render.mjs` берёт исходную картинку и `prompt_ru` из manifest, создаёт SVG-карточку в текущем стиле и рендерит `1000×1500` через локальные Playwright и Google Chrome. Пути задаются в `config.json`; сейчас используется уже установленный Playwright из `~/tailwind-rebuild`.

## Как посмотреть будущие пины

Выполнить `npm run factory:review`, затем открыть `factory/review/index.html`. Там показаны финальный визуал, статус, целевая ссылка, основной референс и его метрики. Markdown-версия очереди лежит в `factory/REVIEW_QUEUE.md` и открывается прямо в Codex или GitHub.

Каждый новый пин после проверки размера получает статус `validated` и `approval.status = pending`. Команда `factory:prepare-host` заблокирована до явного `approve`; отклонение через `reject` переводит пин в `needs_review`.

Новая целевая ссылка для создаваемых пинов: `https://musya.app/image-generation`. Старые опубликованные manifests сохраняют фактическую историческую ссылку.

Автоматическая публикация по умолчанию выключена.
