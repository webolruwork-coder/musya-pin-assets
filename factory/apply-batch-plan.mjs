#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifest, readJson, syncManifest, transitionManifest } from "./cli.mjs";

const factoryDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.dirname(factoryDir);
const date = process.argv[2];
if (!date) throw new Error("Usage: node factory/apply-batch-plan.mjs YYYY-MM-DD");

const researchDir = path.join(factoryDir, "research", date);
const [plan, report, generated, own] = await Promise.all([
  readJson(path.join(researchDir, "batch-plan.json")),
  readJson(path.join(researchDir, "global-prompt-search.json")),
  readJson(path.join(researchDir, "generated-map.json")),
  readJson(path.join(researchDir, "top-patterns.json")),
]);
const candidates = new Map(report.candidates.map((candidate) => [candidate.pin_id, candidate]));

for (const item of plan.items) {
  const runsDir = path.join(factoryDir, "runs");
  const entries = await fs.readdir(runsDir);
  const id = entries.find((entry) => entry.startsWith(`${date}-slot-${String(item.slot).padStart(2, "0")}-`));
  if (!id) throw new Error(`No manifest for slot ${item.slot}`);
  const manifest = await loadManifest(id);
  const candidate = candidates.get(item.pin_id);
  if (!candidate) throw new Error(`Candidate ${item.pin_id} missing from report`);
  const source = generated[String(item.slot)];
  await fs.access(source);
  const sourceRelative = `factory/runs/${id}/source.png`;
  await fs.copyFile(source, path.join(rootDir, sourceRelative));

  manifest.search = {
    query: item.title,
    global_query: plan.query,
    result_limit: report.candidates.length,
    reference_urls: [candidate.url],
    reference_fingerprints: [],
    pattern_summary: `Глобальный результат #${candidate.rank} по запросу «${plan.query}», ${candidate.public_saves} публичных сохранений. Переносится визуальный паттерн «${item.pillar}», сюжет и детали созданы заново.`,
  };
  manifest.content = {
    prompt_ru: item.prompt,
    title_ru: item.title,
    description_ru: `${item.prompt} Скопируйте промпт и создайте собственную вариацию в генераторе Musya: https://musya.app/image-generation`,
    keywords_ru: ["промпт", "нейросеть", "генерация изображений", "AI фото", item.pillar.toLowerCase(), "Musya"],
    layout: item.layout,
  };
  manifest.assets.source_image = sourceRelative;
  manifest.assets.final_image = `factory/runs/${id}/pin.png`;
  manifest.production.pillar = item.pillar;
  manifest.research_evidence = {
    source: "Pinterest public global search",
    global_query: plan.query,
    global_search_report: `factory/research/${date}/global-prompt-search.json`,
    date_range: `captured ${report.captured_at}`,
    posts_analyzed: report.candidates.length,
    reference_images_reviewed: plan.items.length,
    selected_reference: {
      url: candidate.url,
      title: candidate.title || "",
      public_saves: candidate.public_saves,
      search_rank: candidate.rank,
      impressions: own.items[item.slot - 1]?.impressions ?? null,
      saves: own.items[item.slot - 1]?.saves ?? null,
      clicks: own.items[item.slot - 1]?.clicks ?? null
    },
    transferred_features: ["тип композиции", "световая схема", "плотность кадра"],
    deliberate_changes: ["Новые персонажи или предметы, палитра и детали; чужое изображение и брендинг не копируются"],
  };
  for (const [status, note] of [
    ["research_ready", "Selected from measured global Pinterest search"],
    ["concept_ready", "Original variation planned"],
    ["generated", "Original ImageGen source saved"],
  ]) {
    if (manifest.status !== status) transitionManifest(manifest, status, note);
  }
  await syncManifest(manifest);
}

console.log(`Applied global Pinterest research and generated assets to ${plan.items.length} manifests`);
