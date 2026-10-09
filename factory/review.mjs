#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadManifest, readJson } from "./cli.mjs";

const FACTORY_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.dirname(FACTORY_DIR);
const STATE_PATH = path.join(FACTORY_DIR, "state.json");
const REVIEW_DIR = path.join(FACTORY_DIR, "review");
const HTML_PATH = path.join(REVIEW_DIR, "index.html");
const MARKDOWN_PATH = path.join(FACTORY_DIR, "REVIEW_QUEUE.md");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function projectPath(value) {
  return path.isAbsolute(value) ? value : path.join(ROOT_DIR, value);
}

function relativeWebPath(fromDirectory, value) {
  if (!value) return "";
  return path.relative(fromDirectory, projectPath(value)).split(path.sep).join("/");
}

function metric(value) {
  return Number.isFinite(value) ? new Intl.NumberFormat("ru-RU").format(value) : "—";
}

function approvalLabel(manifest) {
  const value = manifest.approval?.status || "pending";
  return {
    pending: "Ждёт просмотра",
    approved: "Одобрен",
    rejected: "Отклонён",
  }[value] || value;
}

function card(manifest) {
  const imagePath = relativeWebPath(REVIEW_DIR, manifest.assets.final_image);
  const reference = manifest.research_evidence?.selected_reference || {};
  const transferred = manifest.research_evidence?.transferred_features || [];
  const changes = manifest.research_evidence?.deliberate_changes || [];
  const approval = manifest.approval?.status || "pending";
  return `<article class="card ${escapeHtml(approval)}">
    <div class="visual">
      ${imagePath ? `<img src="${escapeHtml(imagePath)}" alt="${escapeHtml(manifest.content.title_ru)}">` : '<div class="missing">Нет финального изображения</div>'}
    </div>
    <div class="details">
      <div class="eyebrow"><span class="badge">${escapeHtml(approvalLabel(manifest))}</span><span>${escapeHtml(manifest.status)}</span></div>
      <h2>${escapeHtml(manifest.content.title_ru || manifest.id)}</h2>
      <p class="description">${escapeHtml(manifest.content.description_ru)}</p>
      <dl>${manifest.production ? `
        <div><dt>Слот</dt><dd>${escapeHtml(manifest.production.target_date)} · ${escapeHtml(manifest.production.planned_at_local?.slice(11, 16))} · ${escapeHtml(manifest.production.pillar)}</dd></div>` : ""}
        <div><dt>Куда ведёт</dt><dd><a href="${escapeHtml(manifest.publishing.target_url)}">${escapeHtml(manifest.publishing.target_url)}</a></dd></div>
        <div><dt>Основной референс</dt><dd><a href="${escapeHtml(reference.url)}">${escapeHtml(reference.title || reference.url || "—")}</a></dd></div>
        <div><dt>Результат референса</dt><dd>${metric(reference.impressions)} показов · ${metric(reference.saves)} сохранений · ${metric(reference.clicks)} кликов</dd></div>
      </dl>
      <div class="columns">
        <div><h3>Переносим</h3><ul>${transferred.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
        <div><h3>Меняем</h3><ul>${changes.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
      </div>
      <p class="manifest"><a href="${escapeHtml(relativeWebPath(REVIEW_DIR, `factory/runs/${manifest.id}/manifest.json`))}">manifest.json</a> · ${escapeHtml(manifest.id)}</p>${manifest.approval?.note ? `
      <p class="note">${escapeHtml(manifest.approval.note)}</p>` : ""}
    </div>
  </article>`;
}

