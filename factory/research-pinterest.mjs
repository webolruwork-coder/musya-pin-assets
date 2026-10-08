#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

function option(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

function decodeHtml(value = "") {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function meta(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return decodeHtml(match[1]);
  }
  return null;
}

function normalizeResults(payload) {
  const results = payload?.resource_response?.data?.results;
  if (!Array.isArray(results)) {
    throw new Error("Input does not contain resource_response.data.results");
  }
  return results.filter((item) => item?.type === "pin" && item?.id);
}

async function fetchDetail(item, rank) {
  const url = `https://www.pinterest.com/pin/${item.id}/`;
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": USER_AGENT,
        "accept-language": "ru-RU,ru;q=0.9,en;q=0.8",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const savesText = meta(html, "pinterestapp:repins");
    const saves = savesText !== null && /^\d+$/.test(savesText) ? Number(savesText) : null;
    return {
      rank,
      pin_id: item.id,
      url,
      canonical_url: meta(html, "og:url") || url,
      image_url:
        item.images?.orig?.url || item.images?.["736x"]?.url || meta(html, "og:image"),
      title: meta(html, "og:title") || null,
      description: meta(html, "og:description") || null,
      public_saves: saves,
      save_metric: saves === null ? "unavailable" : "pinterestapp:repins",
      search_rank_score: Math.max(0, 101 - rank),
      detail_status: "ok",
    };
  } catch (error) {
    return {
      rank,
      pin_id: item.id,
      url,
      canonical_url: url,
      image_url: item.images?.orig?.url || item.images?.["736x"]?.url || null,
      title: null,
      description: null,
      public_saves: null,
      save_metric: "unavailable",
      search_rank_score: Math.max(0, 101 - rank),
      detail_status: `error: ${error.message}`,
    };
  }
}

async function mapConcurrent(items, limit, fn) {
  const output = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      output[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output;
}

const inputPath = option("input");
const outputPath = option("output");
const downloadDir = option("download-dir");
const query = option("query", "промпт");
if (!inputPath || !outputPath) {
  throw new Error("Usage: node factory/research-pinterest.mjs --input <response.json> --output <report.json> [--query промпт]");
}

const payload = JSON.parse(await fs.readFile(inputPath, "utf8"));
const results = normalizeResults(payload);
const candidates = await mapConcurrent(results, 5, (item, index) => fetchDetail(item, index + 1));

if (downloadDir) {
  await fs.mkdir(downloadDir, { recursive: true });
  await mapConcurrent(candidates, 5, async (candidate) => {
    if (!candidate.image_url) return;
    const extension = new URL(candidate.image_url).pathname.match(/\.(png|jpe?g|webp)$/i)?.[1] || "jpg";
    const file = `${String(candidate.rank).padStart(2, "0")}-${candidate.pin_id}.${extension}`;
    const response = await fetch(candidate.image_url, { headers: { "user-agent": USER_AGENT } });
    if (!response.ok) throw new Error(`Image ${candidate.pin_id}: HTTP ${response.status}`);
    await fs.writeFile(path.join(downloadDir, file), Buffer.from(await response.arrayBuffer()));
    candidate.local_image = path.join(downloadDir, file);
  });
}

const ranked = [...candidates].sort((left, right) => {
  const leftHasSaves = left.public_saves !== null;
  const rightHasSaves = right.public_saves !== null;
  if (leftHasSaves !== rightHasSaves) return rightHasSaves - leftHasSaves;
  if (leftHasSaves && left.public_saves !== right.public_saves) {
    return right.public_saves - left.public_saves;
  }
  return left.rank - right.rank;
});

const report = {
  version: 1,
  captured_at: new Date().toISOString(),
  source: "Pinterest public global search",
  query,
  locale: "ru-RU",
  ranking_rule: [
    "public_saves_desc_when_available",
    "search_rank_asc",
    "visual_pattern_recurrence_manual_or_model_review",
    "own_account_metricool_validation",
  ],
  caveat:
    "Pinterest does not expose a stable public like count for ordinary pins. pinterestapp:repins is recorded when present; unavailable values are never inferred.",
  candidates,
  ranked_candidate_ids: ranked.map((candidate) => candidate.pin_id),
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Wrote ${candidates.length} Pinterest candidates to ${outputPath}`);
