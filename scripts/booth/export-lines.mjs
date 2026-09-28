#!/usr/bin/env node
/**
 * Print the booth's line library as JSON for the Python stem renderer
 * (scripts/booth/render_stems.py). Node >= 22.6 (TypeScript type stripping).
 */
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const lib = await import(pathToFileURL(join(ROOT, 'src/render2d/broadcast/commentaryLibrary.ts')).href)
const out = lib.BOOTH_LINES.map((l) => ({
  ...l,
  slot: lib.nameSlotPosition(l.text),
  stem: lib.stemText(l),
  stemStyle: lib.stemStyle(l),
}))
process.stdout.write(JSON.stringify(out))
