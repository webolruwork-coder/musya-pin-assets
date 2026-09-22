#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { loadManifest, readJson, syncManifest, transitionManifest } from "./cli.mjs";

const FACTORY_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.dirname(FACTORY_DIR);
const CONFIG_PATH = path.join(FACTORY_DIR, "config.json");

function projectPath(value) {
  return path.isAbsolute(value) ? value : path.join(ROOT_DIR, value);
}

export function publicAsset(config, id) {
  const relativePath = path.posix.join(config.hosting.directory, `${id}.png`);
  return {
    relativePath,
    url: `${config.hosting.public_base_url.replace(/\/$/u, "")}/${relativePath}`,
  };
}

async function prepare(id) {
  const config = await readJson(CONFIG_PATH);
  const manifest = await loadManifest(id);
  if (manifest.status !== "validated") {
    throw new Error(`Run must be validated before hosting; current status is ${manifest.status}`);
  }
  if (!manifest.assets.final_image) throw new Error("Set assets.final_image in manifest");

  const asset = publicAsset(config, id);
  const destination = projectPath(asset.relativePath);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(projectPath(manifest.assets.final_image), destination);
  manifest.assets.media_url = asset.url;
  await syncManifest(manifest);
  console.log(JSON.stringify(asset, null, 2));
}

async function confirm(id) {
  const manifest = await loadManifest(id);
  if (manifest.status === "hosted") {
    console.log(manifest.assets.media_url);
    return;
  }
  if (manifest.status !== "validated") {
    throw new Error(`Run must be validated before host confirmation; current status is ${manifest.status}`);
  }
  if (!manifest.assets.media_url) throw new Error("Run factory:prepare-host first");

  const response = await fetch(manifest.assets.media_url, { redirect: "follow" });
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok || !contentType.startsWith("image/")) {
    throw new Error(`Media URL check failed: HTTP ${response.status}, content-type ${contentType || "missing"}`);
  }
  transitionManifest(manifest, "hosted", `Public media verified: ${manifest.assets.media_url}`);
  await syncManifest(manifest);
  console.log(manifest.assets.media_url);
}

async function main() {
  const [command, id] = process.argv.slice(2);
  if (!id || !["prepare", "confirm"].includes(command)) {
    throw new Error("Usage: node factory/host.mjs <prepare|confirm> <run-id>");
  }
  if (command === "prepare") await prepare(id);
  else await confirm(id);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
