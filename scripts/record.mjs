// Records the deployed board in use: open-board, watch-board, ack-incident.
// Usage: node scripts/record.mjs <board url> [out dir]
// Writes <out>/board.webm and <out>/record.json (moments in the video, ack receipts).
import { chromium } from 'playwright';
import { mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const url = process.argv[2];
const out = process.argv[3] ?? 'recording';
const watchMs = Number(process.env.WATCH_MS ?? 30000);
const executablePath = process.env.BROWSER_PATH || undefined;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: out, size: { width: 1280, height: 720 } },
  locale: process.env.LOCALE ?? 'de-DE',
  timezoneId: process.env.TZ_ID ?? 'Europe/Berlin',
});
const page = await context.newPage();
const t0 = Date.now();
const mmss = () => {
  const s = Math.floor((Date.now() - t0) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const moments = [];
const mark = (what, extra = {}) => {
  const m = { at: mmss(), what, ...extra };
  moments.push(m);
  console.log(m.at, what, JSON.stringify(extra));
};

const acks = [];
page.on('console', (msg) => {
  const text = msg.text();
  if (text.startsWith('ack ')) {
    const [, id, ackedAt, receipt] = text.split(' ');
    acks.push({ at: mmss(), id, ackedAt, receipt });
  }
});

await page.goto(url);
mark('open-board: page opened');
const sha = await page.locator('meta[name="build"]').getAttribute('content');
await page.locator('[data-testid="loader"]').waitFor({ state: 'detached' });
const first = await page.locator('[data-testid="incident-row"]').evaluateAll((rs) => rs.map((r) => r.dataset.id));
mark('open-board: loader gone, incidents shown', { rows: first.length, top: first[0], sha });

// watch-board: leave it open, note any new incident that lands on top.
const until = Date.now() + watchMs;
let top = first[0];
while (Date.now() < until) {
  await page.waitForTimeout(1000);
  const now = await page.locator('[data-testid="incident-row"]').first().getAttribute('data-id');
  if (now !== top) {
    mark('watch-board: new incident on top', { id: now });
    top = now;
    if (process.env.STOP_ON_NEW !== '0') break;
  }
}

// ack-incident: ack the top row and wait for its acked mark.
const row = page.locator('[data-testid="incident-row"]').first();
const id = await row.getAttribute('data-id');
await row.locator('[data-testid="ack"]').hover();
await page.waitForTimeout(800);
mark('ack-incident: click Ack', { id });
await row.locator('[data-testid="ack"]').click();
await page.locator(`[data-testid="incident-row"][data-id="${id}"] [data-testid="acked"]`).waitFor();
mark('ack-incident: row marked acked', { id });
await page.waitForTimeout(6000);
mark('ack-incident: still acked after refreshes', {
  acked: await page.locator(`[data-testid="incident-row"][data-id="${id}"] [data-testid="acked"]`).count(),
});

await page.waitForTimeout(2000);
await context.close();
await browser.close();
const webm = readdirSync(out).find((f) => f.endsWith('.webm') && f !== 'board.webm');
if (webm) renameSync(join(out, webm), join(out, 'board.webm'));
writeFileSync(join(out, 'record.json'), JSON.stringify({ url, sha, moments, acks }, null, 2));
console.log('saved', join(out, 'board.webm'));
