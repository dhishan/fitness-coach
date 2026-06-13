import sharp from 'sharp'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const assetsDir = join(__dirname, '..', 'assets')

// Simple white dumbbell SVG (two circles + bar) — mirrors frontend/scripts/generate-icons.mjs
function dumbbellSvg(size) {
  const bar = size * 0.5
  const barY = size / 2
  const barH = size * 0.06
  const barX = (size - bar) / 2
  const platW = size * 0.09
  const platH = size * 0.28
  const platY = barY - platH / 2

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <!-- bar -->
  <rect x="${barX}" y="${barY - barH / 2}" width="${bar}" height="${barH}" rx="${barH / 2}" fill="white"/>
  <!-- left plates -->
  <rect x="${barX - platW}" y="${platY}" width="${platW}" height="${platH}" rx="${platW * 0.3}" fill="white"/>
  <rect x="${barX - platW * 2.1}" y="${platY}" width="${platW}" height="${platH}" rx="${platW * 0.3}" fill="white"/>
  <!-- right plates -->
  <rect x="${barX + bar}" y="${platY}" width="${platW}" height="${platH}" rx="${platW * 0.3}" fill="white"/>
  <rect x="${barX + bar + platW * 1.1}" y="${platY}" width="${platW}" height="${platH}" rx="${platW * 0.3}" fill="white"/>
</svg>`)
}

async function generateSquare(size, filename) {
  const bg = await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 59, g: 130, b: 246, alpha: 1 },
    },
  })
    .png()
    .toBuffer()

  const iconSize = Math.round(size * 0.75)
  const icon = await sharp(dumbbellSvg(iconSize)).resize(iconSize).png().toBuffer()

  await sharp(bg)
    .composite([{ input: icon, gravity: 'center' }])
    .png()
    .toFile(join(assetsDir, filename))

  console.log(`Generated ${filename} (${size}x${size})`)
}

// Splash screen: 1242x2436 white background with centered icon
async function generateSplash(filename) {
  const w = 1242
  const h = 2436
  const iconSize = 512

  const bg = await sharp({
    create: {
      width: w,
      height: h,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .png()
    .toBuffer()

  const blueBg = await sharp({
    create: {
      width: iconSize,
      height: iconSize,
      channels: 4,
      background: { r: 59, g: 130, b: 246, alpha: 1 },
    },
  })
    .png()
    .toBuffer()

  const dumbbellSize = Math.round(iconSize * 0.75)
  const dumbbell = await sharp(dumbbellSvg(dumbbellSize))
    .resize(dumbbellSize)
    .png()
    .toBuffer()

  const iconComposite = await sharp(blueBg)
    .composite([{ input: dumbbell, gravity: 'center' }])
    .png()
    .toBuffer()

  await sharp(bg)
    .composite([
      {
        input: iconComposite,
        left: Math.round((w - iconSize) / 2),
        top: Math.round((h - iconSize) / 2),
      },
    ])
    .png()
    .toFile(join(assetsDir, filename))

  console.log(`Generated ${filename} (${w}x${h})`)
}

// icon.png: 1024x1024 (Expo/iOS App Store requirement)
await generateSquare(1024, 'icon.png')
// adaptive-icon.png: 1024x1024 foreground for Android adaptive icon
await generateSquare(1024, 'adaptive-icon.png')
// splash.png: 1242x2436 for Expo splash screen
await generateSplash('splash.png')

console.log('Done.')
