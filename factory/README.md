# Pinterest factory MVP

Локальная машина состояний для производства пинов. ИИ отвечает за research, концепцию, изображение и текст; CLI хранит состояние, запрещает перескакивать стадии и проверяет финальный файл перед публикацией.

## Быстрый старт

```bash
npm run factory:init
npm run factory:create -- --slug glass-apple --query "промпт для нейросети"
npm run factory:seed-day -- --date 2026-10-10
npm run factory:day-plan -- --date 2026-10-10
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
- `research-pinterest.mjs` — собирает публичные метаданные верхних результатов глобального поиска Pinterest;
- `state.json` — короткий индекс всех запусков;
- `runs/<id>/manifest.json` — источник правды по конкретному пину;
- `ROUTINE_PROMPT.md` — инструкция для ежедневной Claude Routine;
- `REVIEW_QUEUE.md` и `review/index.html` — очередь визуального предпросмотра;
- `manifest.schema.json` — контракт данных.

`config.json` также хранит подтверждённые параметры Metricool: бренд `musya_gpt`, `blog_id` `6880455`, таймзону `Europe/Moscow` и точное имя Pinterest-доски `Промпты для нейросетей`. Числовой `boardId` для планирования не нужен.

## Режим 15 пинов в день

`factory:seed-day` идемпотентно создаёт дневную партию из 15 manifests. У каждого есть своя тема, рубрика и московский слот с 02:30 до 23:30. Повторный запуск не создаёт дубли.

Производитель обрабатывает только один manifest за запуск и вызывается 15 раз в день. Он создаёт пины на следующий день. После успешной проверки исследования, изображения, размеров и полей публикации manifest автоматически получает `approval.status = approved`. Галерея `factory/review/index.html` остаётся для контроля и истории.

Издатель запускается отдельно. Он берёт только manifests, прошедшие автоматический quality gate, размещает изображения и ставит их в Metricool на подготовленные слоты. Если проверку прошло меньше 15 пинов, оставшиеся слоты пропускаются; некачественный или незаконченный контент автоматически не публикуется.

Готовые инструкции для Codex Scheduled tasks лежат в `ROUTINE_PRODUCER.md` и `ROUTINE_PUBLISHER.md`. Для локального проекта компьютер должен быть включён, а ChatGPT desktop app — запущено. Это ограничение описано в официальной документации Scheduled tasks.

`render.mjs` берёт исходную картинку и `prompt_ru` из manifest, создаёт SVG-карточку в текущем стиле и рендерит `1000×1500` через локальные Playwright и Google Chrome. Пути задаются в `config.json`; сейчас используется уже установленный Playwright из `~/tailwind-rebuild`.

## Как посмотреть будущие пины

Выполнить `npm run factory:review`, затем открыть `factory/review/index.html`. Там показаны финальный визуал, статус, целевая ссылка, основной референс и его метрики. Markdown-версия очереди лежит в `factory/REVIEW_QUEUE.md` и открывается прямо в Codex или GitHub.

Каждый production-пин после всех проверок получает статус `validated` и автоматическое `approval.status = approved`. Команда `factory:prepare-host` остаётся заблокированной для непройденных, pending и rejected manifests.

Новая целевая ссылка для создаваемых пинов: `https://musya.app/image-generation`. Старые опубликованные manifests сохраняют фактическую историческую ссылку.

Автоматическая публикация и автоматическое одобрение включены для дневных production manifests. Любая ошибка проверки оставляет пин вне публикации.

Главный источник идей — глобальная публичная выдача Pinterest по запросу `промпт`. Фабрика ежедневно сохраняет первые 25 результатов и ранжирует их по публичным сохранениям, затем по позиции в выдаче и повторяемости визуального паттерна. Pinterest не даёт стабильный публичный счётчик лайков для обычных пинов, поэтому фабрика использует `pinterestapp:repins` и сохраняет недоступные значения как `null`. Аналитика собственного аккаунта из Metricool служит вторичной проверкой.
