import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const trackRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = await readFile(resolve(trackRoot, "index.html"), "utf8");

test("built application is self-contained and has no external or persistence APIs", () => {
  assert.doesNotMatch(html, /<(?:script|img)[^>]+\bsrc\s*=\s*["'][^"']+/i);
  assert.doesNotMatch(html, /<link[^>]+\bhref\s*=/i);
  assert.doesNotMatch(html, /\bhttps?:\/\//i);
  assert.doesNotMatch(
    html,
    /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|MediaRecorder|RTCPeerConnection|localStorage|sessionStorage|indexedDB)\b/,
  );
  assert.match(html, /getUserMedia/);
  assert.match(html, /getImageData/);
  assert.match(html, /FaceDetector/);
  assert.match(html, /SpeechRecognition/);
  assert.match(html, /speechSynthesis/);
  assert.match(html, /never records, stores, uploads, or makes network requests/i);
});

test("Clawpilot theme is complete, first, and exclusive outside token declarations", () => {
  const requiredTokens = [
    "--cp-bg",
    "--cp-bg-elevated",
    "--cp-surface",
    "--cp-surface-soft",
    "--cp-border",
    "--cp-border-strong",
    "--cp-text",
    "--cp-text-muted",
    "--cp-text-soft",
    "--cp-accent",
    "--cp-accent-hover",
    "--cp-accent-soft",
    "--cp-accent-fg",
    "--cp-success",
    "--cp-danger",
    "--cp-warning",
    "--cp-link",
    "--cp-shadow",
    "--cp-overlay",
    "--cp-panel",
    "--cp-panel-strong",
    "--cp-sheen",
    "--cp-highlight",
  ];
  requiredTokens.forEach((token) => assert.match(html, new RegExp(`${token}:`)));
  assert.ok(html.indexOf("scoutTheme") < html.indexOf("class TunnelEngine"));
  assert.match(
    html,
    /"Segoe UI", Aptos, Calibri, -apple-system, BlinkMacSystemFont, sans-serif/,
  );

  const style = html.match(/<style>([\s\S]*?)<\/style>/i)?.[1] ?? "";
  const outsideTokens = style.replace(/^\s*--cp-[^;]+;\s*$/gm, "");
  assert.doesNotMatch(outsideTokens, /#[\da-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
});

test("interaction surface avoids menus, forms, chat, and clickable tunnel commits", () => {
  assert.doesNotMatch(html, /<(?:menu|form|input|textarea|select)\b/i);
  assert.doesNotMatch(html, /\bchat\b/i);
  assert.match(html, /class="launch-control"/);
  assert.match(html, /Primary route needs no keyboard or pointer/);
  assert.match(html, /Gaze preview and motion never commit/);
  assert.doesNotMatch(html, /mouth\.addEventListener\(["']click/);
});
