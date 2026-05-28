"use strict";

const fs = require("node:fs");
const path = require("node:path");

const imageDir = path.join(__dirname, "images");
const supportedExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".svg",
  ".avif",
]);

const images = fs
  .readdirSync(imageDir)
  .filter((file) => supportedExtensions.has(path.extname(file).toLowerCase()))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

const manifestJson = `${JSON.stringify(images, null, 2)}\n`;
const manifestJs = `const GALLERY_MANIFEST_FALLBACK = ${JSON.stringify(images, null, 2)};

function exposeGalleryManifest(files) {
  const images = Array.isArray(files) && files.length > 0
    ? files
    : GALLERY_MANIFEST_FALLBACK;
  document.documentElement.dataset.galleryImages = JSON.stringify(images);
  return images;
}

window.galleryManifestReady = fetch("images/manifest.json", { cache: "no-store" })
  .then((response) => (response.ok ? response.json() : []))
  .then(exposeGalleryManifest)
  .catch(() => exposeGalleryManifest(GALLERY_MANIFEST_FALLBACK));
`;

fs.writeFileSync(path.join(imageDir, "manifest.json"), manifestJson);
fs.writeFileSync(path.join(imageDir, "manifest.js"), manifestJs);

console.log(`Synced ${images.length} image(s).`);
