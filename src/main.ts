import './style.css';
import { DEFAULT_DESIGN, type Design } from './model/design';
import { applyPreset, findFamily } from './model/presets';
import { DOUBLE_REED_DEFAULT_LENGTH, REEDS, FINGER_NAMES } from './model/derive';
import { GROUPS, type Field, type Option } from './ui/schema';
import { Viewer, type ViewMesh } from './ui/viewer';
import type { NoteRow, HoleRow } from './report';

// ---------------------------------------------------------------- state

interface Result {
  title: string;
  notes: NoteRow[];
  holes: HoleRow[];
  text: string;
  warnings: string[];
  timings: Record<string, number>;
  bodyLength: number;
  pipeLength: number;
  usePipe: boolean;
  conical: boolean;
  loops: number;
  legs: number;
  boreProfile: [number, number][];
  preview: (ViewMesh & { volume: number; size: number[]; note?: string })[];
  print: (ViewMesh & { volume: number; size: number[]; note?: string })[];
  dowels: { count: number; length: number; diameter: number } | null;
  bed: [number, number, number];
  plates: [number, number][];
}

const STORAGE_KEY = 'plastic-wind-design';

function loadInitial(): Design {
  const fromHash = decodeDesign(location.hash.slice(1));
  if (fromHash) return fromHash;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return { ...DEFAULT_DESIGN, ...JSON.parse(saved) };
  } catch {
    /* storage unavailable */
  }
  return applyPreset({ ...DEFAULT_DESIGN }, DEFAULT_DESIGN.family, DEFAULT_DESIGN.variant);
}

function encodeDesign(d: Design): string {
  const diff: Partial<Record<keyof Design, unknown>> = {};
  for (const k of Object.keys(d) as (keyof Design)[]) if (d[k] !== DEFAULT_DESIGN[k]) diff[k] = d[k];
  return btoa(unescape(encodeURIComponent(JSON.stringify(diff))));
}

function decodeDesign(s: string): Design | null {
  if (!s) return null;
  try {
    return { ...DEFAULT_DESIGN, ...JSON.parse(decodeURIComponent(escape(atob(s)))) };
  } catch {
    return null;
  }
}

let design: Design = loadInitial();
let result: Result | null = null;
let view: 'assembled' | 'print' = 'assembled';
let showAdvanced = false;

// ---------------------------------------------------------------- worker

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
let reqId = 0;
let genSeq = 0;
const pending = new Map<number, (msg: any) => void>();

worker.onmessage = (ev) => {
  const msg = ev.data;
  const cb = pending.get(msg.id);
  pending.delete(msg.id);
  cb?.(msg);
};

function request(payload: Record<string, unknown>): Promise<any> {
  const id = ++reqId;
  return new Promise((res) => {
    pending.set(id, res);
    worker.postMessage({ id, ...payload });
  });
}

let timer: number | undefined;
function scheduleGenerate() {
  clearTimeout(timer);
  timer = window.setTimeout(runGenerate, 350);
  setStatus('Working…', true);
}

async function runGenerate() {
  const mine = ++genSeq;
  const started = performance.now();
  const msg = await request({ type: 'generate', design, geometry: true });
  if (mine !== genSeq) return;
  if (msg.type === 'error') {
    setStatus('Could not build this design: ' + msg.message.split('\n')[0], false, true);
    console.error(msg.message);
    return;
  }
  result = msg.result as Result;
  setStatus(`Built in ${((performance.now() - started) / 1000).toFixed(1)} s`, false);
  renderResult();
}

// ---------------------------------------------------------------- DOM helpers

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const k of kids) e.append(k);
  return e;
};

function setStatus(text: string, busy: boolean, error = false) {
  const s = $('#status');
  s.textContent = text;
  s.classList.toggle('busy', busy);
  s.classList.toggle('error', error);
}

// ---------------------------------------------------------------- form

function optionsFor(f: Field): Option[] {
  return typeof f.options === 'function' ? f.options(design) : f.options ?? [];
}

function renderForm() {
  const host = $('#form');
  const openState = new Map<string, boolean>();
  host.querySelectorAll('details').forEach((dt) => openState.set(dt.dataset.id!, (dt as HTMLDetailsElement).open));
  host.innerHTML = '';
  for (const g of GROUPS) {
    const det = el('details', { 'data-id': g.id }) as HTMLDetailsElement;
    det.open = openState.get(g.id) ?? !!g.open;
    det.append(el('summary', {}, g.title));
    const body = el('div', { class: 'fields' });
    for (const f of g.fields) {
      if (f.show && !f.show(design)) continue;
      if (f.advanced && !showAdvanced) continue;
      body.append(fieldRow(f));
    }
    if (g.id === 'instrument') body.append(el('p', { class: 'hint family-note' }, findFamily(design.family).notes));
    det.append(body);
    host.append(det);
  }
}

