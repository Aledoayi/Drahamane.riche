"use strict";

const IMAGE_FOLDER = "images/";
const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "svg",
  "avif",
]);

const subtleFilters = [
  "brightness(1.05)",
  "contrast(1.08)",
  "saturate(1.14)",
  "grayscale(0.18) contrast(1.04)",
  "sepia(0.16) saturate(1.05)",
  "blur(0.45px) saturate(1.08)",
  "brightness(1.03) contrast(1.06) saturate(1.08)",
];

const state = {
  images: [],
  currentIndex: 0,
  visibleBuffer: null,
  hiddenBuffer: null,
  isPlaying: false,
  isPlayOnce: false,
  durationMs: 5000,
  configuredMaxDurationMs: 60 * 60 * 1000,
  maxDurationMs: 60 * 60 * 1000,
  timerId: 0,
  autoStopTimerId: 0,
  countdownTimerId: 0,
  progressFrame: 0,
  progressStartedAt: 0,
  slideshowStartedAt: 0,
  activeFilter: "none",
  wakeLock: null,
  drag: {
    active: false,
    startX: 0,
    lastX: 0,
    startedAt: 0,
    pointerId: null,
  },
};

const viewer = document.querySelector("#viewer");
const frontBuffer = document.querySelector("#frontBuffer");
const backBuffer = document.querySelector("#backBuffer");
const shuffleButton = document.querySelector("#shuffleButton");
const mixButton = document.querySelector("#mixButton");
const filterButton = document.querySelector("#filterButton");
const slideshowButton = document.querySelector("#slideshowButton");
const slideshowLabel = document.querySelector("#slideshowLabel");
const playOnceButton = document.querySelector("#playOnceButton");
const durationSelect = document.querySelector("#durationSelect");
const maxDurationSelect = document.querySelector("#maxDurationSelect");
const countdownValue = document.querySelector("#countdownValue");
const filenameOverlay = document.querySelector("#filenameOverlay");
const modeStatus = document.querySelector("#modeStatus");
const progressBar = document.querySelector("#progressBar");
const prevButton = document.querySelector("#prevButton");
const nextButton = document.querySelector("#nextButton");
const bottomReveal = document.querySelector("#bottomReveal");
const imagePickerToggle = document.querySelector("#imagePickerToggle");
const imagePicker = document.querySelector("#imagePicker");
const imagePickerList = document.querySelector("#imagePickerList");
let controlsHideId = 0;
let cursorHideId = 0;
let filenameHideId = 0;
let imagePickerHideId = 0;
let manualControlsHideId = 0;
const imageMeta = new Map();

state.visibleBuffer = frontBuffer;
state.hiddenBuffer = backBuffer;
state.durationMs = Number(durationSelect.value || 5) * 1000;
state.configuredMaxDurationMs =
  Number(maxDurationSelect.value || 60) * 60 * 1000;
state.maxDurationMs = state.configuredMaxDurationMs;

async function bootGallery() {
  state.images = await discoverImages();
  state.currentIndex = getRandomIndex(state.images.length);
  renderImagePickerList();
  preloadImages(state.images);
  await paintInitialImage();
  updateImagePickerSelection();
  updateStatus();
  scheduleManualControlsHide(1000);
}

async function discoverImages() {
  const sources = [
    await discoverManifestLoaderImages(),
    await discoverGithubPagesImages(),
    await discoverDirectoryImages(),
    await discoverJsonManifestImages()
  ];
  const candidates = uniqueImages(sources.flat()).filter(isSupportedImage);
  if (candidates.length === 0) {
    return [];
  }
  return filterExistingImages(candidates);
}

async function filterExistingImages(images) {
  const existingImages = await Promise.all(
    images.map(async (src) => {
      try {
        await loadImage(src, 3500);
        return src;
      } catch {
        return "";
      }
    }),
  );

  return existingImages.filter(Boolean);
}

async function discoverManifestLoaderImages() {
  if (!window.galleryManifestReady) {
    return [];
  }
  try {
    const files = await window.galleryManifestReady;
    return normalizeManifestFiles(files);
  } catch {
    return [];
  }
}

