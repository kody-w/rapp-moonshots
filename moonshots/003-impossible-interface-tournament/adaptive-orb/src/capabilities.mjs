const CAPABILITY_BOUNDARY =
  "Installability and offline access do not guarantee camera, microphone, or speech availability.";

function detectRuntimeCapabilities({
  navigatorObject = globalThis.navigator,
  globalObject = globalThis,
  matchMediaFunction = globalThis.matchMedia,
  secureContext = globalThis.isSecureContext,
  locationObject = globalThis.location,
} = {}) {
  let displayModeStandalone = false;
  if (typeof matchMediaFunction === "function") {
    try {
      displayModeStandalone =
        matchMediaFunction.call(globalObject, "(display-mode: standalone)")
          ?.matches === true;
    } catch {
      displayModeStandalone = false;
    }
  }

  const userAgent = String(navigatorObject?.userAgent || "");
  const platform = String(navigatorObject?.platform || "");
  const iosLike =
    /iPhone|iPad|iPod/i.test(userAgent) ||
    (platform === "MacIntel" && Number(navigatorObject?.maxTouchPoints) > 1);
  const standalone =
    navigatorObject?.standalone === true || displayModeStandalone;
  const mediaCaptureApi =
    typeof navigatorObject?.mediaDevices?.getUserMedia === "function";
  const speechRecognitionApi =
    typeof globalObject?.SpeechRecognition === "function" ||
    typeof globalObject?.webkitSpeechRecognition === "function";
  const speechSynthesisApi =
    typeof globalObject?.speechSynthesis?.speak === "function" &&
    typeof globalObject?.SpeechSynthesisUtterance === "function";
  const currentProtocol = String(locationObject?.protocol || "");
  const contextIsSecure = secureContext === true;
  const liveSensorPrerequisites = contextIsSecure && mediaCaptureApi;

  return Object.freeze({
    standalone,
    iosLike,
    secureContext: contextIsSecure,
    currentProtocol,
    mediaCaptureApi,
    speechRecognitionApi,
    speechSynthesisApi,
    liveSensorPrerequisites,
    fullHandsFreePrerequisites:
      liveSensorPrerequisites &&
      speechRecognitionApi &&
      speechSynthesisApi,
  });
}

function buildBrowserLaunchUrl(locationObject = globalThis.location) {
  try {
    const url = new URL(String(locationObject?.href || ""));
    const localHost = ["localhost", "127.0.0.1", "[::1]"].includes(
      url.hostname,
    );
    if (url.protocol !== "https:" && !(url.protocol === "http:" && localHost)) {
      return null;
    }
    url.searchParams.delete("simulate");
    url.searchParams.set("browser", "1");
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function describeRuntimeCapabilities(
  capabilities,
  {
    liveStartFailed = false,
    runtimeIssues = [],
    browserLaunchUrl = null,
  } = {},
) {
  const issues = new Set(runtimeIssues);
  const hasRuntimeIssue = issues.size > 0;
  const degraded =
    liveStartFailed ||
    hasRuntimeIssue ||
    !capabilities.liveSensorPrerequisites ||
    !capabilities.speechRecognitionApi ||
    !capabilities.speechSynthesisApi;
  let title;
  let explanation;

  if (liveStartFailed) {
    title = "Live sensors did not start in this runtime";
    explanation =
      "Permission, hardware, or this browser context may be the cause. Sensor-free interaction is fully available.";
  } else if (!capabilities.secureContext) {
    title = "Live sensors require a secure browser context";
    explanation =
      "Use HTTPS or localhost. Camera and microphone access is unavailable in this context.";
  } else if (!capabilities.mediaCaptureApi) {
    title = "Camera and microphone APIs are unavailable here";
    explanation =
      "This runtime does not expose getUserMedia. Sensor-free interaction is fully available.";
  } else if (issues.has("camera") || issues.has("microphone")) {
    title = "Live camera or microphone access was lost";
    explanation =
      "The app revoked sensor-derived aim and confirmation. Continue sensor-free or retry in a browser context.";
  } else if (
    !capabilities.speechRecognitionApi ||
    issues.has("speech")
  ) {
    title = "Speech recognition is unavailable here";
    explanation =
      "Camera gestures may still work, while touch, keyboard, and switch controls provide full semantic parity.";
  } else if (!capabilities.speechSynthesisApi) {
    title = "Spoken AI responses are unavailable here";
    explanation =
      "Responses remain visible and all sensor-free controls remain available.";
  } else {
    title = capabilities.standalone
      ? "Installed offline shell; live access is not guaranteed"
      : "Live-sensor prerequisites detected; permission is not confirmed";
    explanation =
      "This runtime exposes the required APIs, but hardware and permission are checked only after Start.";
  }

  return Object.freeze({
    canStartLive: capabilities.liveSensorPrerequisites,
    degraded,
    showSensorFreeOffer: degraded,
    showSafariLink:
      degraded &&
      capabilities.standalone &&
      capabilities.iosLike &&
      Boolean(browserLaunchUrl),
    browserLaunchUrl,
    title,
    detail: `${explanation} ${CAPABILITY_BOUNDARY}`,
  });
}

export {
  CAPABILITY_BOUNDARY,
  buildBrowserLaunchUrl,
  describeRuntimeCapabilities,
  detectRuntimeCapabilities,
};
