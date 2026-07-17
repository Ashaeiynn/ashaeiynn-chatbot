// Builds the app icons (widget/icon-512.png, icon-192.png) in देवालय Gold:
// the real Ashaeiynn lotus, gold-tinted with a soft glow, on the warm
// forest-black night with a fine golden ring. Run: node scripts/make-icons.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const W = path.join(ROOT, "widget");

const bgSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
  <defs>
    <radialGradient id="g" cx="50%" cy="38%" r="75%">
      <stop offset="0%" stop-color="#141d13"/>
      <stop offset="55%" stop-color="#0a110b"/>
      <stop offset="100%" stop-color="#060906"/>
    </radialGradient>
    <radialGradient id="glow" cx="50%" cy="100%" r="70%">
      <stop offset="0%" stop-color="#d9a94f" stop-opacity=".30"/>
      <stop offset="55%" stop-color="#d9a94f" stop-opacity=".08"/>
      <stop offset="100%" stop-color="#d9a94f" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="ring" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f7e3ae"/>
      <stop offset="100%" stop-color="#a97c2c"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#g)"/>
  <rect width="512" height="512" fill="url(#glow)"/>
  <circle cx="256" cy="256" r="225" fill="none" stroke="url(#ring)" stroke-width="3" opacity=".85"/>
  <circle cx="256" cy="256" r="236" fill="none" stroke="#d9a94f" stroke-width="1" opacity=".28"/>
  <circle cx="256" cy="31" r="4.5" fill="#f7e3ae" opacity=".95"/>
</svg>`);

const LOGO_W = 300; // lotus width inside the 512 canvas

// TRUE gold lotus: use the logo purely as a stencil (its alpha), filled with
// solid gold — tinting the original colors washed out to silver. The canvas
// is padded so the glow fades out INSIDE it (no clipped rectangle edges).
const PAD = 30;
const resized = await sharp(path.join(W, "logo.png"))
  .resize({ width: LOGO_W })
  .ensureAlpha()
  .extend({ top: PAD, bottom: PAD, left: PAD, right: PAD, background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer();
const meta = await sharp(resized).metadata();
const alpha = await sharp(resized).extractChannel(3).toBuffer(); // the stencil
const goldLotus = await sharp({
  create: { width: meta.width, height: meta.height, channels: 3, background: { r: 231, g: 186, b: 108 } },
})
  .joinChannel(alpha)
  .png()
  .toBuffer();

const bg = await sharp(bgSvg).png().toBuffer();
const left = Math.round((512 - meta.width) / 2);
const top = Math.round((512 - meta.height) / 2);
const glowLayer = await sharp(goldLotus).blur(9).png().toBuffer(); // soft halo, same gold

const icon512 = await sharp(bg)
  .composite([
    { input: glowLayer, left, top },
    { input: glowLayer, left, top },
    { input: goldLotus, left, top },
  ])
  .png()
  .toBuffer();

await sharp(icon512).toFile(path.join(W, "icon-512.png"));
await sharp(icon512).resize(192, 192).toFile(path.join(W, "icon-192.png"));
console.log("icons written: widget/icon-512.png, widget/icon-192.png");
