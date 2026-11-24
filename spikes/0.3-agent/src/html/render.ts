/** DesignDoc -> standalone HTML (repo static renderer) -> PNG (headless Chromium via Playwright). */
import type { DesignDoc, DesignSystemSpec } from '@crunch/doc-model';
import { renderDocumentHtml } from '@crunch/renderer';
import { chromium, type Browser } from 'playwright';

let browser: Browser | null = null;

export async function renderDocPng(
  doc: DesignDoc,
  ds: DesignSystemSpec,
  opts: { width?: number } = {},
): Promise<{ png: Buffer; html: string }> {
  const frame = doc.frames[0]!;
  // Same as an export at the frame's own width (1280, the lg breakpoint).
  const { html } = renderDocumentHtml(doc, ds, { frameIds: [frame.id], fluid: false });
  browser ??= await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: opts.width ?? frame.width, height: 800 },
    deviceScaleFactor: 1,
  });
  await page.setContent(html, { waitUntil: 'load' });
  const png = await page.locator(`.cd-frame[data-frame="${frame.id}"]`).screenshot();
  await page.close();
  return { png, html };
}

export async function closeBrowser() {
  await browser?.close();
  browser = null;
}