async function discoverJsonManifestImages() {
  try {
    const response = await fetch(`${IMAGE_FOLDER}manifest.json`, {
      cache: "no-store",
    });
    if (!response.ok) {
      return [];
    }
    const files = await response.json();
    if (!Array.isArray(files)) {
      return [];
    }
    return normalizeManifestFiles(files);
  } catch {
    return [];
  }
}

function normalizeManifestFiles(files) {
  return files
    .filter((file) => typeof file === "string")
    .map((file) =>
      file.startsWith(IMAGE_FOLDER) ? file : `${IMAGE_FOLDER}${file}`,
    );
}

async function discoverDirectoryImages() {
  try {
    const response = await fetch(IMAGE_FOLDER, { cache: "no-store" });
    if (!response.ok) {
      return [];
    }
    const html = await response.text();
    const documentFragment = new DOMParser().parseFromString(html, "text/html");
    return [...documentFragment.querySelectorAll("a[href]")]
      .map((link) => link.getAttribute("href"))
      .filter(Boolean)
      .map(
        (href) =>
          new URL(href, new URL(IMAGE_FOLDER, window.location.href)).href,
      )
      .map((href) => normalizeLocalImageUrl(href))
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function discoverGithubPagesImages() {
  const { hostname, pathname } = window.location;
  if (!hostname.endsWith("github.io")) {
    return [];
  }

  const owner = hostname.replace(".github.io", "");
  const project = pathname.split("/").filter(Boolean)[0];
  const repo = project || `${owner}.github.io`;
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${IMAGE_FOLDER.replace(/\/$/, "")}`;

  try {
    const response = await fetch(apiUrl, { cache: "no-store" });
    if (!response.ok) {
      return [];
    }
    const files = await response.json();
    if (!Array.isArray(files)) {
      return [];
    }
    const basePath = project
      ? `/${project}/${IMAGE_FOLDER}`
      : `/${IMAGE_FOLDER}`;
    return files
      .filter((file) => file.type === "file" && isSupportedImage(file.name))
      .map((file) => `${basePath}${encodeURIComponent(file.name)}`);
  } catch {
    return [];
  }
}

function normalizeLocalImageUrl(href) {
  const url = new URL(href, window.location.href);
  if (!url.pathname.includes(`/${IMAGE_FOLDER}`)) {
    return "";
  }
  return `${IMAGE_FOLDER}${decodeURIComponent(url.pathname.split(`/${IMAGE_FOLDER}`).pop())}`;
}

function isSupportedImage(src) {
  const cleanPath = src.split("?")[0].split("#")[0];
  const extension = cleanPath.split(".").pop().toLowerCase();
  return IMAGE_EXTENSIONS.has(extension);
}

function uniqueImages(images) {
  return [...new Set(images)].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
}

function getRandomIndex(length) {
  if (length <= 0) {
    return 0;
  }
  return Math.floor(Math.random() * length);
}

function loadImage(src, timeout = 6000) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    let settled = false;
    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`Image timeout: ${src}`));
      }
    }, timeout);

    img.decoding = "async";
    img.onload = () => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        imageMeta.set(src, {
          height: img.naturalHeight || 0,
          isPortrait: (img.naturalHeight || 0) > (img.naturalWidth || 0),
          width: img.naturalWidth || 0,
        });
        resolve(src);
      }
    };
    img.onerror = () => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        reject(new Error(`Image unavailable: ${src}`));
      }
    };
    img.src = src;
  });
}

function preloadImages(images) {
  images.forEach((src) => {
    const img = new Image();
    img.decoding = "async";
    img.src = src;
  });
}

async function paintInitialImage() {
  if (state.images.length === 0) {
    viewer.classList.add("has-no-images");
    clearBufferImage(state.visibleBuffer);
    if (filenameOverlay) {
      filenameOverlay.textContent = "";
    }
    hideFilenameOverlay();
    return;
  }
  viewer.classList.remove("has-no-images");
  await loadImage(state.images[state.currentIndex]).catch(() => null);
  setBufferImage(state.visibleBuffer, state.images[state.currentIndex]);
  state.visibleBuffer.classList.add("is-visible");
  state.hiddenBuffer.classList.remove("is-visible");
  updateFilenameOverlayText();
  updateImagePickerSelection();
}

function setBufferImage(buffer, src) {
  const image = getBufferImage(buffer);
  image.src = src;
  image.alt = "";
  applyImageOrientation(buffer, src);
  buffer.style.setProperty("--active-filter", state.activeFilter);
}

function getCurrentBufferSource(buffer) {
  return buffer.querySelector(".buffer-photo")?.getAttribute("src") || "";
}

function getBufferImage(buffer) {
  let image = buffer.querySelector(".buffer-photo");
  if (!image) {
    image = document.createElement("img");
    image.className = "buffer-photo";
    image.decoding = "async";
    image.draggable = false;
    buffer.append(image);
  }
  return image;
}

function clearBufferImage(buffer) {
  const image = buffer.querySelector(".buffer-photo");
  if (image) {
    image.removeAttribute("src");
  }
  buffer.classList.remove("is-landscape", "is-portrait");
}

function applyImageOrientation(buffer, src) {
  const metadata = imageMeta.get(src);
  buffer.classList.toggle("is-portrait", Boolean(metadata?.isPortrait));
  buffer.classList.toggle("is-landscape", Boolean(metadata && !metadata.isPortrait));
}

function getBufferTransform(buffer, isVisible = false) {
  const scale = buffer.classList.contains("is-portrait")
    ? 1
    : isVisible
      ? 1.025
      : 1.02;
  return `translate3d(0, 0, 0) scale(${scale})`;
}

function showImage(nextIndex, direction = 1) {
  if (state.images.length === 0) {
    return;
  }

  const boundedIndex = wrapIndex(nextIndex);
  if (
    boundedIndex === state.currentIndex &&
    getCurrentBufferSource(state.visibleBuffer)
  ) {
    return;
  }

  state.currentIndex = boundedIndex;
  const nextSrc = state.images[state.currentIndex];
  loadImage(nextSrc).catch(() => null).finally(() => {
    requestAnimationFrame(() => {
      setBufferImage(state.hiddenBuffer, nextSrc);
      state.hiddenBuffer.classList.add("no-transition");
      state.visibleBuffer.classList.add("no-transition");
      state.hiddenBuffer.style.transform = getBufferTransform(state.hiddenBuffer);

      requestAnimationFrame(() => {
        state.hiddenBuffer.classList.add("is-visible");
        state.visibleBuffer.classList.remove("is-visible");

        const previous = state.visibleBuffer;
        state.visibleBuffer = state.hiddenBuffer;
        state.hiddenBuffer = previous;
        updateFilenameOverlayText();
        updateImagePickerSelection();

        requestAnimationFrame(() => {
          state.visibleBuffer.classList.remove("no-transition");
          state.hiddenBuffer.classList.remove("no-transition");
          state.visibleBuffer.style.transform = getBufferTransform(
            state.visibleBuffer,
            true,
          );
          state.hiddenBuffer.style.transform = getBufferTransform(state.hiddenBuffer);
        });
      });
    });
  });

  if (state.isPlaying) {
    if (state.isPlayOnce) {
      restartPlayOnceTiming();
    }
    scheduleNextSlide();
  }
}

function wrapIndex(index) {
  if (state.images.length === 0) {
    return 0;
  }
  return (index + state.images.length) % state.images.length;
}

function isImagePickerOpen() {
  return Boolean(imagePicker?.classList.contains("is-open"));
}

function openImagePicker() {
  if (!imagePicker || !imagePickerToggle) {
    return;
  }
  window.clearTimeout(imagePickerHideId);
  imagePicker.classList.add("is-open");
  imagePicker.setAttribute("aria-hidden", "false");
  imagePickerToggle.setAttribute("aria-expanded", "true");
  revealManualControls();
}

function closeImagePicker(immediate = true) {
  if (!imagePicker || !imagePickerToggle) {
    return;
  }
  if (!immediate) {
    scheduleHideImagePicker();
    return;
  }
  window.clearTimeout(imagePickerHideId);
  imagePicker.classList.remove("is-open");
  imagePicker.setAttribute("aria-hidden", "true");
  imagePickerToggle.setAttribute("aria-expanded", "false");
}

function scheduleHideImagePicker(delay = 1000) {
  if (!imagePicker) {
    return;
  }
  window.clearTimeout(imagePickerHideId);
  imagePickerHideId = window.setTimeout(() => {
    closeImagePicker(true);
  }, delay);
}

function cancelHideImagePicker() {
  window.clearTimeout(imagePickerHideId);
}

function renderImagePickerList() {
  if (!imagePickerList) {
    return;
  }
  imagePickerList.textContent = "";
  if (state.images.length === 0) {
    const emptyItem = document.createElement("div");
    emptyItem.className = "image-picker-option";
    emptyItem.textContent = "Aucune image disponible";
    emptyItem.setAttribute("aria-disabled", "true");
    imagePickerList.append(emptyItem);
    return;
  }

  state.images.forEach((src, index) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "image-picker-option";
    option.textContent = getFilenameFromPath(src);
    option.dataset.src = src;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", "false");
    option.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const selectedSrc = option.dataset.src || "";
      const selectedIndex = state.images.indexOf(selectedSrc);
      if (selectedIndex < 0) {
        return;
      }
      const direction = selectedIndex >= state.currentIndex ? 1 : -1;
      showImage(selectedIndex, direction);
      scheduleHideImagePicker();
    });
    imagePickerList.append(option);
  });
}

function updateImagePickerSelection() {
  if (!imagePickerList) {
    return;
  }
  const currentSrc = state.images[state.currentIndex] || "";
  const options = imagePickerList.querySelectorAll(".image-picker-option[data-src]");
  options.forEach((option) => {
    const isActive = option.dataset.src === currentSrc;
    option.classList.toggle("is-active", isActive);
    option.setAttribute("aria-selected", isActive ? "true" : "false");
  });
}

function shuffleImages() {
  if (state.images.length < 2) {
    return;
  }

  const currentImage = state.images[state.currentIndex];
  shuffleImageOrder();

  const nextIndex = state.images.findIndex((src) => src !== currentImage);
  showImage(nextIndex >= 0 ? nextIndex : 0, 1);
}

function randomMixImages() {
  if (state.images.length < 2) {
    return;
  }

  const currentSrc = getCurrentBufferSource(state.visibleBuffer);
  shuffleImageOrder();

  let nextIndex = getRandomIndex(state.images.length);
  if (state.images.length > 1 && state.images[nextIndex] === currentSrc) {
    nextIndex = (nextIndex + 1 + getRandomIndex(state.images.length - 1)) % state.images.length;
  }

  showImage(nextIndex, 1);
  pulseStatus("Mix random");
}

function shuffleImageOrder() {
  for (let i = state.images.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [state.images[i], state.images[j]] = [state.images[j], state.images[i]];
  }
}

function applyRandomFilter() {
  const available = subtleFilters.filter(
    (filter) => filter !== state.activeFilter,
  );
  state.activeFilter =
    available[Math.floor(Math.random() * available.length)] || "none";
  [state.visibleBuffer, state.hiddenBuffer].forEach((buffer) => {
    buffer.style.setProperty("--active-filter", state.activeFilter);
  });
  pulseStatus("Filtre actif");
}

function toggleSlideshow() {
  state.isPlaying ? stopSlideshow({ hideUiAfterStop: true }) : startSlideshow();
}

function getPlayOnceImageCount(fromCurrentImage = state.isPlaying) {
  if (state.images.length === 0) {
    return 0;
  }
  return fromCurrentImage
    ? Math.max(state.images.length - state.currentIndex, 1)
    : state.images.length;
}

function getPlayOnceDurationMs(fromCurrentImage = state.isPlaying) {
  return getPlayOnceImageCount(fromCurrentImage) * state.durationMs;
}

function restartPlayOnceTiming() {
  if (!state.isPlaying || !state.isPlayOnce) {
    return;
  }
  state.maxDurationMs = getPlayOnceDurationMs(true);
  state.slideshowStartedAt = performance.now();
  scheduleAutoStop();
  startCountdownTimer();
}

function togglePlayOnce() {
  state.isPlayOnce = !state.isPlayOnce;
  playOnceButton.classList.toggle("is-active", state.isPlayOnce);
  playOnceButton.setAttribute("aria-pressed", String(state.isPlayOnce));
  maxDurationSelect.disabled = state.isPlayOnce;

  if (state.isPlayOnce) {
    state.maxDurationMs = getPlayOnceDurationMs(state.isPlaying);
  } else {
    state.maxDurationMs = state.configuredMaxDurationMs;
  }

  if (state.isPlaying) {
    state.slideshowStartedAt = performance.now();
    scheduleAutoStop();
    startCountdownTimer();
    scheduleNextSlide();
  } else {
    updateCountdownDisplay();
  }
}

async function startSlideshow() {
  revealManualControls();
  closeImagePicker(true);
  state.maxDurationMs = state.isPlayOnce
    ? getPlayOnceDurationMs(true)
    : state.configuredMaxDurationMs;
  state.isPlaying = true;
  state.slideshowStartedAt = performance.now();
  viewer.classList.add("is-playing");
  viewer.classList.remove("controls-visible", "controls-suppressed");
  slideshowButton.blur();
  slideshowButton.classList.add("is-active");
  slideshowButton.setAttribute("aria-pressed", "true");
  slideshowLabel.textContent = "Stop";
  await acquireWakeLock();
  updateStatus();
  startCountdownTimer();
  requestFullscreenIfAvailable();
  scheduleAutoStop();
  scheduleNextSlide();
}

function stopSlideshow(options = {}) {
  state.isPlaying = false;
  state.slideshowStartedAt = 0;
  state.maxDurationMs = state.isPlayOnce
    ? getPlayOnceDurationMs(false)
    : state.configuredMaxDurationMs;
  viewer.classList.remove(
    "is-playing",
    "controls-visible",
    "controls-suppressed",
  );
  slideshowButton.classList.remove("is-active");
  slideshowButton.setAttribute("aria-pressed", "false");
  slideshowLabel.textContent = "Start";
  window.clearTimeout(state.timerId);
  window.clearTimeout(state.autoStopTimerId);
  stopCountdownTimer();
  cancelAnimationFrame(state.progressFrame);
  progressBar.style.transform = "scaleX(0)";
  void releaseWakeLock();
  updateStatus();
  updateCountdownDisplay();
  if (options.hideUiAfterStop) {
    scheduleManualControlsHide();
  } else {
    revealManualControls();
  }
}

async function acquireWakeLock() {
  if (!("wakeLock" in navigator) || !navigator.wakeLock?.request) {
    return;
  }
  if (state.wakeLock) {
    return;
  }

  try {
    const sentinel = await navigator.wakeLock.request("screen");
    sentinel.addEventListener("release", () => {
      if (state.wakeLock === sentinel) {
        state.wakeLock = null;
      }
    });
    state.wakeLock = sentinel;
  } catch {
    state.wakeLock = null;
  }
}

async function releaseWakeLock() {
  if (!state.wakeLock) {
    return;
  }
  try {
    await state.wakeLock.release();
  } catch {
    // Ignore wake lock release failures, gallery behavior should stay intact.
  } finally {
    state.wakeLock = null;
  }
}

function requestFullscreenIfAvailable() {
  if (!document.fullscreenElement && viewer.requestFullscreen) {
    viewer.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
  }
}

function scheduleAutoStop() {
  window.clearTimeout(state.autoStopTimerId);
  if (!state.isPlaying) {
    return;
  }

  const remaining = getRemainingSlideshowDurationMs();
  if (remaining <= 0) {
    stopSlideshow({ hideUiAfterStop: state.isPlayOnce });
    return;
  }

  state.autoStopTimerId = window.setTimeout(() => {
    stopSlideshow({ hideUiAfterStop: state.isPlayOnce });
  }, remaining);
}

function getRemainingSlideshowDurationMs() {
  if (!state.slideshowStartedAt) {
    return state.maxDurationMs;
  }
  const elapsed = performance.now() - state.slideshowStartedAt;
  return Math.max(state.maxDurationMs - elapsed, 0);
}

function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  const totalMinutes = Math.floor(totalSeconds / 60);
  return `${String(totalMinutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function updateCountdownDisplay() {
  if (!countdownValue) {
    return;
  }

  const remaining = state.isPlaying
    ? getRemainingSlideshowDurationMs()
    : state.maxDurationMs;
  countdownValue.textContent = formatCountdown(remaining);
}

function stopCountdownTimer() {
  window.clearInterval(state.countdownTimerId);
  state.countdownTimerId = 0;
}

function startCountdownTimer() {
  stopCountdownTimer();
  updateCountdownDisplay();
  if (!state.isPlaying) {
    return;
  }

  state.countdownTimerId = window.setInterval(() => {
    const remaining = getRemainingSlideshowDurationMs();
    if (countdownValue) {
      countdownValue.textContent = formatCountdown(remaining);
    }
    if (remaining <= 0) {
      stopSlideshow({ hideUiAfterStop: state.isPlayOnce });
    }
  }, 250);
}

function scheduleNextSlide() {
  window.clearTimeout(state.timerId);
  cancelAnimationFrame(state.progressFrame);
  state.progressStartedAt = performance.now();
  animateProgress();
  state.timerId = window.setTimeout(() => {
    if (state.isPlayOnce && state.currentIndex >= state.images.length - 1) {
      stopSlideshow({ hideUiAfterStop: true });
      return;
    }
    showImage(state.currentIndex + 1, 1);
  }, state.durationMs);
}

function animateProgress(now = performance.now()) {
  if (!state.isPlaying) {
    return;
  }
  const elapsed = now - state.progressStartedAt;
  const progress = Math.min(elapsed / state.durationMs, 1);
  progressBar.style.transform = `scaleX(${progress})`;
  state.progressFrame = requestAnimationFrame(animateProgress);
}

function updateStatus() {
  modeStatus.textContent = state.isPlaying
    ? `Slideshow · ${state.durationMs / 1000}s`
    : "Manuel";
}

function revealManualControls() {
  window.clearTimeout(manualControlsHideId);
  viewer.classList.remove("manual-controls-hidden");
}

function shouldKeepManualControlsVisible() {
  if (state.isPlaying) {
    return true;
  }
  return Boolean(
    isImagePickerOpen() ||
      (bottomReveal &&
        (bottomReveal.matches(":hover") || bottomReveal.matches(":focus-within"))),
  );
}

function isPointerNearBottomControls(event) {
  if (!bottomReveal) {
    return false;
  }
  const rect = bottomReveal.getBoundingClientRect();
  return event.clientY >= rect.top - 12;
}

function scheduleManualControlsHide(delay = 1000) {
  window.clearTimeout(manualControlsHideId);
  manualControlsHideId = window.setTimeout(() => {
    if (shouldKeepManualControlsVisible()) {
      scheduleManualControlsHide(delay);
      return;
    }
    viewer.classList.add("manual-controls-hidden");
    closeImagePicker(true);
    hideFilenameOverlay();
  }, delay);
}

function handleManualControlsActivity(event) {
  if (state.isPlaying) {
    return;
  }

  const pointerType = event.pointerType || "";
  const isTouchPointer =
    pointerType && pointerType !== "mouse" && pointerType !== "pen";
  if (isTouchPointer) {
    revealManualControls();
    scheduleManualControlsHide(1000);
    return;
  }

  if (isPointerNearBottomControls(event)) {
    revealManualControls();
    scheduleManualControlsHide(1000);
  }
}

function getFilenameFromPath(src) {
  if (!src || typeof src !== "string") {
    return "";
  }
  const cleanPath = src.split("?")[0].split("#")[0];
  return decodeURIComponent(cleanPath.split("/").pop() || "");
}

function getCurrentFilename() {
  const currentSrc = getCurrentBufferSource(state.visibleBuffer);
  if (currentSrc) {
    return getFilenameFromPath(currentSrc);
  }
  return getFilenameFromPath(state.images[state.currentIndex] || "");
}

function updateFilenameOverlayText() {
  if (!filenameOverlay) {
    return;
  }
  filenameOverlay.textContent = getCurrentFilename();
}

function hideFilenameOverlay() {
  window.clearTimeout(filenameHideId);
  viewer.classList.remove("is-filename-visible");
}

function showFilenameOverlayBriefly() {
  if (!filenameOverlay) {
    return;
  }
  updateFilenameOverlayText();
  if (!filenameOverlay.textContent) {
    return;
  }
  viewer.classList.add("is-filename-visible");
  window.clearTimeout(filenameHideId);
  filenameHideId = window.setTimeout(() => {
    viewer.classList.remove("is-filename-visible");
  }, 1000);
}

function pulseStatus(text) {
  const previous = modeStatus.textContent;
  modeStatus.textContent = text;
  window.setTimeout(updateStatus, previous === text ? 500 : 900);
}

function onPointerDown(event) {
  handleManualControlsActivity(event);
  if (
    isImagePickerOpen() &&
    !event.target.closest("#imagePicker") &&
    !event.target.closest("#imagePickerToggle")
  ) {
    scheduleHideImagePicker();
  }
  if (event.target.closest(".control-dock") || event.target.closest("#imagePicker")) {
    return;
  }
  showFilenameOverlayBriefly();
  revealControlsNearBottom(event);
  state.drag.active = true;
  state.drag.startX = event.clientX;
  state.drag.lastX = event.clientX;
  state.drag.startedAt = performance.now();
  state.drag.pointerId = event.pointerId;
  viewer.classList.add("is-dragging");
  state.visibleBuffer.classList.add("is-touch-preview");
  viewer.setPointerCapture(event.pointerId);
}

function onPointerMove(event) {
  updateNavigationHover(event);
  handleManualControlsActivity(event);
  revealControlsNearBottom(event);
  if (!state.drag.active || event.pointerId !== state.drag.pointerId) {
    return;
  }
  const deltaX = event.clientX - state.drag.startX;
  const resistance =
    Math.sign(deltaX) * Math.min(Math.abs(deltaX), window.innerWidth * 0.12);
  state.drag.lastX = event.clientX;
  state.visibleBuffer.style.transform = `translate3d(${resistance * 0.16}px, 0, 0) scale(1.022)`;
}

function updateNavigationHover(event) {
  if (event.pointerType !== "mouse" && event.pointerType !== "pen") {
    return;
  }

  [prevButton, nextButton].forEach((button) => {
    const rect = button.getBoundingClientRect();
    const isInside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    button.classList.toggle("is-hovering", isInside);
  });
}

function clearNavigationHover() {
  prevButton.classList.remove("is-hovering");
  nextButton.classList.remove("is-hovering");
}

function handleCursorActivity(event) {
  if (event.pointerType && event.pointerType !== "mouse") {
    return;
  }

  showFilenameOverlayBriefly();
  viewer.classList.remove("is-cursor-hidden");
  window.clearTimeout(cursorHideId);
  cursorHideId = window.setTimeout(() => {
    viewer.classList.add("is-cursor-hidden");
    clearNavigationHover();
  }, 1000);
}

function revealControlsNearBottom(event) {
  if (!state.isPlaying || !bottomReveal) {
    return;
  }

  const revealZoneTop =
    window.innerHeight - bottomReveal.getBoundingClientRect().height;
  const isInRevealZone = event.clientY >= revealZoneTop;

  if (!isInRevealZone) {
    if (!bottomReveal.matches(":hover") && !bottomReveal.matches(":focus-within")) {
      viewer.classList.remove("controls-visible");
    }
    return;
  }

  viewer.classList.add("controls-visible");
  window.clearTimeout(controlsHideId);
  controlsHideId = window.setTimeout(() => {
    if (
      !bottomReveal.matches(":hover") &&
      !bottomReveal.matches(":focus-within")
    ) {
      viewer.classList.remove("controls-visible");
    }
  }, 1800);
}

bottomReveal.addEventListener("pointerenter", () => {
  revealManualControls();
  window.clearTimeout(manualControlsHideId);
});
bottomReveal.addEventListener("pointermove", () => {
  revealManualControls();
  window.clearTimeout(manualControlsHideId);
});
bottomReveal.addEventListener("pointerleave", () => {
  viewer.classList.remove("controls-visible");
  scheduleManualControlsHide(1000);
});

function onPointerUp(event) {
  if (!state.drag.active || event.pointerId !== state.drag.pointerId) {
    return;
  }

  const deltaX = event.clientX - state.drag.startX;
  const elapsed = Math.max(performance.now() - state.drag.startedAt, 1);
  const velocity = Math.abs(deltaX / elapsed);
  const shouldNavigate = Math.abs(deltaX) > 46 || velocity > 0.55;

  state.drag.active = false;
  state.drag.pointerId = null;
  viewer.classList.remove("is-dragging");
  state.visibleBuffer.classList.remove("is-touch-preview");
  state.visibleBuffer.style.transform = getBufferTransform(state.visibleBuffer, true);

  if (shouldNavigate) {
    showImage(state.currentIndex + (deltaX < 0 ? 1 : -1), deltaX < 0 ? 1 : -1);
  }
}

function showTouchNavigationIcon(button) {
  button.classList.add("is-touching");
  window.setTimeout(() => button.classList.remove("is-touching"), 420);
}

function bindNavigationHover(button) {
  button.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });
  button.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "mouse" || event.pointerType === "pen") {
      button.classList.add("is-hovering");
    }
  });
  button.addEventListener("pointerleave", () => {
    button.classList.remove("is-hovering");
  });
}