function fieldRow(f: Field): HTMLElement {
  const id = `f-${f.key}`;
  const row = el('div', { class: `field ${f.type}` });
  const value = design[f.key];
  let input: HTMLInputElement | HTMLSelectElement;
  if (f.type === 'select') {
    const sel = el('select', { id }) as HTMLSelectElement;
    const opts = optionsFor(f);
    const groups = new Map<string, HTMLOptGroupElement>();
    for (const o of opts) {
      const oe = el('option', { value: o.value }, o.label) as HTMLOptionElement;
      if (o.group) {
        let og = groups.get(o.group);
        if (!og) {
          og = el('optgroup', { label: o.group }) as HTMLOptGroupElement;
          groups.set(o.group, og);
          sel.append(og);
        }
        og.append(oe);
      } else sel.append(oe);
    }
    sel.value = String(value);
    input = sel;
  } else {
    const inp = el('input', { id }) as HTMLInputElement;
    if (f.type === 'checkbox') {
      inp.type = 'checkbox';
      inp.checked = Boolean(value);
    } else if (f.type === 'number') {
      inp.type = 'number';
      inp.inputMode = 'decimal';
      if (f.step !== undefined) inp.step = String(f.step);
      if (f.min !== undefined) inp.min = String(f.min);
      if (f.max !== undefined) inp.max = String(f.max);
      inp.value = String(Math.round(Number(value) * 1000) / 1000);
    } else {
      inp.type = 'text';
      inp.value = String(value);
      inp.spellcheck = false;
    }
    input = inp;
  }
  const label = el('label', { for: id }, f.label);
  if (f.type === 'checkbox') {
    row.append(input, label);
  } else {
    const wrap = el('div', { class: 'input' }, input);
    if (f.unit) wrap.append(el('span', { class: 'unit' }, f.unit));
    row.append(label, wrap);
  }
  if (f.help) row.append(el('p', { class: 'hint' }, f.help));
  const commit = () => {
    let v: unknown;
    if (f.type === 'checkbox') v = (input as HTMLInputElement).checked;
    else if (f.type === 'number') {
      const n = parseFloat((input as HTMLInputElement).value);
      if (!Number.isFinite(n)) return;
      v = Math.min(f.max ?? Infinity, Math.max(f.min ?? -Infinity, n));
    } else v = input.value;
    update(f.key, v);
  };
  input.addEventListener('change', commit);
  if (f.type === 'number' || f.type === 'text') input.addEventListener('input', () => {
    if (f.type === 'text') return;
    commit();
  });
  return row;
}

function update(key: keyof Design, value: unknown) {
  const prev = design;
  if (key === 'family') {
    design = applyPreset(design, String(value), findFamily(String(value)).variants[0].id);
  } else if (key === 'variant') {
    design = applyPreset(design, design.family, String(value));
  } else {
    design = { ...design, [key]: value };
    if (key === 'reedSize') {
      const r = REEDS[String(value)];
      if (r) design = { ...design, tipOpening: r.tip, facingLength: r.facing };
    }
    if (key === 'doubleReedSeat') design = { ...design, reedLength: DOUBLE_REED_DEFAULT_LENGTH[String(value)] ?? design.reedLength };
  }
  // Re-render the form when visibility may have changed.
  const structural = ['family', 'variant', 'exciter', 'singleReedMode', 'doubleReedSeat', 'membraneNozzle', 'pipe', 'pipeLengthMode', 'boreType', 'matchPipeBore', 'bell', 'rangeMode', 'path', 'meander', 'foldUpper', 'split', 'dowels', 'thumbHole', 'reedSize'];
  if (structural.includes(key) || prev.family !== design.family) renderForm();
  if (key === 'family' || key === 'variant') viewer.resetFit();
  persist();
  scheduleGenerate();
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(design));
  } catch {
    /* ignore */
  }
  history.replaceState(null, '', '#' + encodeDesign(design));
}

// ---------------------------------------------------------------- results

const viewer = new Viewer($('#viewer'));
if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__pw = { viewer, get result() { return result; } };
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const applyTheme = () => viewer.setBackground(darkQuery.matches ? '#1d1f23' : '#eef0f2');
darkQuery.addEventListener('change', applyTheme);
applyTheme();

