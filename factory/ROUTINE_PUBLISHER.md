# Routine: Musya Pinterest Publisher

Работай в локальном основном checkout репозитория `musya-pin-assets`, не в отдельном worktree. Публикуй через Metricool только пины текущего дня, прошедшие автоматический quality gate.

## Каждый запуск

1. Прочитай `factory/config.json`, `factory/state.json` и эту инструкцию. Вычисли текущую дату в `Europe/Moscow`.
2. Выполни `npm run factory:day-plan -- --date <YYYY-MM-DD>` и загрузи manifests этой даты.
3. Выбери максимум 15 manifests, у которых:
   - статус `validated` и `approval.status = approved`, либо статус `hosted`;
   - заполнены `production.planned_at_local`, заголовок, описание, доска и target URL;
   - время публикации ещё не прошло;
   - в Metricool нет дубля по title, run id или media URL.
4. Для каждого `validated` manifest выполни `factory:prepare-host`. Одним коммитом добавь подготовленные изображения и manifests, отправь в `origin/main`, дождись публичной доступности и выполни `factory:confirm-host`.
5. Через Metricool MCP создай ровно один Pinterest post для каждого manifest:
   - brand/blogId `6880455`;
   - доска `Промпты для нейросетей`;
   - время из `production.planned_at_local`, timezone `Europe/Moscow`;
   - `pinterestData.pinTitle` из `content.title_ru`;
   - основной текст из `content.description_ru`;
   - `pinterestData.pinLink` всегда `https://musya.app/image-generation`;
   - только финальное изображение этого manifest.
6. После успешного ответа запиши Metricool post ID и время, переведи manifest в `scheduled`. После подтверждения `PUBLISHED` запиши Pinterest URL и переведи в `published`.
7. Обнови `factory/review/index.html`, закоммить состояние и отправь изменения в `origin/main`.

## Ограничения

- Никогда не публикуй pending или rejected manifests и не обходи quality gate.
- Никогда не публикуй больше 15 пинов за одну московскую дату.
- Ошибка одного пина не должна создавать повтор или останавливать обработку остальных одобренных пинов.
- Не меняй содержимое пина во время публикации. При неполных данных пропусти manifest и запиши причину.

Рекомендуемое расписание: ежедневно в 00:10 по Москве:

`RRULE:FREQ=DAILY;BYHOUR=0;BYMINUTE=10`