function navigateManually(offset, direction, button, event) {
  event.preventDefault();
  event.stopPropagation();
  showTouchNavigationIcon(button);
  showImage(state.currentIndex + offset, direction);
}

function toggleImagePicker(event) {
  event.preventDefault();
  event.stopPropagation();
  if (isImagePickerOpen()) {
    closeImagePicker(true);
  } else {
    openImagePicker();
  }
}

shuffleButton.addEventListener("click", shuffleImages);
mixButton.addEventListener("click", randomMixImages);
filterButton.addEventListener("click", applyRandomFilter);
slideshowButton.addEventListener("click", toggleSlideshow);
playOnceButton.addEventListener("click", togglePlayOnce);
if (imagePickerToggle) {
  imagePickerToggle.addEventListener("click", toggleImagePicker);
}
if (imagePicker) {
  imagePicker.addEventListener("pointerenter", cancelHideImagePicker);
  imagePicker.addEventListener("pointerleave", () => scheduleHideImagePicker());
}
prevButton.addEventListener("click", (event) => {
  navigateManually(-1, -1, prevButton, event);
});
nextButton.addEventListener("click", (event) => {
  navigateManually(1, 1, nextButton, event);
});
bindNavigationHover(prevButton);
bindNavigationHover(nextButton);

durationSelect.addEventListener("change", (event) => {
  state.durationMs = Number(event.target.value) * 1000;
  updateStatus();
  if (state.isPlayOnce) {
    state.maxDurationMs = getPlayOnceDurationMs(state.isPlaying);
    if (state.isPlaying) {
      state.slideshowStartedAt = performance.now();
      scheduleAutoStop();
      startCountdownTimer();
    } else {
      updateCountdownDisplay();
    }
  }
  if (state.isPlaying) {
    scheduleNextSlide();
  }
});

