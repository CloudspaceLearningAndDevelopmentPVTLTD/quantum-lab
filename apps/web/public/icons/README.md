# App icons

Quantum Lab ships **one** icon: `icon.svg` (512x512, `purpose: "any maskable"`).

## Why an SVG only

A single vector icon is enough for most modern installs. Chrome, Edge and Firefox on
desktop and Android all accept `image/svg+xml` manifest icons and rasterise them at
whatever size the launcher asks for, so one file covers every density with no
generation step and no risk of the PNGs drifting out of sync with the source art.

## Where an SVG is *not* enough

- **iOS / iPadOS Safari.** Safari ignores manifest icons for "Add to Home Screen" and
  uses `<link rel="apple-touch-icon">`, which must be a **PNG** (180x180 is the size
  to ship). Without one iOS renders a screenshot of the page as the icon.
- **Some Android launchers and app stores** (and older WebAPK generation paths) prefer
  or require raster icons at 192x192 and 512x512.
- **Windows/Chrome install dialogs** occasionally fall back to a raster icon.

If you care about those surfaces, generate PNGs and add them to the manifest. The
vector source stays the single source of truth — regenerate, never hand-edit.

## Generating the PNGs

### With `sharp` (no global install; run from the repo root)

```sh
npx -y sharp-cli -i apps/web/public/icons/icon.svg -o apps/web/public/icons/icon-192.png resize 192 192
npx -y sharp-cli -i apps/web/public/icons/icon.svg -o apps/web/public/icons/icon-512.png resize 512 512
npx -y sharp-cli -i apps/web/public/icons/icon.svg -o apps/web/public/icons/apple-touch-icon.png resize 180 180
```

### With ImageMagick

```sh
magick -background none apps/web/public/icons/icon.svg -resize 192x192 apps/web/public/icons/icon-192.png
magick -background none apps/web/public/icons/icon.svg -resize 512x512 apps/web/public/icons/icon-512.png
magick -background none apps/web/public/icons/icon.svg -resize 180x180 apps/web/public/icons/apple-touch-icon.png
```

(On ImageMagick 6 the command is `convert` rather than `magick`. If the SVG renders
blank, ImageMagick has no SVG delegate — install `librsvg` / `rsvg-convert`, or use
`rsvg-convert -w 512 -h 512 icon.svg -o icon-512.png` directly.)

## Manifest entries to add once the PNGs exist

Replace the single-icon `icons` array in `../manifest.webmanifest` with:

```json
"icons": [
  { "src": "/icons/icon.svg", "type": "image/svg+xml", "sizes": "any", "purpose": "any maskable" },
  { "src": "/icons/icon-192.png", "type": "image/png", "sizes": "192x192", "purpose": "any" },
  { "src": "/icons/icon-512.png", "type": "image/png", "sizes": "512x512", "purpose": "any" },
  { "src": "/icons/icon-512.png", "type": "image/png", "sizes": "512x512", "purpose": "maskable" }
]
```

Note the split: an icon declared `maskable` is assumed to have padding for the circular
crop, so declaring the *same* file as both `any` and `maskable` (as we do today for the
SVG, which is drawn with that padding) is only correct while the art keeps its 80% safe
zone. If you ever generate a tight-cropped raster, give it `purpose: "any"` only.

For iOS, also add to the document head:

```html
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
```

In Next.js that is `icons: { apple: '/icons/apple-touch-icon.png' }` inside the
`metadata` export in `apps/web/app/layout.tsx`.

## Editing the art

`icon.svg` is hand-written and commented. Keep every meaningful mark inside the central
80% safe zone (a circle of radius ~205px on the 512px canvas) — maskable icons get
cropped to a circle and anything outside that radius can be shaved off.
