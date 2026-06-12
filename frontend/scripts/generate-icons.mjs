import sharp from 'sharp'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = join(__dirname, '..', 'public')

// Simple white dumbbell SVG (two circles + bar)
function dumbbellSvg(size) {
  const bar = size * 0.5
  const barY = size / 2
  const barH = size * 0.06
  const barX = (size - bar) / 2
  const platW = size * 0.09
  const platH = size * 0.28
  const platY = barY - platH / 2
  const r = size * 0.11
  const cy = size / 2
  const lx = barX - r * 0.6
  const rx2 = barX + bar + r * 0.6

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

async function generate(size, filename) {
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
    .toFile(join(outDir, filename))

  console.log(`Generated ${filename} (${size}x${size})`)
}

await generate(192, 'pwa-192x192.png')
await generate(512, 'pwa-512x512.png')
await generate(180, 'apple-touch-icon.png')
console.log('Done.')
