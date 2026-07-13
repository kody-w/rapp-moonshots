import assert from "node:assert/strict";
import test from "node:test";
import {
  MOBILE_LAYOUT_CONTRACT,
  MobileFeedback,
  MobileMetricsTracker,
  mobileLayoutForViewport,
  phoneChoiceWindow,
  radialChoiceGeometry,
  shortSpokenSummary,
} from "../src/mobile.mjs";

test("390x844 portrait and 844x390 landscape honor the mobile contract", () => {
  const portrait = mobileLayoutForViewport(390, 844, {
    top: 47,
    right: 0,
    bottom: 34,
    left: 0,
  });
  const landscape = mobileLayoutForViewport(844, 390, {
    top: 0,
    right: 47,
    bottom: 21,
    left: 47,
  });

  assert.deepEqual(MOBILE_LAYOUT_CONTRACT.portrait, {
    width: 390,
    height: 844,
  });
  assert.deepEqual(MOBILE_LAYOUT_CONTRACT.landscape, {
    width: 844,
    height: 390,
  });
  assert.equal(portrait.orientation, "portrait");
  assert.equal(landscape.orientation, "landscape");
  assert.equal(portrait.noHorizontalOverflow, true);
  assert.equal(landscape.noHorizontalOverflow, true);
  assert.equal(portrait.orbDiameter, 356);
  assert.ok(Math.abs(landscape.orbDiameter - 319.8) < 1e-9);
  assert.equal(portrait.minimumTargetPx, 44);
  assert.ok(portrait.orbDiameter >= MOBILE_LAYOUT_CONTRACT.centerOrbMinimumPx);
  assert.ok(landscape.orbDiameter >= MOBILE_LAYOUT_CONTRACT.centerOrbMinimumPx);
});

test("portrait and landscape radial geometry clears center and viewport bounds", () => {
  const layouts = [
    radialChoiceGeometry({
      stageDiameter: 286,
      choiceWidth: 76.8,
      choiceHeight: 68,
      centerDiameter: 112,
      choiceCount: 4,
      radiusRatio: 0.35,
    }),
    radialChoiceGeometry({
      stageDiameter: 303,
      choiceWidth: 90,
      choiceHeight: 56,
      centerDiameter: 104,
      choiceCount: 4,
      radiusRatio: 0.35,
    }),
  ];
  for (const layout of layouts) {
    assert.equal(layout.feasible, true);
    assert.equal(layout.safe, true);
    assert.equal(layout.overflow, false);
    assert.equal(layout.centerOverlap, false);
    for (const position of layout.positions) {
      assert.ok(position.left >= 0);
      assert.ok(position.top >= 0);
      assert.ok(position.right <= (layout === layouts[0] ? 286 : 303));
      assert.ok(position.bottom <= (layout === layouts[0] ? 286 : 303));
      assert.ok(position.centerClearance >= 0);
    }
  }
});

test("phone choices are stable four-item pages around the highlighted choice", () => {
  const options = Array.from({ length: 6 }, (_, index) => ({
    id: `choice-${index + 1}`,
  }));
  const first = phoneChoiceWindow(options, null);
  const refined = phoneChoiceWindow(options, "choice-5");

  assert.deepEqual(first.ids, [
    "choice-1",
    "choice-2",
    "choice-3",
    "choice-4",
  ]);
  assert.deepEqual(refined.ids, ["choice-5", "choice-6"]);
  assert.equal(refined.page, 1);
  assert.equal(refined.pageCount, 2);
  assert.equal(refined.refined, true);
  assert.equal(refined.ids.length <= 4, true);
});

test("spoken summaries are concise and preserve the first useful sentence", () => {
  assert.equal(
    shortSpokenSummary("Prep first. This second sentence is not spoken."),
    "Prep first.",
  );
  const summary = shortSpokenSummary(
    "One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen.",
  );
  assert.equal(summary.split(/\s+/).length, 16);
  assert.match(summary, /…$/);
});

test("mobile telemetry records value, glance, fallback, interruption, and sensor time", () => {
  let now = 0;
  const metrics = new MobileMetricsTracker({ clock: () => now });
  metrics.start();
  metrics.notePermissionRequest("microphone");
  now = 10;
  metrics.noteSensorStatus("microphone", "active");
  now = 20;
  metrics.noteAction(
    { type: "HIGHLIGHT", source: "touch" },
    { ok: true },
  );
  now = 120;
  metrics.noteAction(
    { type: "CONFIRM", source: "touch" },
    { ok: true },
  );
  metrics.noteValue();
  now = 150;
  metrics.beginInterruption();
  now = 210;
  metrics.recoverInterruption();
  metrics.noteOrientationChange();
  now = 310;
  const record = metrics.snapshot(now, {
    voiceRepairs: 2,
    falseCommits: 0,
  });

  assert.equal(record.permissionToValueMs, 120);
  assert.equal(record.glanceTimeProxyMs, 100);
  assert.equal(record.glanceSamples, 1);
  assert.equal(record.oneHandTouchFallbacks, 2);
  assert.equal(record.interruptions, 1);
  assert.equal(record.interruptionRecoveries, 1);
  assert.equal(record.interruptionRecoveryMs, 60);
  assert.equal(record.sensorOnMs.microphone, 300);
  assert.equal(record.permissionRequests.microphone, 1);
  assert.equal(record.orientationChanges, 1);
  assert.equal(record.voiceRepairs, 2);
});

test("haptics are opt-in and only signal when browser support succeeds", () => {
  const patterns = [];
  let tracked = 0;
  const feedback = new MobileFeedback({
    globalObject: {},
    navigatorObject: {
      vibrate(pattern) {
        patterns.push(pattern);
        return true;
      },
    },
    onHaptic: () => {
      tracked += 1;
    },
  });

  feedback.signal("confirm");
  assert.equal(patterns.length, 0);
  assert.equal(feedback.setHaptics(true), true);
  feedback.signal("confirm");
  assert.deepEqual(patterns, [18]);
  assert.equal(tracked, 1);
  feedback.setHaptics(false);
  feedback.signal("stop");
  assert.equal(patterns.length, 1);
});