function page(manifests) {
  const pending = manifests.filter(
    (item) =>
      !["published", "failed"].includes(item.status) &&
      item.assets.final_image &&
      ["validated", "hosted", "scheduled", "needs_review"].includes(item.status),
  );
  const inProgress = manifests.filter((item) =>
    ["queued", "research_ready", "concept_ready", "generated", "rendered"].includes(item.status),
  );
  const history = manifests.filter((item) => ["published", "failed"].includes(item.status));
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Musya · предпросмотр Pinterest</title>
  <style>
    :root { color-scheme: light; --ink:#171717; --muted:#6f6b65; --line:#ddd8d0; --paper:#f5f2ec; --card:#fff; --green:#d9f5df; --red:#ffe0dc; --amber:#fff0bf; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--paper); color:var(--ink); font-family:Inter,Arial,sans-serif; }
    main { width:min(1180px, calc(100% - 32px)); margin:0 auto; padding:56px 0 96px; }
    header { margin-bottom:36px; }
    h1 { margin:0 0 10px; font:600 clamp(38px,6vw,72px)/.95 Georgia,serif; letter-spacing:-.04em; }
    header p { color:var(--muted); max-width:720px; line-height:1.5; }
    .section-title { margin:48px 0 18px; font-size:13px; letter-spacing:.14em; text-transform:uppercase; }
    .stack { display:grid; gap:24px; }
    .card { display:grid; grid-template-columns:minmax(280px, 420px) 1fr; background:var(--card); border:1px solid var(--line); border-radius:24px; overflow:hidden; box-shadow:0 16px 50px rgba(45,35,22,.06); }
    .visual { min-height:520px; background:#ebe7df; }
    .visual img { width:100%; height:100%; display:block; object-fit:cover; }
    .missing { height:100%; display:grid; place-items:center; color:var(--muted); }
    .details { padding:34px; }
    .eyebrow { display:flex; gap:10px; align-items:center; color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.08em; }
    .badge { padding:7px 10px; border-radius:999px; background:var(--amber); color:var(--ink); }
    .approved .badge { background:var(--green); }
    .rejected .badge { background:var(--red); }
    h2 { margin:22px 0 12px; font:600 34px/1.06 Georgia,serif; }
    .description { color:#393631; line-height:1.55; }
    dl { margin:26px 0; border-top:1px solid var(--line); }
    dl div { display:grid; grid-template-columns:160px 1fr; gap:18px; padding:12px 0; border-bottom:1px solid var(--line); }
    dt { color:var(--muted); }
    dd { margin:0; overflow-wrap:anywhere; }
    a { color:inherit; text-decoration-color:#999; text-underline-offset:3px; }
    .columns { display:grid; grid-template-columns:1fr 1fr; gap:24px; }
    h3 { font-size:13px; text-transform:uppercase; letter-spacing:.1em; }
    ul { margin:0; padding-left:18px; color:#45413b; line-height:1.5; }
    .manifest,.note { margin-top:24px; color:var(--muted); font-size:13px; }
    .history { opacity:.72; }
    @media (max-width:760px) { .card { grid-template-columns:1fr; } .visual { min-height:auto; } .columns, dl div { grid-template-columns:1fr; gap:6px; } }
  </style>
</head>
<body><main>
  <header><h1>Контроль Pinterest</h1><p>Здесь видны готовые пины, их источники, метрики и статус публикации. Production-пины публикуются автоматически только после прохождения всех quality gates. Сейчас в производстве: ${inProgress.length}.</p></header>
  <h2 class="section-title">Ожидают решения · ${pending.length}</h2>
  <section class="stack">${pending.length ? pending.map(card).join("") : "<p>Очередь пуста.</p>"}</section>
  <h2 class="section-title">История · ${history.length}</h2>
  <section class="stack history">${history.map(card).join("")}</section>
</main></body></html>`;
}

function markdown(manifests) {
  const inProgress = manifests.filter((item) =>
    ["queued", "research_ready", "concept_ready", "generated", "rendered"].includes(item.status),
  );
  const items = manifests.filter(
    (item) =>
      !["published", "failed"].includes(item.status) &&
      item.assets.final_image &&
      ["validated", "hosted", "scheduled", "needs_review"].includes(item.status),
  );
  const blocks = items.map((manifest) => {
    const image = relativeWebPath(FACTORY_DIR, manifest.assets.final_image);
    const reference = manifest.research_evidence?.selected_reference || {};
    return `## ${manifest.content.title_ru || manifest.id}

**Решение:** ${approvalLabel(manifest)}<br>
**Статус:** \`${manifest.status}\`<br>
${manifest.production ? `**Слот:** ${manifest.production.target_date} · ${manifest.production.planned_at_local?.slice(11, 16)} · ${manifest.production.pillar}<br>
` : ""}**Ссылка:** ${manifest.publishing.target_url}<br>
**Референс:** ${reference.title || "—"} — ${metric(reference.impressions)} показов, ${metric(reference.saves)} сохранений

${image ? `![${manifest.id}](${image})` : "Финального изображения пока нет."}

[Открыть manifest](runs/${manifest.id}/manifest.json)
`;
  });
  return `# Очередь Pinterest на проверку

Production-пины автоматически одобряются только после успешной проверки исследования, изображения, размеров и полей публикации. Непройденные manifests не хостятся и не попадают в Metricool.

Сейчас в производстве: **${inProgress.length}**.

${blocks.length ? blocks.join("\n---\n\n") : "Очередь пуста.\n"}`;
}

async function main() {
  const state = await readJson(STATE_PATH);
  const manifests = await Promise.all(state.runs.map((run) => loadManifest(run.id)));
  manifests.sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  await fs.mkdir(REVIEW_DIR, { recursive: true });
  await fs.writeFile(HTML_PATH, page(manifests), "utf8");
  await fs.writeFile(MARKDOWN_PATH, markdown(manifests), "utf8");
  console.log(path.relative(ROOT_DIR, HTML_PATH));
  console.log(path.relative(ROOT_DIR, MARKDOWN_PATH));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
