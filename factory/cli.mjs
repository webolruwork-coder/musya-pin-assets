#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const FACTORY_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.dirname(FACTORY_DIR);
const CONFIG_PATH = path.join(FACTORY_DIR, "config.json");
const STATE_PATH = path.join(FACTORY_DIR, "state.json");
const RUNS_DIR = path.join(FACTORY_DIR, "runs");

export const LINEAR_STATUSES = [
  "queued",
  "research_ready",
  "concept_ready",
  "generated",
  "rendered",
  "validated",
  "hosted",
  "scheduled",
  "published",
];

export const SIDE_STATUSES = ["needs_review", "failed"];
export const ALL_STATUSES = [...LINEAR_STATUSES, ...SIDE_STATUSES];

function now() {
  return new Date().toISOString();
}

export async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function parseOptions(args) {
  const positional = [];
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      options[key] = true;
      continue;
    }
    options[key] = value;
    index += 1;
  }
  return { positional, options };
}

function slugify(value) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function localDate(timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function manifestPath(id) {
  return path.join(RUNS_DIR, id, "manifest.json");
}

function resolveAsset(assetPath) {
  if (!assetPath) return null;
  return path.isAbsolute(assetPath) ? assetPath : path.join(ROOT_DIR, assetPath);
}

async function loadState() {
  try {
    return await readJson(STATE_PATH);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { version: 1, updated_at: null, runs: [] };
  }
}

async function saveState(state) {
  state.updated_at = now();
  await writeJson(STATE_PATH, state);
}

export async function loadManifest(id) {
  return readJson(manifestPath(id));
}

function summarize(manifest) {
  return {
    id: manifest.id,
    manifest: path.relative(ROOT_DIR, manifestPath(manifest.id)),
    status: manifest.status,
    scheduled_at: manifest.publishing.scheduled_at,
    metricool_post_id: manifest.publishing.metricool_post_id,
    updated_at: manifest.updated_at,
  };
}

export async function syncManifest(manifest) {
  manifest.updated_at = now();
  await writeJson(manifestPath(manifest.id), manifest);
  const state = await loadState();
  const summary = summarize(manifest);
  const index = state.runs.findIndex((run) => run.id === manifest.id);
  if (index === -1) state.runs.push(summary);
  else state.runs[index] = summary;
  state.runs.sort((left, right) => left.id.localeCompare(right.id));
  await saveState(state);
}

export function canTransition(from, to) {
  if (!ALL_STATUSES.includes(to)) return false;
  if (from === to) return true;
  if (SIDE_STATUSES.includes(to)) return true;
  const current = LINEAR_STATUSES.indexOf(from);
  const next = LINEAR_STATUSES.indexOf(to);
  return current !== -1 && next === current + 1;
}

export function transitionManifest(manifest, to, note = "") {
  const resumeStatus = [...manifest.history]
    .reverse()
    .find((entry) => LINEAR_STATUSES.includes(entry.status))?.status;
  const resumesReview = manifest.status === "needs_review" && to === resumeStatus;
  if (!canTransition(manifest.status, to) && !resumesReview) {
    throw new Error(`Invalid status transition: ${manifest.status} → ${to}`);
  }
  if (manifest.status === to) return manifest;
  manifest.status = to;
  manifest.updated_at = now();
  manifest.history.push({ status: to, at: manifest.updated_at, note });
  return manifest;
}

function createManifest({ id, query, config }) {
  const timestamp = now();
  return {
    version: 1,
    id,
    created_at: timestamp,
    updated_at: timestamp,
    status: "queued",
    search: {
      query,
      result_limit: config.search.result_limit,
      reference_urls: [],
      reference_fingerprints: [],
      pattern_summary: "",
    },
    content: {
      prompt_ru: "",
      title_ru: "",
      description_ru: "",
      keywords_ru: [],
    },
    assets: {
      source_image: "",
      final_image: "",
      media_url: "",
    },
    publishing: {
      provider: config.publishing.provider,
      brand: config.publishing.brand,
      blog_id: config.publishing.blog_id,
      timezone: config.timezone,
      board: config.content.board,
      target_url: config.content.target_url,
      scheduled_at: null,
      metricool_post_id: null,
    },
    validation: {
      passed: false,
      checked_at: null,
      checks: {},
      errors: [],
    },
    history: [{ status: "queued", at: timestamp, note: "Run created" }],
  };
}

export function fingerprintReference(url) {
  const normalized = new URL(url);
  normalized.hash = "";
  normalized.searchParams.sort();
  return crypto.createHash("sha256").update(normalized.toString()).digest("hex");
}

export async function imageDimensions(file) {
  const buffer = await fs.readFile(file);
  if (
    buffer.length >= 24 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), format: "png" };
  }

  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2;
        continue;
      }
      const length = buffer.readUInt16BE(offset + 2);
      const isStartOfFrame = [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker);
      if (isStartOfFrame) {
        return {
          width: buffer.readUInt16BE(offset + 7),
          height: buffer.readUInt16BE(offset + 5),
          format: "jpeg",
        };
      }
      if (length < 2) break;
      offset += 2 + length;
    }
  }

  throw new Error(`Unsupported or malformed image: ${file}`);
}

