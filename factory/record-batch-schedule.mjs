#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifest, readJson, syncManifest, transitionManifest } from "./cli.mjs";

const factoryDir = path.dirname(fileURLToPath(import.meta.url));
const date = process.argv[2];
if (!date) throw new Error("Usage: node factory/record-batch-schedule.mjs YYYY-MM-DD");
const schedule = await readJson(path.join(factoryDir, "research", date, "metricool-schedule.json"));
const entries = await fs.readdir(path.join(factoryDir, "runs"));

for (const item of schedule) {
  const prefix = `${date}-slot-${String(item.slot).padStart(2, "0")}-`;
  const id = entries.find((entry) => entry.startsWith(prefix));
  if (!id) throw new Error(`Missing manifest for slot ${item.slot}`);
  const manifest = await loadManifest(id);
  manifest.publishing.scheduled_at = `${date}T${item.time}:00+03:00`;
  manifest.publishing.metricool_post_id = item.post_id;
  manifest.production.planned_at_local = `${date}T${item.time}:00`;
  transitionManifest(manifest, "scheduled", `Metricool post ${item.post_id} scheduled for ${date} ${item.time} Europe/Moscow`);
  await syncManifest(manifest);
}

console.log(`Recorded ${schedule.length} Metricool posts for ${date}`);
