import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  autoApprovalEligible,
  canTransition,
  fingerprintReference,
  imageDimensions,
  productionSlots,
  transitionManifest,
} from "../cli.mjs";
import { hostingBlockReason, publicAsset } from "../host.mjs";
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

test("top light layout keeps typography above a light image", () => {
  const svg = makeSvg({
    sourceImage: "/tmp/source.png",
    prompt: "Sculptural glass bookmark on an ivory surface",
    layout: "top_light_editorial",
  });
  assert.match(svg, /id="top-light"/);
  assert.match(svg, /transform="translate\(52 62\)"/);
  assert.doesNotMatch(svg, /bottom-scrim/);
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

test("hosting requires explicit approval after validation", () => {
  assert.match(
    hostingBlockReason({ status: "validated", approval: { status: "pending" } }),
    /approved in the review queue/,
  );
  assert.equal(
    hostingBlockReason({ status: "validated", approval: { status: "approved" } }),
    null,
  );
});

test("daily production creates fifteen distinct slots", () => {
  const schedule_times = Array.from({ length: 15 }, (_, index) => `${String(index).padStart(2, "0")}:00`);
  const topic_rotation = Array.from({ length: 15 }, (_, index) => ({ pillar: `p${index}`, query: `q${index}` }));
  const slots = productionSlots(
    { production: { daily_target: 15, schedule_times, topic_rotation } },
    "2026-10-10",
  );
  assert.equal(slots.length, 15);
  assert.equal(new Set(slots.map((slot) => slot.planned_at_local)).size, 15);
  assert.equal(slots[14].planned_at_local, "2026-10-10T14:00:00");
});

test("daily factory auto-approves only validated production manifests", () => {
  const config = { production: { approval_mode: "automatic_quality_gate" } };
  assert.equal(autoApprovalEligible({ production: { slot_index: 1 } }, config, { passed: true }), true);
  assert.equal(autoApprovalEligible({}, config, { passed: true }), false);
  assert.equal(autoApprovalEligible({ production: { slot_index: 1 } }, config, { passed: false }), false);
});
