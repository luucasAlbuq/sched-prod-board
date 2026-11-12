import { fetchIncidents, ack } from './api.js';

const REFRESH_MS = 2000;

const board = document.querySelector('[data-testid="board"]');
const list = document.querySelector('[data-testid="incident-list"]');
const loader = document.querySelector('[data-testid="loader"]');
const empty = document.querySelector('[data-testid="empty"]');
const status = document.querySelector('[data-testid="status"]');
const newBar = document.querySelector('[data-testid="new-bar"]');

const rows = new Map(); // incident id -> <li>
const acked = new Map(); // incident id -> ackedAt

// R5: viewer's local time, day/month in the viewer's locale order (dd/mm for EU locales).
const dateParts = new Intl.DateTimeFormat(undefined, { day: '2-digit', month: '2-digit' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
export function localTime(iso) {
  const d = new Date(iso);
  const date = dateParts
    .formatToParts(d)
    .filter((p) => p.type === 'day' || p.type === 'month')
    .map((p) => p.value)
    .join('/');
  return `${date} ${timeFmt.format(d)}`;
}

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

function markAcked(row, ackedAt) {
  row.classList.add('is-acked');
  row.querySelector('[data-testid="ack"]')?.remove();
  if (!row.querySelector('[data-testid="acked"]')) {
    row.append(el('span', { 'data-testid': 'acked', class: 'acked', title: ackedAt }, 'acked'));
  }
}

function buildRow(i) {
  const row = el('li', { 'data-testid': 'incident-row', 'data-id': i.id, class: `row ${i.severity}` });
  row.append(
    el('span', { class: 'id' }, i.id),
    el('span', { class: 'sev' }, i.severity),
    el('span', { class: 'what' }, `${i.service} · ${i.region} · ${i.summary}`),
  );
  const time = el('time', { datetime: i.openedAt, title: i.openedAt }, localTime(i.openedAt));
  row.append(time);
  if (acked.has(i.id)) {
    markAcked(row, acked.get(i.id));
  } else {
    const button = el('button', { type: 'button', 'data-testid': 'ack', class: 'ack' }, 'Ack');
    row.append(button);
  }
  return row;
}

// R2: the click acks the incident of the row it happened in, read from that row's data-id.
list.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-testid="ack"]');
  if (!button || button.disabled) return;
  const row = button.closest('[data-testid="incident-row"]');
  const id = row.dataset.id;
  button.disabled = true;
  button.textContent = 'Acking…';
  try {
    const reply = await ack(id);
    acked.set(id, reply.ackedAt);
    markAcked(row, reply.ackedAt);
  } catch (err) {
    console.error(err);
    button.disabled = false;
    button.textContent = 'Ack';
    status.textContent = `Ack failed for ${id}. Try again.`;
  }
});

// R1 (product's decision): the list holds still while it is on screen. A refresh never adds, removes or moves a
// row; new incidents wait behind the "N new" bar, and a click on the bar brings them in on top, newest first.
let latest = [];

function render(incidents) {
  const ids = new Set(incidents.map((i) => i.id));
  for (const [id, row] of rows) {
    if (!ids.has(id)) {
      row.remove();
      rows.delete(id);
    }
  }
  let prev = null;
  for (const i of incidents) {
    let row = rows.get(i.id);
    if (!row) {
      row = buildRow(i);
      rows.set(i.id, row);
    }
    const want = prev ? prev.nextSibling : list.firstChild;
    if (row !== want) list.insertBefore(row, want);
    prev = row;
  }
  empty.hidden = incidents.length > 0;
  list.hidden = incidents.length === 0;
}

function update(incidents) {
  latest = incidents;
  // Nothing on screen yet: there is no row to hold still, so show what came.
  if (rows.size === 0) {
    render(incidents);
    newBar.hidden = true;
    return;
  }
  const waiting = incidents.filter((i) => !rows.has(i.id)).length;
  newBar.hidden = waiting === 0;
  newBar.textContent = `${waiting} new incident${waiting === 1 ? '' : 's'} · show`;
}

newBar.addEventListener('click', () => {
  render(latest);
  newBar.hidden = true;
});

// R3 + R4: loader until the first answer, then refresh every 2 s while the page is open.
async function refresh() {
  try {
    const page = await fetchIncidents();
    update(page.incidents);
    loader?.remove();
    board.setAttribute('aria-busy', 'false');
    status.textContent = `Updated ${localTime(page.updatedAt)}`;
  } catch (err) {
    console.error(err);
    status.textContent = 'Could not reach the incident API. Retrying…';
  } finally {
    setTimeout(refresh, REFRESH_MS);
  }
}

refresh();