maxDurationSelect.addEventListener("change", (event) => {
  state.configuredMaxDurationMs = Number(event.target.value) * 60 * 1000;
  if (state.isPlayOnce) {
    return;
  }
  state.maxDurationMs = state.configuredMaxDurationMs;
  if (state.isPlaying) {
    scheduleAutoStop();
    startCountdownTimer();
  } else {
    updateCountdownDisplay();
  }
});

viewer.addEventListener("pointerdown", onPointerDown);
viewer.addEventListener("pointermove", onPointerMove);
viewer.addEventListener("pointermove", handleCursorActivity);
viewer.addEventListener("pointerup", onPointerUp);
viewer.addEventListener("pointercancel", onPointerUp);
viewer.addEventListener("pointerenter", (event) => {
  if (event.pointerType === "mouse" || event.pointerType === "pen") {
    showFilenameOverlayBriefly();
  }
});
viewer.addEventListener("pointerleave", (event) => {
  clearNavigationHover();
  scheduleHideImagePicker();
  if (!event.pointerType || event.pointerType === "mouse" || event.pointerType === "pen") {
    hideFilenameOverlay();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && state.isPlaying) {
    window.clearTimeout(state.timerId);
    cancelAnimationFrame(state.progressFrame);
    stopCountdownTimer();
    void releaseWakeLock();
    hideFilenameOverlay();
    closeImagePicker(true);
  } else if (state.isPlaying) {
    void acquireWakeLock();
    scheduleAutoStop();
    scheduleNextSlide();
    startCountdownTimer();
  } else if (!document.hidden) {
    revealManualControls();
    scheduleManualControlsHide(1000);
  }
});

window.addEventListener("keydown", (event) => {
  if (!state.isPlaying) {
    revealManualControls();
    scheduleManualControlsHide(1000);
  }
  if (event.key === "ArrowRight") showImage(state.currentIndex + 1, 1);
  if (event.key === "ArrowLeft") showImage(state.currentIndex - 1, -1);
  if (event.key === " ") {
    event.preventDefault();
    toggleSlideshow();
  }
});

bootGallery();
updateCountdownDisplay();
