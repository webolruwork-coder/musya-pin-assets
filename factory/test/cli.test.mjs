import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  canTransition,
  fingerprintReference,
  imageDimensions,
  transitionManifest,
} from "../cli.mjs";
import { publicAsset } from "../host.mjs";
import { escapeXml, makeSvg, wrapText } from "../render.mjs";

test("linear stages cannot be skipped", () => {
  assert.equal(canTransition("queued", "research_ready"), true);
  assert.equal(canTransition("queued", "generated"), false);
  assert.equal(canTransition("rendered", "needs_review"), true);
});

test("transition appends history and is idempotent", () => {
  const manifest = { status: "queued", history: [] };
  transitionManifest(manifest, "research_ready", "ten results reviewed");
  assert.equal(manifest.status, "research_ready");
  assert.equal(manifest.history.length, 1);
  transitionManifest(manifest, "research_ready", "ignored duplicate");
  assert.equal(manifest.history.length, 1);
});

test("a reviewed run can resume only at its last linear stage", () => {
  const manifest = {
    status: "needs_review",
    history: [
      { status: "rendered", at: "2026-09-21T00:00:00.000Z", note: "" },
      { status: "needs_review", at: "2026-09-21T00:01:00.000Z", note: "wrong size" },
    ],
  };
  transitionManifest(manifest, "rendered", "fixed size");
  assert.equal(manifest.status, "rendered");
  assert.throws(() => transitionManifest(manifest, "hosted"), /Invalid status transition/);
});

test("reference fingerprint ignores fragments and normalizes query order", () => {
  const first = fingerprintReference("https://www.pinterest.com/pin/123/?b=2&a=1#detail");
  const second = fingerprintReference("https://www.pinterest.com/pin/123/?a=1&b=2");
  assert.equal(first, second);
});

test("reads dimensions from a PNG header", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pin-factory-"));
  const file = path.join(directory, "pin.png");
  const header = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header, 0);
  header.writeUInt32BE(1000, 16);
  header.writeUInt32BE(1500, 20);
  await fs.writeFile(file, header);
  assert.deepEqual(await imageDimensions(file), { width: 1000, height: 1500, format: "png" });
});

test("renderer wraps and escapes prompt text", () => {
  const lines = wrapText("один два три четыре пять", 10, 3);
  assert.deepEqual(lines, ["один два", "три четыре", "пять"]);
  assert.equal(escapeXml("A&B <C>"), "A&amp;B &lt;C&gt;");
  const svg = makeSvg({ sourceImage: "/tmp/source image.png", prompt: "Мода & свет" });
  assert.match(svg, /Мода &amp; свет/);
  assert.match(svg, /width="1000" height="1500"/);
});

test("host path and public URL use the run id", () => {
  const asset = publicAsset(
    { hosting: { directory: "pins", public_base_url: "https://example.com/assets/" } },
    "2026-09-22-glass-key",
  );
  assert.deepEqual(asset, {
    relativePath: "pins/2026-09-22-glass-key.png",
    url: "https://example.com/assets/pins/2026-09-22-glass-key.png",
  });
});