async function allReferenceFingerprints(exceptId) {
  const state = await loadState();
  const fingerprints = new Set();
  for (const run of state.runs) {
    if (run.id === exceptId) continue;
    try {
      const manifest = await loadManifest(run.id);
      for (const value of manifest.search.reference_fingerprints || []) fingerprints.add(value);
      for (const value of manifest.search.reference_urls || []) fingerprints.add(fingerprintReference(value));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return fingerprints;
}

export async function validateManifest(manifest, config) {
  const checks = {};
  const errors = [];
  const requiredText = ["prompt_ru", "title_ru", "description_ru"];
  checks.content = requiredText.every((key) => manifest.content[key]?.trim()) && manifest.content.keywords_ru.length > 0;
  if (!checks.content) errors.push("Fill prompt_ru, title_ru, description_ru and keywords_ru");

  checks.references = manifest.search.reference_urls.length > 0 && manifest.search.reference_urls.length <= manifest.search.result_limit;
  if (!checks.references) errors.push(`Keep 1–${manifest.search.result_limit} reference URLs`);

  const seen = await allReferenceFingerprints(manifest.id);
  const current = manifest.search.reference_urls.map(fingerprintReference);
  manifest.search.reference_fingerprints = current;
  const duplicates = current.filter((value) => seen.has(value));
  checks.references_unique = duplicates.length === 0;
  if (!checks.references_unique) errors.push("One or more references were already used by another run");

  const finalImage = resolveAsset(manifest.assets.final_image);
  checks.final_image_exists = Boolean(finalImage);
  if (finalImage) {
    try {
      const dimensions = await imageDimensions(finalImage);
      checks.final_image_exists = true;
      checks.final_image_dimensions = dimensions.width === config.content.width && dimensions.height === config.content.height;
      checks.final_image_detected = dimensions;
      if (!checks.final_image_dimensions) {
        errors.push(`Final image must be ${config.content.width}×${config.content.height}; got ${dimensions.width}×${dimensions.height}`);
      }
    } catch (error) {
      checks.final_image_exists = false;
      checks.final_image_dimensions = false;
      errors.push(error.code === "ENOENT" ? `Final image not found: ${manifest.assets.final_image}` : error.message);
    }
  } else {
    checks.final_image_dimensions = false;
    errors.push("Set assets.final_image");
  }

  checks.publishing_fields = Boolean(
    manifest.publishing.provider &&
      manifest.publishing.brand &&
      manifest.publishing.blog_id &&
      manifest.publishing.timezone &&
      manifest.publishing.board &&
      manifest.publishing.target_url,
  );
  if (!checks.publishing_fields) {
    errors.push("Set publishing provider, brand, blog_id, timezone, board and target URL");
  }

  manifest.validation = {
    passed: errors.length === 0,
    checked_at: now(),
    checks,
    errors,
  };
  return manifest.validation;
}

async function commandInit() {
  await fs.mkdir(RUNS_DIR, { recursive: true });
  const state = await loadState();
  await saveState(state);
  console.log(`Factory initialized at ${path.relative(ROOT_DIR, FACTORY_DIR)}`);
}

async function commandCreate(args) {
  const { options } = parseOptions(args);
  const config = await readJson(CONFIG_PATH);
  const date = options.date || localDate(config.timezone);
  const slug = slugify(options.slug || `pin-${Date.now()}`);
  if (!slug) throw new Error("Provide an ASCII slug with --slug");
  const id = `${date}-${slug}`;
  const file = manifestPath(id);
  try {
    await fs.access(file);
    console.log(id);
    return;
  } catch {}
  const manifest = createManifest({ id, query: options.query || config.search.query, config });
  await syncManifest(manifest);
  console.log(id);
}

async function commandSetStatus(args) {
  const { positional, options } = parseOptions(args);
  const [id, to] = positional;
  if (!id || !to) throw new Error("Usage: set-status <id> <status> [--note text]");
  const manifest = await loadManifest(id);
  transitionManifest(manifest, to, options.note || "");
  await syncManifest(manifest);
  console.log(`${id}: ${manifest.status}`);
}

async function commandValidate(args) {
  const { positional } = parseOptions(args);
  const [id] = positional;
  if (!id) throw new Error("Usage: validate <id>");
  const config = await readJson(CONFIG_PATH);
  const manifest = await loadManifest(id);
  const result = await validateManifest(manifest, config);
  if (result.passed) {
    if (manifest.status === "needs_review") {
      const resumeStatus = [...manifest.history]
        .reverse()
        .find((entry) => LINEAR_STATUSES.includes(entry.status))?.status;
      if (resumeStatus) transitionManifest(manifest, resumeStatus, "Review issue fixed");
    }
    if (manifest.status === "rendered") {
      transitionManifest(manifest, "validated", "Automated manifest and image checks passed");
    }
  } else if (!result.passed && manifest.status !== "needs_review") {
    transitionManifest(manifest, "needs_review", result.errors.join("; "));
  }
  await syncManifest(manifest);
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}

async function commandNext() {
  const state = await loadState();
  const run = state.runs.find((item) => !["published", "failed"].includes(item.status));
  if (!run) {
    console.log("No active runs");
    return;
  }
  console.log(JSON.stringify(await loadManifest(run.id), null, 2));
}

async function commandReport() {
  const state = await loadState();
  if (state.runs.length === 0) {
    console.log("No runs");
    return;
  }
  console.table(
    state.runs.map(({ id, status, scheduled_at, metricool_post_id }) => ({
      id,
      status,
      scheduled_at: scheduled_at || "—",
      metricool_post_id: metricool_post_id || "—",
    })),
  );
}

async function main() {
  const [command = "help", ...args] = process.argv.slice(2);
  const commands = {
    init: commandInit,
    create: commandCreate,
    "set-status": commandSetStatus,
    validate: commandValidate,
    next: commandNext,
    report: commandReport,
  };
  if (!commands[command]) {
    console.log("Commands: init | create | set-status | validate | next | report");
    return;
  }
  await commands[command](args);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
