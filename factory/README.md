# Pinterest factory MVP

Локальная машина состояний для производства пинов. ИИ отвечает за research, концепцию, изображение и текст; CLI хранит состояние, запрещает перескакивать стадии и проверяет финальный файл перед публикацией.

## Быстрый старт

```bash
npm run factory:init
npm run factory:create -- --slug glass-apple --query "промпт для нейросети"
npm run factory:next
node factory/cli.mjs set-status 2026-09-21-glass-apple research_ready
npm run factory:validate -- 2026-09-21-glass-apple
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
- `manifest.schema.json` — контракт данных.

Публикация по умолчанию выключена. После ручного E2E через Metricool изменить `publishing.enabled` осознанным отдельным коммитом.