function showMeshes() {
  if (!result) return;
  viewer.show(view === 'assembled' ? result.preview : result.print, view, result.bed, result.plates);
}

const fmt = (x: number, dp = 1) => x.toFixed(dp);
const signed = (x: number, dp = 1) => (x >= 0 ? '+' : '') + x.toFixed(dp);

function renderResult() {
  if (!result) return;
  showMeshes();
  const r = result;
  const totalMass = r.print.reduce((a, p) => a + p.volume, 0) / 1000 * 1.24;
  const low = r.notes[0];
  const high = r.notes[r.notes.length - 1];
  $('#summary').innerHTML = '';
  $('#summary').append(
    stat('Range', `${low.name} – ${high.name}`),
    stat('Body bore', `${fmt(r.bodyLength, 0)} mm`),
    r.usePipe ? stat('Pipe cut length', `${fmt(r.pipeLength, 0)} mm`) : stat('Holes', String(r.holes.length)),
    stat('Parts', String(r.print.length)),
    stat('Filament', `≈ ${fmt(totalMass, 0)} g`),
  );
  const w = $('#warnings');
  w.innerHTML = '';
  for (const msg of r.warnings) w.append(el('p', {}, msg));
  renderNotes();
  renderFingering();
  renderHoles();
  renderBore();
  renderParts();
  ($('#notes-text') as HTMLPreElement).textContent = r.text;
}

/** Table header; a leading '#' marks a right-aligned numeric column. */
function head(cols: string[]) {
  return el('thead', {}, el('tr', {}, ...cols.map((h) => (h.startsWith('#') && h.length > 1 ? el('th', { class: 'num' }, h.slice(1)) : el('th', {}, h)))));
}

function stat(label: string, value: string) {
  return el('div', { class: 'stat' }, el('span', { class: 'k' }, label), el('span', { class: 'v' }, value));
}

function centsClass(c: number) {
  const a = Math.abs(c);
  return a < 3 ? 'good' : a < 15 ? 'fair' : 'bad';
}

function renderNotes() {
  const r = result!;
  const pane = $('[data-pane="notes"]');
  pane.innerHTML = '';
  const t = el('table', { class: 'grid' });
  t.append(head(['', 'Note', '#Target', '#Model', '#Error', 'Fingering', 'Overblown']));
  const tb = el('tbody');
  r.notes.forEach((n) => {
    const play = el('button', { class: 'play', title: `Play ${n.name}`, 'aria-label': `Play ${n.name}` }, '▶');
    play.addEventListener('click', () => playTone(n.target, r.conical));
    const second = n.second ? `${n.second.name} ${signed(n.second.cents, 0)}¢` : '–';
    tb.append(
      el('tr', {},
        el('td', {}, play),
        el('td', { class: 'mono strong' }, n.name),
        el('td', { class: 'num' }, `${fmt(n.target)} Hz`),
        el('td', { class: 'num' }, `${fmt(n.predicted)} Hz`),
        el('td', { class: `num ${centsClass(n.cents)}` }, `${signed(n.cents)}¢`),
        el('td', { class: 'mono dots' }, n.fingering.map((c) => (c ? '●' : '○')).join('')),
        el('td', { class: 'mono' }, second),
      ),
    );
  });
  t.append(tb);
  pane.append(
    el('p', { class: 'hint' }, `Predicted by an acoustic model of the bore and holes. “Overblown” is the next note the same fingering gives when you blow harder — ${r.conical ? 'an octave up on a conical bore' : 'a twelfth up on a cylindrical bore'}.`),
    t,
  );
}

