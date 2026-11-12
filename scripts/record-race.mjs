// Records the ack race the way a person meets it: aim at one row's Ack, a new incident lands, the click lands.
// Usage: node scripts/record-race.mjs <board url> [out dir]
// Writes <out>/board.webm and <out>/record.json (moments in the video, meant row, acked row, receipts).
import { chromium } from 'playwright';
import { mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const url = process.argv[2];
const out = process.argv[3] ?? 'recording';
const watchMs = Number(process.env.WATCH_MS ?? 540000);
const executablePath = process.env.BROWSER_PATH || undefined;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: out, size: { width: 1280, height: 720 } },
  locale: process.env.LOCALE ?? 'de-DE',
  timezoneId: process.env.TZ_ID ?? 'Europe/Berlin',
});
// Recorder overlay, not part of the board: a visible pointer and a caption, so a viewer sees the aim and the click.
await context.addInitScript(() => {
  addEventListener('DOMContentLoaded', () => {
    const dot = document.createElement('div');
    dot.id = '__rec_pointer';
    dot.style.cssText =
      'position:fixed;z-index:99999;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(220,0,60,.55);border:2px solid #c00;pointer-events:none;left:-50px;top:-50px;transition:transform .1s';
    const cap = document.createElement('div');
    cap.id = '__rec_caption';
    cap.style.cssText =
      'position:fixed;z-index:99999;right:16px;bottom:16px;max-width:520px;padding:8px 12px;background:#222;color:#fff;font:14px/1.4 system-ui;border-radius:6px;pointer-events:none';
    cap.textContent = 'recorder: opening the board';
    document.body.append(dot, cap);
    addEventListener('mousemove', (e) => {
      dot.style.left = `${e.clientX}px`;
      dot.style.top = `${e.clientY}px`;
    }, true);
    addEventListener('mousedown', () => (dot.style.transform = 'scale(1.8)'), true);
    addEventListener('mouseup', () => setTimeout(() => (dot.style.transform = ''), 250), true);
  });
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
const caption = (text) =>
  page.evaluate((t) => {
    const c = document.getElementById('__rec_caption');
    if (c) c.textContent = `recorder: ${t}`;
  }, text);

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
await page.locator('[data-testid="loader"]').waitFor({ state: 'detached', timeout: 30000 }).catch(() => {});
await page.locator('[data-testid="incident-row"]').first().waitFor();
const ids = () => page.locator('[data-testid="incident-row"]').evaluateAll((rs) => rs.map((r) => r.dataset.id));
const first = await ids();
mark('open-board: incidents shown', { rows: first.length, top: first[0], sha });

// Aim: the person reads the top row and moves to its Ack button.
const meant = first[0];
const box = await page.locator(`[data-testid="incident-row"][data-id="${meant}"] [data-testid="ack"]`).boundingBox();
const x = box.x + box.width / 2;
const y = box.y + box.height / 2;
await caption(`aiming at Ack on ${meant}`);
await page.mouse.move(x - 300, y + 120);
await page.mouse.move(x, y, { steps: 25 });
mark('ack-incident: pointer on Ack', { meant });

// The person waits a moment on the button; the board keeps refreshing. Click the instant a new incident lands.
const landed = await page
  .waitForFunction(
    (m) => document.querySelector('[data-testid="incident-row"]')?.dataset.id !== m,
    meant,
    { timeout: watchMs, polling: 'raf' },
  )
  .then(() => true)
  .catch(() => false);
await page.mouse.click(x, y);
const after = await ids();
mark('ack-incident: click at the same spot', { landed, newTop: after[0], meant });
await caption(`clicked where Ack on ${meant} was`);

await page.waitForTimeout(1500);
const ackedRows = await page
  .locator('[data-testid="incident-row"]:has([data-testid="acked"])')
  .evaluateAll((rs) => rs.map((r) => r.dataset.id));
mark('ack-incident: rows marked acked', { ackedRows, meant });
await caption(`meant ${meant} · acked ${ackedRows.join(', ') || 'none'}`);
await page.waitForTimeout(5000);

await context.close();
await browser.close();
const webm = readdirSync(out).find((f) => f.endsWith('.webm') && f !== 'board.webm');
if (webm) renameSync(join(out, webm), join(out, 'board.webm'));
writeFileSync(join(out, 'record.json'), JSON.stringify({ url, sha, meant, moments, acks, ackedRows }, null, 2));
console.log('saved', join(out, 'board.webm'));
