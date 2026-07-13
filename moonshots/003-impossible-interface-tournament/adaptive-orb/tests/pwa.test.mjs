import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const root = new URL("../", import.meta.url);

function pngSize(buffer) {
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

test("manifest is installable, standalone, scoped, and uses only local icons", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("manifest.webmanifest", root), "utf8"),
  );
  assert.equal(manifest.id, "./");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.orientation, "any");
  assert.ok(manifest.icons.length >= 2);
  for (const icon of manifest.icons) {
    assert.match(icon.src, /^\.\/icons\//);
    assert.equal(icon.type, "image/png");
    assert.doesNotMatch(icon.src, /https?:|\/\//);
  }
});

test("local PWA icons have exact Apple and install dimensions", async () => {
  const [apple, small, large] = await Promise.all([
    readFile(new URL("icons/apple-touch-icon.png", root)),
    readFile(new URL("icons/icon-192.png", root)),
    readFile(new URL("icons/icon-512.png", root)),
  ]);
  assert.deepEqual(pngSize(apple), { width: 180, height: 180 });
  assert.deepEqual(pngSize(small), { width: 192, height: 192 });
  assert.deepEqual(pngSize(large), { width: 512, height: 512 });
});

test("service worker allowlists static shell and bypasses all sensitive data", async () => {
  const worker = await readFile(new URL("service-worker.js", root), "utf8");
  for (const asset of [
    "./index.html",
    "./manifest.webmanifest",
    "./icons/apple-touch-icon.png",
    "./icons/icon-192.png",
    "./icons/icon-512.png",
  ]) {
    assert.ok(worker.includes(`"${asset}"`), asset);
  }
  assert.match(worker, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(worker, /request\.method !== "GET"/);
  assert.match(worker, /url\.origin !== self\.location\.origin/);
  assert.match(worker, /ACTIVATE_UPDATE/);
  assert.match(worker, /adaptive-orb-static-v3/);
  assert.doesNotMatch(
    worker,
    /MediaStream|conversation_history|user_input|metrics|calibration|indexedDB/,
  );
});

test("offline worker serves canonical shell but never intercepts API or media", async () => {
  const source = await readFile(new URL("service-worker.js", root), "utf8");
  const handlers = {};
  const matches = [];
  const context = {
    URL,
    fetch: async () => {
      throw new Error("offline");
    },
    caches: {
      async match(key) {
        matches.push(key);
        return { cached: key };
      },
      async open() {
        return {
          async addAll() {},
          async put() {},
        };
      },
      async keys() {
        return [];
      },
      async delete() {
        return true;
      },
    },
    self: {
      location: { origin: "https://example.test" },
      registration: { scope: "https://example.test/adaptive-orb/" },
      clients: { async claim() {} },
      addEventListener(type, handler) {
        handlers[type] = handler;
      },
      skipWaiting() {},
    },
  };
  vm.runInNewContext(source, context);

  let shellResponse = null;
  handlers.fetch({
    request: {
      method: "GET",
      url: "https://example.test/adaptive-orb/index.html?simulate=1",
    },
    respondWith(value) {
      shellResponse = value;
    },
  });
  assert.deepEqual(await shellResponse, {
    cached: "https://example.test/adaptive-orb/index.html",
  });
  assert.deepEqual(matches, [
    "https://example.test/adaptive-orb/index.html",
  ]);

  for (const request of [
    { method: "POST", url: "https://example.test/api/chat" },
    {
      method: "GET",
      url: "https://example.test/adaptive-orb/camera-frame.bin",
    },
    { method: "GET", url: "https://other.test/adaptive-orb/index.html" },
  ]) {
    let intercepted = false;
    handlers.fetch({
      request,
      respondWith() {
        intercepted = true;
      },
    });
    assert.equal(intercepted, false, request.url);
  }
});

test("HTML and CSS include honest standalone degradation, Safari recovery, and parity hooks", async () => {
  const [template, styles, sensors, capabilities, app] = await Promise.all([
    readFile(new URL("src/index.template.html", root), "utf8"),
    readFile(new URL("src/styles.css", root), "utf8"),
    readFile(new URL("src/sensors.mjs", root), "utf8"),
    readFile(new URL("src/capabilities.mjs", root), "utf8"),
    readFile(new URL("src/app.mjs", root), "utf8"),
  ]);
  assert.match(template, /apple-mobile-web-app-capable/);
  assert.match(template, /apple-touch-icon/);
  assert.match(template, /Share → Add to Home Screen/);
  assert.match(template, /require HTTPS or localhost/);
  assert.match(template, /Open in Safari for live sensors/);
  assert.match(template, /Installation works for offline/);
  assert.match(template, /id="permissionMic"/);
  assert.match(template, /id="permissionCamera"/);
  assert.match(template, /Start sensor-free AI/);
  assert.match(template, /id="capabilitySensorFree"/);
  assert.match(template, /id="runtimeCapability"/);
  assert.match(template, /manifest\.webmanifest/);
  assert.match(styles, /env\(safe-area-inset-top\)/);
  assert.match(styles, /env\(safe-area-inset-bottom\)/);
  assert.match(styles, /orientation: landscape/);
  assert.match(sensors, /webkitSpeechRecognition/);
  assert.match(sensors, /frame-motion fallback/);
  assert.match(sensors, /Speech permission or service is unavailable/);
  assert.match(capabilities, /display-mode: standalone/);
  assert.match(capabilities, /navigatorObject\?\.standalone/);
  assert.match(capabilities, /mediaDevices\?\.getUserMedia/);
  assert.match(capabilities, /webkitSpeechRecognition/);
  assert.match(capabilities, /showSafariLink/);
  assert.match(app, /detectRuntimeCapabilities/);
  assert.match(app, /kind: "accessible"/);
  assert.match(app, /sensorController\.enableMicrophone\(\)/);
  assert.match(app, /sensorController\.enableCamera\(\)/);
  assert.match(app, /background-interruption/);
  assert.match(app, /INTERRUPTION_RESUME/);
  assert.match(app, /transitionToSensorFree\("open-browser"\)/);
  assert.match(app, /applyingServiceWorkerUpdate && !reloadingForWorker/);
});
