import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBrowserLaunchUrl,
  describeRuntimeCapabilities,
  detectRuntimeCapabilities,
} from "../src/capabilities.mjs";

function runtime({
  standalone = true,
  ios = true,
  secure = true,
  media = true,
  recognition = true,
  synthesis = true,
} = {}) {
  const navigatorObject = {
    standalone,
    userAgent: ios ? "iPhone" : "Desktop Browser",
    platform: ios ? "iPhone" : "Linux",
    maxTouchPoints: ios ? 5 : 0,
    mediaDevices: media
      ? {
          async getUserMedia() {},
        }
      : undefined,
  };
  const globalObject = {
    SpeechRecognition: recognition ? class SpeechRecognition {} : undefined,
    speechSynthesis: synthesis ? { speak() {} } : undefined,
    SpeechSynthesisUtterance: synthesis
      ? class SpeechSynthesisUtterance {}
      : undefined,
  };
  return detectRuntimeCapabilities({
    navigatorObject,
    globalObject,
    matchMediaFunction: () => ({ matches: standalone }),
    secureContext: secure,
    locationObject: {
      protocol: "https:",
    },
  });
}

test("installed shell detection never equates installability with live permission", () => {
  const capabilities = runtime();
  const presentation = describeRuntimeCapabilities(capabilities);
  assert.equal(capabilities.standalone, true);
  assert.equal(capabilities.fullHandsFreePrerequisites, true);
  assert.equal(presentation.canStartLive, true);
  assert.equal(presentation.degraded, false);
  assert.match(presentation.title, /live access is not guaranteed/i);
  assert.match(
    presentation.detail,
    /hardware and permission are checked only after Start/i,
  );
  assert.match(
    presentation.detail,
    /Installability and offline access do not guarantee/i,
  );
});

test("iOS standalone without media APIs offers sensor-free and Safari", () => {
  const capabilities = runtime({ media: false, recognition: false });
  const presentation = describeRuntimeCapabilities(capabilities, {
    browserLaunchUrl: "https://example.test/adaptive-orb/?browser=1",
  });
  assert.equal(presentation.canStartLive, false);
  assert.equal(presentation.degraded, true);
  assert.equal(presentation.showSensorFreeOffer, true);
  assert.equal(presentation.showSafariLink, true);
  assert.match(presentation.title, /Camera and microphone APIs are unavailable/);
});

test("missing standalone speech degrades honestly without disabling camera", () => {
  const capabilities = runtime({ recognition: false });
  const presentation = describeRuntimeCapabilities(capabilities, {
    browserLaunchUrl: "https://example.test/adaptive-orb/?browser=1",
  });
  assert.equal(presentation.canStartLive, true);
  assert.equal(presentation.degraded, true);
  assert.equal(presentation.showSafariLink, true);
  assert.match(presentation.title, /Speech recognition is unavailable/);
  assert.match(presentation.detail, /touch, keyboard, and switch controls/);
});

test("permission or startup failure exposes the standalone recovery path", () => {
  const presentation = describeRuntimeCapabilities(runtime(), {
    liveStartFailed: true,
    runtimeIssues: ["camera", "microphone"],
    browserLaunchUrl: "https://example.test/adaptive-orb/?browser=1",
  });
  assert.equal(presentation.degraded, true);
  assert.equal(presentation.showSensorFreeOffer, true);
  assert.equal(presentation.showSafariLink, true);
  assert.match(presentation.title, /did not start/);
  assert.match(presentation.detail, /Permission, hardware, or this browser context/);
});

test("Safari recovery link is scoped, simulation-free, and only offered on iOS standalone", () => {
  const url = buildBrowserLaunchUrl({
    href: "https://example.test/orb/?simulate=1&companion=1#private",
  });
  assert.equal(
    url,
    "https://example.test/orb/?companion=1&browser=1",
  );
  const browserPresentation = describeRuntimeCapabilities(
    runtime({ standalone: false, ios: false, media: false }),
    { browserLaunchUrl: url },
  );
  assert.equal(browserPresentation.showSafariLink, false);
  assert.equal(
    buildBrowserLaunchUrl({ href: "file:///adaptive-orb/index.html" }),
    null,
  );
  assert.equal(
    buildBrowserLaunchUrl({ href: "http://example.test/adaptive-orb/" }),
    null,
  );
  assert.equal(
    buildBrowserLaunchUrl({ href: "http://localhost:8073/?simulate=1" }),
    "http://localhost:8073/?browser=1",
  );
});
