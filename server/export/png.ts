import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { renderSVG, type Theme } from '../../shared/render.js';
import type { ProjectDoc } from '../../shared/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fontDir = [path.join(here, 'assets/fonts'), path.join(here, '../assets/fonts')].find((p) => fs.existsSync(p));
const fontFiles = fontDir
  ? fs
      .readdirSync(fontDir)
      .filter((f) => f.endsWith('.ttf'))
      .map((f) => path.join(fontDir, f))
  : [];

/** Rasterises the project. Wide projects are scaled down so images stay agent-friendly. */
export function renderPNG(doc: ProjectDoc, opts: { theme?: Theme; maxWidth?: number } = {}): Buffer {
  const svg = renderSVG(doc, { theme: opts.theme, fontFamily: 'Inter' });
  const maxWidth = opts.maxWidth ?? 2000;
  const width = Number(svg.match(/width="(\d+)"/)?.[1] ?? maxWidth);
  const resvg = new Resvg(svg, {
    fitTo: width > maxWidth ? { mode: 'width', value: maxWidth } : { mode: 'zoom', value: Math.min(2, maxWidth / width) },
    font: { fontFiles, loadSystemFonts: fontFiles.length === 0, defaultFontFamily: 'Inter' },
  });
  return resvg.render().asPng();
}
