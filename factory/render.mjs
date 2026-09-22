#!/usr/bin/env node

import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadManifest, readJson, syncManifest, transitionManifest } from "./cli.mjs";

const FACTORY_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.dirname(FACTORY_DIR);
const CONFIG_PATH = path.join(FACTORY_DIR, "config.json");
const require = createRequire(import.meta.url);

function resolveProjectPath(value) {
  return path.isAbsolute(value) ? value : path.join(ROOT_DIR, value);
}

export function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function wrapText(value, maxCharacters = 64, maxLines = 7) {
  const words = String(value).replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxCharacters) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (words.length > lines.join(" ").split(" ").length && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[.,;:!?—-]+$/u, "")}…`;
  }
  return lines;
}

export function makeSvg({ sourceImage, prompt, layout = "bottom_dark_editorial" }) {
  const imageUrl = pathToFileURL(sourceImage).href;
  if (layout === "top_light_editorial") {
    const lines = wrapText(prompt, 76, 4)
      .map((line, index) => `<tspan x="1" dy="${index === 0 ? 0 : 23}">${escapeXml(line)}</tspan>`)
      .join("");
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1000" height="1500" viewBox="0 0 1000 1500">
  <defs>
    <linearGradient id="top-light" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.92"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <image x="0" y="0" width="1000" height="1500" preserveAspectRatio="xMidYMid slice" href="${escapeXml(imageUrl)}" xlink:href="${escapeXml(imageUrl)}"/>
  <rect x="0" y="0" width="1000" height="460" fill="url(#top-light)"/>
  <g transform="translate(52 62)" fill="#171717">
    <text x="1" y="21" font-family="Avenir Next, Avenir, Helvetica Neue, sans-serif" font-size="18" font-weight="600" letter-spacing="0.8">@musya_gpt</text>
    <text x="-1" y="135" font-family="Avenir Next Demi Bold, Avenir Next, Helvetica Neue, sans-serif" font-size="116" font-weight="600" letter-spacing="1.4">ПРОМПТ</text>
    <text x="1" y="179" font-family="Avenir Next, Avenir, Helvetica Neue, sans-serif" font-size="18" font-weight="500" letter-spacing="0.1" opacity="0.96">${lines}</text>
  </g>
</svg>`;
  }

  const lines = wrapText(prompt)
    .map((line, index) => `<tspan x="500" dy="${index === 0 ? 0 : 28}">${escapeXml(line)}</tspan>`)
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1000" height="1500" viewBox="0 0 1000 1500">
  <defs>
    <linearGradient id="bottom-scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#050505" stop-opacity="0"/>
      <stop offset="0.45" stop-color="#050505" stop-opacity="0.54"/>
      <stop offset="1" stop-color="#050505" stop-opacity="0.94"/>
    </linearGradient>
  </defs>
  <image x="0" y="0" width="1000" height="1500" preserveAspectRatio="xMidYMid slice" href="${escapeXml(imageUrl)}" xlink:href="${escapeXml(imageUrl)}"/>
  <rect x="0" y="760" width="1000" height="740" fill="url(#bottom-scrim)"/>
  <text x="500" y="52" fill="#ffffff" fill-opacity="0.82" text-anchor="middle" font-family="Helvetica Neue, Arial, sans-serif" font-size="16" letter-spacing="0.4">больше про нейросети → @musya_gpt</text>
  <text x="500" y="1150" fill="#ffffff" text-anchor="middle" font-family="Georgia, Times New Roman, serif" font-size="76" font-weight="700" letter-spacing="1">ПРОМПТ</text>
  <line x1="154" y1="1185" x2="846" y2="1185" stroke="#ffffff" stroke-opacity="0.48" stroke-width="1"/>
  <text x="500" y="1235" fill="#ffffff" fill-opacity="0.96" text-anchor="middle" font-family="Helvetica Neue, Arial, sans-serif" font-size="21" font-weight="400">${lines}</text>
</svg>`;
}

function expandHome(value) {
  if (value === "~") return process.env.HOME;
  if (value.startsWith("~/")) return path.join(process.env.HOME, value.slice(2));
  return value;
}

export async function renderWithPlaywright(svgFile, outputFile, rendererConfig) {
  const modulePath = expandHome(rendererConfig.playwright_module);
  const executablePath = expandHome(rendererConfig.chrome_executable);
  const { chromium } = require(modulePath);
  await fs.access(executablePath);
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: [
      "--allow-file-access-from-files",
      "--disable-background-networking",
      "--disable-component-update",
      "--no-first-run",
    ],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1000, height: 1500 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    await page.goto(pathToFileURL(svgFile).href, { waitUntil: "load" });
    await page.screenshot({ path: outputFile, type: "png" });
    await context.close();
  } finally {
    await browser.close();
  }
}

async function main() {
  const [id] = process.argv.slice(2);
  if (!id) throw new Error("Usage: npm run factory:render -- <run-id>");
  const manifest = await loadManifest(id);
  const config = await readJson(CONFIG_PATH);
  if (manifest.status === "rendered") {
    console.log(manifest.assets.final_image);
    return;
  }
  if (manifest.status !== "generated") {
    throw new Error(`Run must be generated before rendering; current status is ${manifest.status}`);
  }
  if (!manifest.assets.source_image) throw new Error("Set assets.source_image in manifest");
  if (!manifest.content.prompt_ru.trim()) throw new Error("Set content.prompt_ru in manifest");

  const sourceImage = resolveProjectPath(manifest.assets.source_image);
  await fs.access(sourceImage);
  const runDirectory = path.join(FACTORY_DIR, "runs", id);
  const svgFile = path.join(runDirectory, "card.svg");
  const outputFile = path.join(runDirectory, "pin.png");
  await fs.writeFile(
    svgFile,
    makeSvg({
      sourceImage,
      prompt: manifest.content.prompt_ru,
      layout: manifest.content.layout,
    }),
    "utf8",
  );
  await renderWithPlaywright(svgFile, outputFile, config.renderer);

  manifest.assets.final_image = path.relative(ROOT_DIR, outputFile);
  transitionManifest(manifest, "rendered", "Rendered 1000×1500 card with local Playwright and Chrome");
  await syncManifest(manifest);
  console.log(manifest.assets.final_image);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