function renderFingering() {
  const r = result!;
  const pane = $('[data-pane="fingering"]');
  pane.innerHTML = '';
  const n = r.holes.length;
  const colW = 46;
  const rowH = 30;
  const top = 34;
  const left = 70;
  const W = left + colW * r.notes.length + 10;
  const H = top + rowH * Math.max(1, n) + 40;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'fingering');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Fingering chart');
  const add = (tag: string, attrs: Record<string, string | number>, text?: string) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (text) e.textContent = text;
    svg.append(e);
    return e;
  };
  r.holes.forEach((h, k) => {
    const y = top + rowH * k + rowH / 2;
    add('text', { x: left - 10, y: y + 4, 'text-anchor': 'end', class: 'lbl' }, h.finger);
    if (h.finger === 'L3') add('line', { x1: left - 4, x2: W - 6, y1: y + rowH / 2, y2: y + rowH / 2, class: 'hand' });
  });
  r.notes.forEach((note, i) => {
    const x = left + colW * i + colW / 2;
    add('text', { x, y: 20, 'text-anchor': 'middle', class: 'note' }, note.name);
    r.holes.forEach((h, k) => {
      const back = h.face === 'back';
      const y = top + rowH * k + rowH / 2;
      const closed = note.fingering[k];
      add('circle', { cx: back ? x - 9 : x, cy: y, r: back ? 7 : 9, class: closed ? 'closed' : 'open' });
    });
    if (note.second) add('text', { x, y: H - 14, 'text-anchor': 'middle', class: 'second' }, note.second.name);
  });
  add('text', { x: left - 10, y: H - 14, 'text-anchor': 'end', class: 'lbl' }, 'over');
  pane.append(el('p', { class: 'hint' }, 'Filled = covered. Thumb holes are drawn offset to the left. Bottom row: the overblown note.'), el('div', { class: 'scroll-x' }, svg as unknown as HTMLElement));
}

function renderHoles() {
  const r = result!;
  const pane = $('[data-pane="holes"]');
  pane.innerHTML = '';
  const t = el('table', { class: 'grid' });
  t.append(head(['#', 'Finger', '#From socket', '#From bell end', '#Diameter', '#Printed', '#Wall']));
  const tb = el('tbody');
  for (const h of r.holes) {
    tb.append(
      el('tr', {},
        el('td', { class: 'mono strong' }, String(h.number)),
        el('td', {}, FINGER_NAMES[h.finger] ?? h.finger),
        el('td', { class: 'num' }, `${fmt(h.fromInlet)} mm`),
        el('td', { class: 'num' }, `${fmt(h.fromEnd)} mm`),
        el('td', { class: 'num' }, `${fmt(h.diameter)} mm`),
        el('td', { class: 'num' }, `${fmt(h.printed)} mm`),
        el('td', { class: 'num' }, `${fmt(h.chimney)} mm`),
      ),
    );
  }
  t.append(tb);
  pane.append(el('p', { class: 'hint' }, 'Distances run along the bore centre line. Hole 1 is nearest the mouthpiece.'), t);
}

function renderBore() {
  const r = result!;
  const pane = $('[data-pane="bore"]');
  pane.innerHTML = '';
  const prof = r.boreProfile;
  const L = r.bodyLength;
  const maxD = Math.max(...prof.map((p) => p[1]), ...r.holes.map((h) => h.diameter));
  const W = 760;
  const H = 180;
  const pad = 36;
  const sx = (s: number) => pad + ((W - 2 * pad) * s) / L;
  const sy = (dmm: number) => H / 2 - ((H / 2 - 24) * dmm) / 2 / (maxD / 2);
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'bore');
  const path = (pts: [number, number][], sign: number) => pts.map(([s, dd], i) => `${i ? 'L' : 'M'}${sx(s).toFixed(1)},${(H / 2 - (H / 2 - sy(dd)) * sign).toFixed(1)}`).join(' ');
  const mk = (tag: string, attrs: Record<string, string | number>, text?: string) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (text) e.textContent = text;
    svg.append(e);
  };
  mk('path', { d: `${path(prof, 1)} ${path(prof.slice().reverse(), -1).replace(/^M/, 'L')} Z`, class: 'fill' });
  for (const h of r.holes) {
    mk('line', { x1: sx(h.fromInlet), x2: sx(h.fromInlet), y1: 10, y2: H / 2, class: h.face === 'back' ? 'hole back' : 'hole' });
    mk('text', { x: sx(h.fromInlet), y: 10, 'text-anchor': 'middle', class: 'lbl' }, String(h.number));
  }
  mk('text', { x: pad, y: H - 6, class: 'lbl' }, 'socket');
  mk('text', { x: W - pad, y: H - 6, 'text-anchor': 'end', class: 'lbl' }, `bell end · ${fmt(L, 0)} mm`);
  const d0 = prof[0][1];
  const d1 = prof[prof.length - 1][1];
  pane.append(
    el('p', { class: 'hint' }, `Bore diameter ${fmt(d0)} mm at the socket, ${fmt(d1)} mm at the bell end. Vertical scale exaggerated. ${r.loops ? `${r.loops} loop(s) between holes. ` : ''}${r.legs ? `${r.legs} folded legs above the holes.` : ''}`),
    el('div', { class: 'scroll-x' }, svg as unknown as HTMLElement),
  );
}

function renderParts() {
  const r = result!;
  const pane = $('[data-pane="parts"]');
  pane.innerHTML = '';
  const t = el('table', { class: 'grid' });
  t.append(head(['Part', '#Size (mm)', '#Filament', 'Notes']));
  const tb = el('tbody');
  for (const p of r.print) {
    tb.append(
      el('tr', {},
        el('td', { class: 'strong' }, p.name),
        el('td', { class: 'num' }, p.size.map((x) => x.toFixed(0)).join(' × ')),
        el('td', { class: 'num' }, `${fmt((p.volume / 1000) * 1.24, 0)} g`),
        el('td', {}, p.note ?? ''),
      ),
    );
  }
  t.append(tb);
  const extra: HTMLElement[] = [];
  if (r.usePipe) extra.push(el('p', {}, `Cut the pipe to ${fmt(r.pipeLength)} mm.`));
  if (r.dowels?.count) extra.push(el('p', {}, `${r.dowels.count} dowels, ${r.dowels.diameter} mm, cut to ${fmt(r.dowels.length)} mm long.`));
  pane.append(el('p', { class: 'hint' }, 'Weights assume PLA at 100% infill; real prints weigh less.'), t, ...extra);
}

// ---------------------------------------------------------------- audio preview

let audio: AudioContext | null = null;
function playTone(f: number, conical: boolean) {
  audio ??= new AudioContext();
  const ctx = audio;
  const osc = ctx.createOscillator();
  const filt = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  osc.type = conical ? 'sawtooth' : 'square';
  osc.frequency.value = f;
  filt.type = 'lowpass';
  filt.frequency.value = Math.min(6000, f * 6);
  const t = ctx.currentTime;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.15, t + 0.04);
  gain.gain.setValueAtTime(0.15, t + 0.7);
  gain.gain.linearRampToValueAtTime(0, t + 0.9);
  osc.connect(filt).connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 1);
}

// ---------------------------------------------------------------- actions

function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'instrument';

$('#btn-export').addEventListener('click', async () => {
  const btn = $<HTMLButtonElement>('#btn-export');
  btn.disabled = true;
  setStatus('Writing 3MF…', true);
  const msg = await request({ type: 'export', design });
  btn.disabled = false;
  if (msg.type === 'error') {
    setStatus('Export failed: ' + msg.message.split('\n')[0], false, true);
    return;
  }
  download(`${slug(msg.title)}.3mf`, msg.bytes, 'model/3mf');
  setStatus('3MF downloaded', false);
});

$('#btn-notes').addEventListener('click', () => ($('#notes-dialog') as HTMLDialogElement).showModal());
$('#btn-notes-dl').addEventListener('click', () => result && download(`${slug(result.title)}-notes.txt`, result.text, 'text/plain'));
$('#btn-save').addEventListener('click', () => download(`${slug(result?.title ?? 'design')}.json`, JSON.stringify(design, null, 2), 'application/json'));
$('#file-load').addEventListener('change', async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  try {
    design = { ...DEFAULT_DESIGN, ...JSON.parse(await f.text()) };
    viewer.resetFit();
    renderForm();
    persist();
    scheduleGenerate();
  } catch {
    setStatus('That file is not a saved design.', false, true);
  }
});
$('#btn-share').addEventListener('click', async () => {
  persist();
  try {
    await navigator.clipboard.writeText(location.href);
    setStatus('Link copied', false);
  } catch {
    setStatus('Copy the address bar to share this design', false);
  }
});
$('#show-advanced').addEventListener('change', (e) => {
  showAdvanced = (e.target as HTMLInputElement).checked;
  renderForm();
});
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) =>
  b.addEventListener('click', () => {
    view = b.dataset.view as typeof view;
    document.querySelectorAll('[data-view]').forEach((x) => x.classList.toggle('on', x === b));
    viewer.resetFit();
    showMeshes();
  }),
);
document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll<HTMLElement>('[data-pane]').forEach((p) => p.classList.toggle('on', p.dataset.pane === b.dataset.tab));
  }),
);
$('#section').addEventListener('change', (e) => viewer.setSection((e.target as HTMLInputElement).checked));
$('#explode').addEventListener('input', (e) => viewer.setExplode(parseFloat((e.target as HTMLInputElement).value)));
$('#btn-fit').addEventListener('click', () => viewer.fit());

renderForm();
runGenerate();
