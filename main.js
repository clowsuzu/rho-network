'use strict';
// Rho Network: your vault as a living 3D star system. MIT licence, (c) 2026 Clowsuzu.
// Each top folder is an orbit, its notes the planets, links the lines between them; the sky reacts as you write.
// Drawn on a canvas (the asteroid belts on WebGL2 where there is one). No libraries and no network: it reads the vault
// and Obsidian's link cache, keeps its own small state (the note box's size, how often notes are opened, the sky's
// stars) in local storage and a spare copy of its settings in the vault's config folder, and writes a note only when
// you type in the note box with EDIT on.
const { Plugin, ItemView, MarkdownRenderer, Component, Menu, FuzzySuggestModal, PluginSettingTab, Setting } = require('obsidian');

let VIEW = 'rho-network', KEY = 'rho-network';
const DEFAULTS = {
  log: false, groupBy: 'auto',
  theme: 'deep', darkness: 50, ringSpacing: 100, stars: 100, glow: 100, spin: 100, intro: true, quality: 'auto', novas: 'normal', blackHole: true, exclude: [],
  ringNames: true, nearNames: false, belt2: true,
  planetSize: 100,
  links: 5, ringTilt: 100,
  planetColors: 'sand',
};
const SETTINGS = [
  { sec: 'Look' },
  { key: 'theme', name: 'Theme', desc: 'The colour of the space round the system. Paper is the light one.', choice: [['deep', 'Deep space'], ['dusk', 'Dusk'], ['ember', 'Ember'], ['paper', 'Paper']] },
  { key: 'planetColors', name: 'Planet colours', desc: 'Sand: shades of sand, lighter in the middle. Black & white: white to grey. Halloween: pumpkin, purple, blood, slime and bone, the orbit lines too. Classic: the old colours, other plugins\' on top.', choice: [['sand', 'Sand'], ['mono', 'Black & white'], ['halloween', 'Halloween'], ['rainbow', 'Classic']] },
  { key: 'darkness', name: 'Darkness', desc: 'How dark the space is: the soft light round the system and the shadow at the edges.', range: [0, 100, 5] },
  { key: 'ringSpacing', name: 'Ring spacing', desc: 'How far apart the orbits sit.', range: [70, 180, 1], unit: '%' },
  { key: 'ringTilt', name: 'Ring tilt', desc: 'How steeply the orbits tilt, every other one the other way. 100% is how they\'ve always been, 0 lays them flat.', range: [0, 400, 1], unit: '%' },
  { key: 'stars', name: 'Star density', desc: 'How many stars the sky has.', range: [25, 200, 5], unit: '%' },
  { key: 'glow', name: 'Glow', desc: 'How much the planets shine.', range: [0, 200, 10], unit: '%' },
  { key: 'links', name: 'Link lines', desc: 'How bright the lines between linked notes are. 0 hides them; the note under the mouse and the open one still show theirs.', range: [0, 100, 1], unit: '%' },
  { key: 'planetSize', name: 'Planet size', desc: 'How big the planets are. The dust of a big vault grows a little with them.', range: [30, 150, 5], unit: '%' },
  { key: 'ringNames', name: 'Ring names', desc: 'Each orbit\'s name along its ring. Off, only a ring in focus shows its name.', toggle: true, hidden: true },
  { key: 'nearNames', name: 'Names near the mouse', desc: 'Every planet near the mouse shows its name, not just your most-read ones.', toggle: true, hidden: true },
  { sec: 'Motion' },
  { key: 'spin', name: 'Spin', desc: 'How fast the system turns. 0 holds it still.', range: [0, 300, 10], unit: '%' },
  { key: 'intro', name: 'Opening', desc: 'The fly-in from the globe each time the map opens.', toggle: true, hidden: true },
  { key: 'quality', name: 'Quality', desc: 'Auto draws a little less sharply when frames run slow.', choice: [['auto', 'Auto'], ['high', 'High'], ['low', 'Low']] },
  { sec: 'Sky events' },
  { key: 'novas', name: 'Supernovas', desc: 'Now and then a star goes off somewhere in view.', choice: [['normal', 'Normal'], ['rare', 'Rare'], ['off', 'Off']] },
  { key: 'blackHole', name: 'Black hole', desc: 'The graveyard\'s hole, where deleted notes go (click it to see them), and the rare visitor.', toggle: true },
  { sec: 'Layout' },
  { key: 'groupBy', name: 'Group by', desc: 'What the rings are made of. G on the map goes to the next.', choice: [['auto', 'Auto'], ['folders', 'Folders'], ['tags', 'Tags'], ['clusters', 'Links']] },
  { key: 'belt2', name: 'Second belt', desc: 'A wider, fainter asteroid belt far out, past the outer orbits.', toggle: true },
  { key: 'exclude', name: 'Excluded folders', desc: 'One folder per line. Their notes stay off the map and out of the widgets.', list: true },
];
const settingOf = (S, key) => {
  const o = SETTINGS.find((x) => x.key === key), v = S ? S[key] : undefined, d = DEFAULTS[key];
  if (!o) return v === undefined ? d : v;
  if (o.range) return Number.isFinite(+v) && v !== null && v !== '' ? Math.max(o.range[0], Math.min(o.range[1], +v)) : d;
  if (o.choice) return o.choice.some((c) => c[0] === v) ? v : d;
  if (o.toggle) return typeof v === 'boolean' ? v : d;
  if (o.list) return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : typeof v === 'string' ? v.split('\n') : d;
  return v;
};
const SETTINGS_V = 3, MIGRATIONS = [[2, (S) => { delete S.ringTilt; }], [3, (S) => { if (S.planetColors === 'orbits') S.planetColors = 'halloween'; }]];
function migrateSettings(S) {
  const from = Number.isFinite(+S.settingsV) ? +S.settingsV : 0;
  if (from >= SETTINGS_V) return false;
  for (const [to, step] of MIGRATIONS) if (from < to) { try { step(S); } catch {   } }
  S.settingsV = SETTINGS_V;
  return true;
}
const excludeList = (S) => settingOf(S, 'exclude').map((s) => s.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')).filter(Boolean).map((s) => `${s}/`);
const LAPSE_MS = 24000;
const C = { bg: '#040405', text: '#e9e6df', text2: '#b9b6ae', muted: '#85878b', faint: '#55585e', mint: '#8fd9b6', salmon: '#e88b7a', sand: '#efe0b0', lilac: '#b8a8f0', sky: '#9cc8f0' };
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`; };
const hhmm = (t) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const ago = (t) => {
  const now = new Date(), d = new Date(t), m = (now - d) / 60000, day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(now) - day(d)) / 86400000);
  if (m < 1) return 'JUST NOW';
  if (m < 60) return `${Math.floor(m)} MIN AGO`;
  if (days === 0) return `TODAY ${hhmm(t)}`;
  if (days === 1) return `YESTERDAY ${hhmm(t)}`;
  if (days < 7) return `${days} DAYS AGO`;
  return `${d.getDate()} ${'JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' ')[d.getMonth()]}${d.getFullYear() === now.getFullYear() ? '' : ' ' + d.getFullYear()}`;
};
const firstLineOf = (s, name = '') => {
  let t = String(s || '').replace(/^﻿/, '').replace(/\r/g, '');
  if (t.startsWith('---')) { const e = t.indexOf('\n---', 3); if (e > 0) t = t.slice(t.indexOf('\n', e + 1) + 1 || t.length); }
  let fence = false;
  for (const raw of t.split('\n')) {
    if (/^\s*(```|~~~)/.test(raw) || /^\s*%%\s*$/.test(raw)) { fence = !fence; continue; }
    if (fence || /^\s*%%/.test(raw)) continue;
    const line = raw.replace(/^\s*(>\s*)*(\[![^\]]*\][+-]?\s*)?/, '').replace(/^#{1,6}\s+/, '').replace(/^([-*+]|\d+[.)])\s+(\[.\]\s+)?/, '')
      .replace(/!?\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/(\*\*|__|\*|`|~~|==)/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!/[\p{L}\p{N}]/u.test(line) || line.toLowerCase() === String(name).toLowerCase()) continue;
    return line.length > 150 ? line.slice(0, 148).replace(/\s+\S*$/, '') + '…' : line;
  }
  return '(empty)';
};
const mixHex = (a, b, k) => {
  const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16), ch = (s) => Math.round(((x >> s) & 255) * (1 - k) + ((y >> s) & 255) * k);
  return '#' + ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0');
};
const TAU = Math.PI * 2;
const BELT_VS = `#version 300 es
in vec2 q; in vec4 a; in float k;
uniform vec2 S; uniform vec3 P[4];
out vec4 vb; out vec4 vc; flat out float vr;
void main() {
  float rd = mod(k, 2.0), s = a.z;
  vec2 lo = a.xy - s * rd, hi = a.xy + s;
  vec2 p = mix(floor(lo) - 1.0, ceil(hi) + 1.0, q);
  vb = vec4(lo, hi); vr = rd; vc = vec4(P[int(k * 0.5)] * a.w, a.w);
  gl_Position = vec4(p.x / S.x * 2.0 - 1.0, 1.0 - p.y / S.y * 2.0, 0.0, 1.0);
}`;
const BELT_FS = `#version 300 es
precision highp float;
in vec4 vb; in vec4 vc; flat in float vr;
uniform vec2 S;
out vec4 o;
void main() {
  vec2 f = vec2(gl_FragCoord.x, S.y - gl_FragCoord.y);
  float cov;
  if (vr > 0.5) cov = clamp((vb.z - vb.x) * 0.5 - length(f - (vb.xy + vb.zw) * 0.5) + 0.5, 0.0, 1.0);
  else { vec2 e = max(min(f + 0.5, vb.zw) - max(f - 0.5, vb.xy), 0.0); cov = e.x * e.y; }
  if (cov <= 0.0) discard;
  o = vc * cov;
}`;
const hex3 = (h) => (/^#[0-9a-f]{6}$/i.test(h) ? ((n) => [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255])(parseInt(h.slice(1), 16)) : null);
const SHIFT = 118;
const SKY_PX = 90;
const SKY_STEPS = 3, SKY_MS = 6, SKY_FADE_MS = 1200, SKY_SLICE = 1500;
const SPIN = 0.000066;
const RING_SPIN = [0.5, 0.9, -1.7, 0.35, 1.3, -2.1, 0.7, -1.5, 1.1, 0.2];
const BELT_SPIN = -1.6;
const NEBULA_MS = 20 * 60000;
const DISPERSE_MS = 8 * 60000;
const VISIT_GAP = 18 * 3600000, VISIT_SPREAD = 12 * 3600000;
const DUST_MS = 24 * 3600000, DUST_MAX = 3, DUST_A = 0.05;
const WAVE_DELAY = 9000, WAVE_SPEED = 0.35;
const GRAVE = 'rn:graveyard';
const BAND_TILT = -0.49;
const BAND_W = 0.115;
const holeSize = (dead) => Math.min(22, Math.round(5 + 0.3 * dead));
const ROCKET_MIN = 900, ROCKET_MAX = 3200, ROCKET_LAG = 0.2, TYPED_MS = 5000;
const FLOOD_N = 10, FLOOD_MS = 2000, FLOOD_QUIET = 1600, WAVE_MS = 3600, WAVE_N = 900, MASS_N = 8, HOLD_MS = 500, MOVE_MS = 2000;
const smooth01 = (k) => { k = Math.max(0, Math.min(1, k)); return k * k * (3 - 2 * k); };
const TWIN_P = 0.06;
const BELT_OUT = 1.8, OUTER_GAP = 0.26;
const RING_W = 1.8, CORE = 1.3 * RING_W, REACH = 2.6, BAND_CORE = CORE / REACH, BAND_H = 2 / (1 + BAND_CORE);
const SPECK = 2;
const bandAt = (b) => {
  const m = Math.abs(b), s = b < 0 ? -1 : 1;
  if (m <= BAND_H * BAND_CORE) return (s * m) / BAND_H;
  return s * (BAND_CORE + (1 - BAND_CORE) * (1 - Math.sqrt(Math.max(0, 1 - (2 * (m - BAND_H * BAND_CORE)) / (BAND_H * (1 - BAND_CORE))))));
};
const OUTER_SLOTS = 7, BELT2_W = 0.82;
const INNER_MAX = 6, MID_MAX = 5;
const INTRO_MS = 8000, REST_PITCH = 0.3, ZOOM_MIN = 0.02, LAND_OUT = 0.65;
const SETTLE_MS = 40000;
const LENS_TE = 3.4, LENS_R = 4;
const GRAVE_TE = 1.15, GRAVE_R = 6;
const INTRO_ZOOM = 1;
const WAVE_AMP = 6;
const LIFT_R = 0.75;
const SIZE_HOLD = 160;
const MORPH_MS = 900, MORPH_NUM = ['rmax', 'outerMax', 'outerIn', 'grow', 'spr'], MORPH_EXT = ['ext', 'extAll', 'extLand', 'extCore'];
const GLOBE_R = 256;
const liftAt = (d, th = THEMES.deep, k = 1) => { const f = Math.exp(-((d / 0.5) ** 2)), c = Math.exp(-((d / 0.42) ** 2)), L = th.lift; return [L[0] + L[3] * c, L[1] + L[4] * c, L[2] + L[5] * c, d >= 1 ? 0 : Math.min(1, 0.41 * f * k)]; };
const paperLum = (dk) => +(0.95 - Math.max(0, Math.min(100, +dk || 0)) / 1000).toFixed(3);
const THEMES = {
  deep: { bg: '#040405', lift: [17, 20, 25, 11, 12, 15], vig: [4, 4, 5] },
  dusk: { bg: '#060409', lift: [22, 17, 32, 15, 10, 22], vig: [6, 4, 9] },
  ember: { bg: '#080505', lift: [30, 18, 14, 17, 9, 6], vig: [8, 5, 5] },
  paper: { bg: '#060606', lift: [0, 0, 0, 0, 0, 0], vig: [6, 6, 6], edge: [0.03, 0.42], edgeCol: [20, 20, 20], ink: true, flash: '#a5a5a5' },
};
const PAPER = { stars: 0.5, glow: 0.3, band: '#b4b4b4', bandK: 2, dot: 0.92, ring: 0.35, shine: 1.4, speck: '#7e7e7e', speckLo: '#4a4a4a', grain: 0.95,
  curve: 1.6, soft: 4, wash: 0.2, bandStars: 900, orbit: 2.2, inkA: 50, inkK: 2, extra: 170, clear: 0.7 };
const INK = { [C.mint]: '#3e3e3e', [C.sky]: '#2c2c2c', [C.sand]: '#626262', [C.lilac]: '#1a1a1a', [C.salmon]: '#505050', [C.text]: '#080808' };
const unmirror = (hex) => {
  const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const ch = (v) => Math.max(0, Math.min(255, Math.round(255 - v)));
  return '#' + ((ch(-0.574 * r + 1.43 * g + 0.144 * b) << 16) | (ch(0.426 * r + 0.43 * g + 0.144 * b) << 8) | ch(0.426 * r + 1.43 * g - 0.856 * b)).toString(16).padStart(6, '0');
};
const inkMemo = new Map();
const inkOf = (hex) => {
  let v = inkMemo.get(hex);
  if (!v) { v = unmirror(INK[hex] || mixHex(mixHex(hex, '#000000', 0.45), INK[C.text], 0.35)); inkMemo.set(hex, v); }
  return v;
};

function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }
function rotX(p, a) { const c = Math.cos(a), s = Math.sin(a); return { x: p.x, y: p.y * c - p.z * s, z: p.y * s + p.z * c }; }
function rotY(p, a) { const c = Math.cos(a), s = Math.sin(a); return { x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c }; }
function viewExtent(rings, rmax, om, dm = 1) {
  const D = Math.max(3400, 1.7 * Math.max(1.8 * rmax, om || 0)) * dm, cp = Math.cos(REST_PITCH), sp = Math.sin(REST_PITCH);
  const loops = rings.filter((r) => !r.fresh).map((r) => [r.radius + 0.9 * RING_W * (r.spread || 40), (r.inclFit !== undefined ? r.inclFit : r.incl) || 0, r.asc || 0, 0.6 * Math.min(r.spread || 40, 96 + 0.02 * r.radius)]);
  if (om) loops.push([om, 0.05, 1.3, 0]);
  const e = { x: 1, up: 1, down: 1 };
  for (const [R, incl, asc, h] of loops) {
    const ci = Math.cos(incl), si = Math.sin(incl), ca = Math.cos(asc), sa = Math.sin(asc);
    for (let j = 0; j < 48; j++) {
      const lx = Math.cos((j / 48) * TAU) * R, lz = Math.sin((j / 48) * TAU) * R;
      for (const ly of [-h, h]) {
        const y = ly * ci - lz * si, z1 = ly * si + lz * ci, x = lx * ca + z1 * sa, z = -lx * sa + z1 * ca;
        for (let k = 0; k < 24; k++) {
          const cy = Math.cos((k / 24) * TAU), sy = Math.sin((k / 24) * TAU), x2 = x * cy + z * sy, z2 = -x * sy + z * cy;
          const y3 = y * cp - z2 * sp, s = D / (D + y * sp + z2 * cp);
          if (Math.abs(x2 * s) > e.x) e.x = Math.abs(x2 * s);
          if (-y3 * s > e.up) e.up = -y3 * s;
          if (y3 * s > e.down) e.down = y3 * s;
        }
      }
    }
  }
  return e;
}
const PALETTE = [C.mint, C.sky, C.sand, C.lilac, C.salmon];
const SAND = ['#f6ecca', C.sand, '#e4d19c', '#d8c289', '#cbb27a'];
const MONO = ['#f2f2f2', '#9a9a9a', '#d4d4d4', '#7e7e7e', '#b8b8b8'];
const HALLOWEEN = ['#f28a2e', '#9b6ddc', '#c9463d', '#8fd14f', '#ece2c8'];
const PRESETS = { sand: SAND, mono: MONO, halloween: HALLOWEEN };
for (const P of [SAND, MONO, HALLOWEEN]) P.forEach((c, i) => { if (!INK[c]) INK[c] = ['#3e3e3e', '#626262', '#2c2c2c', '#1a1a1a', '#505050'][i % 5]; });
function tint(path) {
  if (!path.includes('/')) return C.text;
  return PALETTE[Math.floor(hash(path.split('/')[0]) * PALETTE.length)];
}
function findHub(paths, links, vaultName) {
  if (paths.includes(`${vaultName}.md`)) return `${vaultName}.md`;
  const inbound = new Map();
  for (const targets of Object.values(links || {})) for (const t of Object.keys(targets)) inbound.set(t, (inbound.get(t) || 0) + 1);
  const roots = paths.filter((p) => !p.includes('/')).sort((a, b) => (inbound.get(b) || 0) - (inbound.get(a) || 0));
  return roots.length && (inbound.get(roots[0]) || 0) > 0 ? roots[0] : null;
}
const bell = (s) => (hash(s + 'a') + hash(s + 'b') + hash(s + 'c') - 1.5) / 1.5;
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function noise2(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, s = (t) => t * t * (3 - 2 * t);
  const h = (i, j) => { let n = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 1442695041); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1), u = s(xf), v = s(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, y, seed) => noise2(x, y, seed) * 0.5 + noise2(x * 2.1, y * 2.1, seed + 1) * 0.3 + noise2(x * 4.3, y * 4.3, seed + 2) * 0.2;

const COLL = new Intl.Collator();
const byName = (a, b) => COLL.compare(a, b);
const byNear = (a, b) => a.pn - b.pn;
const baseName = (p) => p.slice(p.lastIndexOf('/') + 1).replace(/\.md$/, '');
const WIDGET_MS = 1200;
const WIDGETS = {
  recent: { name: 'Recent edits', icon: 'history' },
  spark: { name: 'Activity', icon: 'activity' },
  tasks: { name: 'Open tasks', icon: 'list-checks' },
  inbox: { name: 'Inbox', icon: 'inbox' },
  today: { name: 'On this day', icon: 'calendar' },
  opened: { name: 'Most opened', icon: 'eye' },
  stats: { name: 'Vault stats', icon: 'info' },
  loose: { name: 'Orphans and broken links', icon: 'unlink' },
  note: { name: 'A note…', icon: 'file-text', many: true },
  folder: { name: 'A folder or tag…', icon: 'folder', many: true },
};
const WIDGET_DEFAULT = [{ id: 'w:recent', type: 'recent', n: 5 }, { id: 'w:spark', type: 'spark', span: '14d' }, { id: 'w:stats', type: 'stats' }];
const SPANS = {
  '24h': { label: '24 hours', n: 24, ms: 36e5, foot: '24 hours · by last edit' },
  '14d': { label: '14 days', n: 14, ms: 864e5, foot: '14 days · by last edit' },
  '90d': { label: '90 days', n: 45, ms: 1728e5, foot: '90 days · by last edit' },
};
const MONTHS = 'JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' ');
const agoShort = (t, now = Date.now()) => {
  const s = Math.max(0, now - t) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  const d = Math.floor(s / 86400);
  if (d < 14) return `${d}d`;
  if (d < 60) return `${Math.floor(d / 7)}w`;
  if (d < 365) return `${Math.floor(d / 30.44)}mo`;
  return `${Math.floor(d / 365.25)}y`;
};
const topBy = (items, n, key) => {
  const top = [], ks = [];
  if (!(n > 0)) return top;
  for (const x of items) {
    const k = key(x);
    if (!(k > -Infinity)) continue;
    if (top.length === n && k <= ks[n - 1]) continue;
    let i = top.length === n ? n - 1 : top.length;
    while (i > 0 && ks[i - 1] < k) { top[i] = top[i - 1]; ks[i] = ks[i - 1]; i--; }
    top[i] = x; ks[i] = k;
  }
  return top;
};
const sparkBuckets = (items, key, n, ms, end) => {
  const out = new Array(n).fill(0), start = end - n * ms;
  for (const x of items) { const t = key(x); if (t >= start && t < end) out[Math.floor((t - start) / ms)]++; }
  return out;
};
const foldersOf = (paths) => {
  const s = new Set();
  for (const p of paths) for (let i = p.indexOf('/'); i > 0; i = p.indexOf('/', i + 1)) s.add(p.slice(0, i));
  return s;
};
let Picker = null;
function openPicker(app, items, text, placeholder, done) {
  if (!Picker) Picker = class extends FuzzySuggestModal {
    constructor(a, o) { super(a); this.o = o; if (this.setPlaceholder) this.setPlaceholder(o.placeholder); }
    getItems() { return this.o.items; }
    getItemText(x) { return this.o.text(x); }
    onChooseItem(x) { this.o.done(x); }
  };
  const m = new Picker(app, { items, text, placeholder, done });
  m.open();
  return m;
}
const PLANET_ALL = 2500, PLANET_SUM = 1500, PLANET_MIN = 30, PLANET_FOCUS = 400, RING_CAP = 12, BIG_EDGES = 6000;
const GROUP_MODES = ['auto', 'folders', 'tags', 'clusters'];
function groupNotes(members, o = {}) {
  const prefix = o.prefix || '', tagp = o.tagp || '', hub = o.hub || null, cap = o.cap || RING_CAP;
  const list = members.filter((p) => p !== hub);
  const folders = () => {
    const g = new Map(), child = new Map();
    for (const p of list) {
      const rest = p.startsWith(prefix) ? p.slice(prefix.length) : p, i = rest.indexOf('/'), k = i < 0 ? '' : rest.slice(0, i);
      g.set(p, k);
      if (k && !child.has(k)) child.set(k, { kind: 'folder', name: k, prefix: prefix + k + '/', tagp });
    }
    return { mode: 'folders', groupOf: g, child };
  };
  const tags = () => {
    if (!o.tagsOf) return null;
    const segs = new Map(), freq = new Map();
    let tagged = 0;
    for (const p of list) {
      let s = null;
      for (const t of o.tagsOf(p) || []) {
        if (t.length <= tagp.length || !t.startsWith(tagp)) continue;
        const r = t.slice(tagp.length), i = r.indexOf('/'), seg = i < 0 ? r : r.slice(0, i);
        if (seg && !(s && s.includes(seg))) (s || (s = [])).push(seg);
      }
      if (s) { tagged++; segs.set(p, s); for (const x of s) freq.set(x, (freq.get(x) || 0) + 1); }
    }
    const g = new Map(), child = new Map(), restKey = tagp ? '' : 'UNTAGGED', loose = new Set();
    for (const p of list) {
      const s = segs.get(p);
      if (!s) { g.set(p, restKey); if (restKey) loose.add(p); continue; }
      let best = s[0];
      for (const x of s) { const d = freq.get(x) - freq.get(best); if (d > 0 || (d === 0 && byName(x, best) < 0)) best = x; }
      const k = '#' + best; g.set(p, k);
      if (!child.has(k)) child.set(k, { kind: 'tag', name: k, tag: tagp + best, prefix, tagp: tagp + best + '/' });
    }
    if (loose.size) child.set(restKey, { kind: 'set', name: restKey, set: loose, prefix, tagp });
    return { mode: 'tags', groupOf: g, child, tagged };
  };
  const clusters = () => {
    if (!o.nbrs) return null;
    const L = [...list].sort(byName), N = L.length, idx = new Map(L.map((p, i) => [p, i]));
    const deg = new Int32Array(N), nb = new Array(N);
    let E = 0;
    for (let i = 0; i < N; i++) {
      const out = [];
      for (const q of o.nbrs(L[i]) || []) { const j = idx.get(q); if (j !== undefined && j !== i) out.push(j); }
      nb[i] = out; deg[i] = out.length; E += out.length;
    }
    const st = new Int32Array(N + 1), to = new Int32Array(E), wt = new Float64Array(N), lab = new Int32Array(N), acc = new Float64Array(N), seen = [];
    for (let i = 0; i < N; i++) { st[i + 1] = st[i] + deg[i]; to.set(nb[i], st[i]); wt[i] = 1 / Math.sqrt(deg[i] || 1); lab[i] = i; }
    for (let round = 0; round < 12; round++) {
      let moved = 0;
      for (let i = 0; i < N; i++) {
        if (!deg[i]) continue;
        for (let e = st[i]; e < st[i + 1]; e++) { const j = to[e], l = lab[j]; if (!acc[l]) seen.push(l); acc[l] += wt[j]; }
        let best = lab[i], bw = acc[best] || 0;
        for (const l of seen) { const w = acc[l]; if (w > bw + 1e-9 || (Math.abs(w - bw) <= 1e-9 && l < best)) { best = l; bw = w; } }
        for (const l of seen) acc[l] = 0;
        seen.length = 0;
        if (best !== lab[i]) { lab[i] = best; moved++; }
      }
      if (!moved) break;
    }
    const size = new Map(), top = new Map();
    for (let i = 0; i < N; i++) { const l = lab[i]; size.set(l, (size.get(l) || 0) + 1); const b = top.get(l); if (b === undefined || deg[i] > deg[b]) top.set(l, i); }
    const keep = [...size].filter((x) => x[1] >= 3).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, cap - 1);
    const name = new Map(), used = new Set(['loose', '']);
    for (const [l] of keep) {
      const nm0 = baseName(L[top.get(l)]) || 'cluster';
      let nm = nm0, k = 2; while (used.has(nm.toLowerCase())) nm = `${nm0} ${k++}`;
      used.add(nm.toLowerCase()); name.set(l, nm);
    }
    const g = new Map(), sets = new Map();
    for (let i = 0; i < N; i++) { const k = name.get(lab[i]) || 'LOOSE'; g.set(L[i], k); let s = sets.get(k); if (!s) sets.set(k, (s = new Set())); s.add(L[i]); }
    const child = new Map([...sets].map(([k, s]) => [k, { kind: 'set', name: k, set: s, prefix, tagp }]));
    return { mode: 'clusters', groupOf: g, child, links: E / 2 };
  };
  const count = (r) => { const c = new Map(); if (r) for (const k of r.groupOf.values()) c.set(k, (c.get(k) || 0) + 1); return c; };
  const rings = (r) => { const c = count(r); c.delete(''); return c.size; };
  const mode = GROUP_MODES.includes(o.mode) ? o.mode : 'auto';
  let r = null;
  if (mode === 'auto') {
    const f = folders(), most = Math.max(0, ...count(f).values());
    if (rings(f) >= 2 && most <= 0.85 * list.length) r = f;
    else {
      const t = tags();
      if (t && t.tagged >= 0.3 * list.length && rings(t) >= 3) r = t;
      else { const c = list.length >= 40 ? clusters() : null; r = c && c.links >= 20 && rings(c) >= 2 ? c : f; }
    }
    r.auto = true;
  } else {
    for (const fn of { folders: [folders, clusters], tags: [tags, folders, clusters], clusters: [clusters, folders] }[mode]) { const x = fn(); if (x && rings(x) >= 2) { r = x; break; } }
    if (!r) r = folders();
  }
  const pinned = new Set(o.keep || []), c = count(r); c.delete('');
  for (const k of pinned) c.delete(k);
  if (c.size > cap) {
    const keep = new Set([...c].sort((a, b) => b[1] - a[1] || byName(a[0], b[0])).slice(0, cap - 1).map((x) => x[0]).concat([...pinned]));
    const more = `+${c.size - keep.size} MORE`, set = new Set();
    for (const [p, k] of r.groupOf) if (k && !keep.has(k)) { r.groupOf.set(p, more); set.add(p); }
    for (const k of [...r.child.keys()]) if (!keep.has(k)) r.child.delete(k);
    r.child.set(more, { kind: 'set', name: more, set, prefix, tagp, more: true });
  }
  r.groups = Math.min(cap, c.size);
  return r;
}
function inScope(s, p, tagsOf) {
  if (!s || s.kind === 'root') return true;
  if (s.kind === 'folder') return p.startsWith(s.prefix);
  if (s.kind === 'set') return s.set.has(p);
  if (s.kind === 'tag') { const T = s.tag, T2 = T + '/'; for (const t of (tagsOf && tagsOf(p)) || []) if (t === T || t.startsWith(T2)) return true; return false; }
  return true;
}
function scopeHub(scope, members, inbound) {
  const nm = String(scope.name || '').replace(/^#/, '').toLowerCase();
  if (!nm || !members.length) return null;
  const own = `${scope.prefix || ''}${scope.name}.md`;
  let named = null;
  for (const p of members) { if (p === own) return p; if (!named && baseName(p).toLowerCase() === nm) named = p; }
  if (named) return named;
  let best = null, bc = 0;
  for (const p of members) {
    if (scope.kind === 'folder' && p.indexOf('/', scope.prefix.length) >= 0) continue;
    const c = (inbound && inbound.get(p)) || 0;
    if (c > bc || (c && c === bc && byName(p, best) < 0)) { bc = c; best = p; }
  }
  return best;
}
const planetScore = (gdeg, age, views) => Math.log2(1 + gdeg) + 1.5 * Math.exp(-Math.max(0, age) / 1.2096e9) + 1.2 * Math.log2(1 + (views || 0));
function layout(paths, hub = null, opts = {}) {
  const pathSet = new Set(paths), outerSet = new Set(opts.outer || []), fresh = (opts.fresh || []).filter((p) => p !== hub && pathSet.has(p)), freshSet = new Set(fresh);
  const G = opts.groupOf, M = opts.memo, C2 = opts.cache;
  if (M && M.size > 4 * paths.length + 5000) M.clear();
  if (C2 && C2.size > 96) C2.clear();
  const B3 = (p) => { let b = M && M.get(p); if (!b) { b = [bell(p + 't'), bell(p + 'r'), bell(p + 'y'), (hash(p) * 4294967296) >>> 0]; if (M) M.set(p, b); } return b; };
  const groups = new Map();
  for (const p of paths) {
    if (freshSet.has(p)) continue;
    const top = G ? (p === hub ? '' : G.get(p) || '') : p.includes('/') ? p.slice(0, p.indexOf('/')) : '';
    let g = groups.get(top); if (!g) groups.set(top, (g = [])); g.push(p);
  }
  const bySize = (a, b) => groups.get(a).length - groups.get(b).length || byName(a, b);
  const tops = [...groups.keys()].filter((k) => k && !outerSet.has(k)).sort(bySize);
  const loose0 = (groups.get('') || []).some((p) => p !== hub), room = INNER_MAX - (loose0 ? 1 : 0);
  const NG0 = tops.length >= 6 ? 2 : tops.length >= 3 ? 1 : 0, NG = opts.giants === false ? 0 : Math.max(NG0, tops.length - room);
  const folders = tops.slice(0, tops.length - NG), giants = new Set(tops.slice(tops.length - NG));
  const band = (n) => 34 + 8 * Math.sqrt(n);
  const n0 = (groups.get('') || []).length, loose = (groups.get('') || []).filter((p) => p !== hub).length;
  const sp = opts.spacing || 1;
  const orbits = (c, e, sp = opts.spacing || 1) => {
    const LANE = (a, b) => (c + 0.35) * (a + b) + 80, CLEAR = (b) => (e + 0.35) * b + 80;
    const out = [Math.max(180, GLOBE_R + CLEAR(band(loose)))];
    folders.forEach((name, i) => {
      const count = groups.get(name).length, pc = i ? groups.get(folders[i - 1]).length : n0;
      const from = i || loose ? out[i] + LANE(band(pc), band(count)) * sp : GLOBE_R + CLEAR(band(count)) * sp;
      out.push(Math.max(180 + (70 + i * 118) * sp, from));
    });
    const first = loose ? 0 : 1, last0 = out[out.length - 1], fr = NG ? 0.2 : 0.12;
    if (out.length > first + 1) { const d = Math.max(0, (fr * last0 - out[first]) / (1 - fr)); for (let i = first; i < out.length; i++) out[i] += d; }
    return out;
  };
  const R1 = orbits(CORE, REACH), R0 = orbits(1.3, 1.3, 1), R1u = sp === 1 ? R1 : orbits(CORE, REACH, 1);
  const tf = opts.tilt === undefined ? 1 : opts.tilt, ti = (a) => ({ incl: a * tf, inclFit: a });
  const rings = [{ name: '', count: n0, radius: R1[0], ...ti(0.1), asc: 0 }];
  folders.forEach((name, i) => {
    const radius = R1[i + 1];
    rings.push({ name, count: groups.get(name).length, radius, ...ti((i % 2 ? 1 : -1) * Math.min(0.06 + 0.028 * i, 0.06 + 400 / radius)), asc: 0.4 + i * 1.07 });
  });
  rings.forEach((ring, i) => { ring.w = RING_SPIN[i % RING_SPIN.length] * SPIN; });
  const nodes = [];
  const place = (ring, ri) => {
    const raw = groups.get(ring.name) || [], hasHub = !!hub && raw.includes(hub), n = raw.length - (hasHub ? 1 : 0);
    if (hasHub) nodes.push({ path: hub, ring: -1, th: 0, l: null, x: 0, y: 0, z: 0, fresh: false });
    const spread = 34 + 8 * Math.sqrt(n);
    ring.spread = spread;
    if (opts.fitOnly) return;
    let key = null, tpl = null;
    if (C2) {
      let sx = 0, ss = 0;
      for (const p of raw) if (p !== hub) { const h = B3(p)[3]; sx ^= h; ss = (ss + h) >>> 0; }
      key = `${ring.name}\u0001${ring.radius}\u0001${ring.incl}\u0001${ring.asc}\u0001${n}\u0001${sx}\u0001${ss}`;
      tpl = C2.get(key);
    }
    if (!tpl) {
      const others = raw.filter((p) => p !== hub).sort(byName);
      const ci = Math.cos(ring.incl), si = Math.sin(ring.incl), ca = Math.cos(ring.asc), sa = Math.sin(ring.asc);
      tpl = others.map((p, j) => {
        const b = B3(p), th = (j / Math.max(1, n)) * Math.PI * 2 + b[0] * 0.3, r = ring.radius + bandAt(b[1]) * spread * REACH;
        const l = { x: Math.cos(th) * r, y: b[2] * Math.min(spread, 96 + 0.02 * ring.radius) * 1.15, z: Math.sin(th) * r };
        const y1 = l.y * ci - l.z * si, z1 = l.y * si + l.z * ci;
        return { path: p, th, l, x: l.x * ca + z1 * sa, y: y1, z: -l.x * sa + z1 * ca };
      });
      if (C2) C2.set(key, tpl);
    }
    for (const o of tpl) nodes.push({ path: o.path, ring: ri, th: o.th, l: o.l, x: o.x, y: o.y, z: o.z, fresh: false });
  };
  rings.forEach(place);
  const last = rings[rings.length - 1], tail = 50 + 10 * Math.sqrt(last.count || 1), rmax = last.radius + RING_W * tail;
  const rmax1 = R1u[R1u.length - 1] + RING_W * tail, spr = rmax / rmax1;
  const grow = Math.max(1, rmax1 / (R0[R0.length - 1] + tail)) * spr;
  const line = 2 * REACH * (34 + 8 * Math.sqrt(10)) + 0.12 * rmax, start = (BELT_OUT + OUTER_GAP) * rmax;
  const outs = [...outerSet].filter((k) => groups.has(k)).concat([...giants]).sort(bySize), capped = NG > NG0 || outs.length > MID_MAX;
  const lane = (name) => (giants.has(name) && !capped ? 0.3 : 0.12) * rmax * sp;
  let need = capped ? start + 0.12 * rmax * sp : 0;
  if (capped) outs.slice(0, MID_MAX).forEach((name, j, a) => { need += 2 * REACH * band(groups.get(name).length) + (j < a.length - 1 ? lane(name) : 0); });
  const b2in = Math.max(start + OUTER_SLOTS * line, need);
  const b2 = opts.belt2 ? { in: b2in, out: b2in + BELT2_W * rmax, c: b2in / rmax + BELT2_W / 2 } : null;
  let edge = start, outerMax = 0, outerNear = 0;
  outs.forEach((name, j) => {
    const count = groups.get(name).length, spread = 34 + 8 * Math.sqrt(count);
    if (b2 && j >= MID_MAX) edge = Math.max(edge, b2.out + 0.12 * rmax);
    if (b2 && edge + spread * 2 * REACH > b2.in) edge = Math.max(edge, b2.out + 0.12 * rmax);
    const radius = edge + spread * REACH;
    const ring = { name, count, radius, ...ti((j % 2 ? -1 : 1) * Math.min(0.08 + 0.03 * j, 0.03 + 400 / radius)), asc: 2.1 + j * 1.9, outer: true, giant: giants.has(name), far: j >= MID_MAX };
    ring.w = 0.35 * RING_SPIN[(rings.length + 3) % RING_SPIN.length] * SPIN;
    rings.push(ring); place(ring, rings.length - 1);
    edge = ring.radius + spread * REACH + lane(name); outerMax = ring.radius + spread * REACH;
    if (!ring.far) outerNear = outerMax;
  });
  if (fresh.length) {
    const ring = { name: '', count: fresh.length, radius: edge + 40, ...ti(0.05), asc: 1.3, fresh: true, w: 0.25 * SPIN, spread: 40 };
    rings.push(ring);
    const ri = rings.length - 1, hop = b2 ? Math.min(b2.out - b2.in + 0.12 * rmax + 40, Math.max(0, b2.out + 0.12 * rmax - ring.radius)) : 0;
    fresh.forEach((p, k) => {
      const b = B3(p);
      let r = ring.radius + 34 * Math.sqrt(k) + b[1] * 16;
      if (hop && r + 40 > b2.in) r += hop;
      const th = k * 2.39996 + b[0] * 0.25, l = { x: Math.cos(th) * r, y: b[2] * 34, z: Math.sin(th) * r };
      const q = rotY(rotX(l, ring.incl), ring.asc);
      nodes.push({ path: p, ring: ri, th, l, x: q.x, y: q.y, z: q.z, fresh: true });
      outerMax = Math.max(outerMax, r + 20);
    });
  }
  const outerIn = outs.length > MID_MAX ? outerNear : outerMax;
  if (b2) outerMax = Math.max(outerMax, b2.out);
  return { nodes, rings, rmax, outerMax, outerIn, belt2: b2, grow, spr, capped };
}

function makeBelt(R, c, nb, ns) {
  const B = () => (R() + R() + R() - 1.5) / 1.5, w0 = -BELT_SPIN * SPIN;
  const rock = (r, big, al) => { const b = { r, a0: R() * TAU, y: B() * 0.065, w: w0 * Math.pow(r / 1.45, -1.5) * (0.75 + 0.5 * R()), e: R() * 0.06, pe: R() * TAU, yi: R() * 0.045,
    al, big, tone: R() < 0.4 ? 0 : 1, u: R(), sk: (r - c) * 1.4 }; b.pc = Math.cos(b.pe); b.ps = Math.sin(b.pe); return b; };
  const rocks = [];
  for (let i = 0; i < nb; i++) { const big = R() > 0.88; rocks.push(rock(c + B() * 0.22, big, (big ? 0.45 : 0.27) + R() * 0.26)); }
  for (let i = 0; i < ns; i++) { const big = R() > 0.94; rocks.push(rock(c + 0.01 + B() * 0.4, big, (big ? 0.32 : 0.15) + R() * 0.2)); }
  const D = new Float32Array(1024), p1 = R() * TAU, p2 = R() * TAU, p3 = R() * TAU;
  for (let i = 0; i < 1024; i++) {
    const a = (i / 1024) * TAU, f = 0.5 + 0.5 * (0.5 * Math.sin(2 * a + p1) + 0.32 * Math.sin(3 * a + p2) + 0.18 * Math.sin(5 * a + p3)), k = Math.max(0, Math.min(1, (f - 0.2) / 0.6));
    D[i] = 0.3 + 0.7 * k * k * (3 - 2 * k);
  }
  const n = rocks.length;
  return { rocks, c, dc: 0, D, wm: w0 * Math.pow(c / 1.45, -1.5), X: new Float32Array(n), Y: new Float32Array(n), K: new Uint8Array(n), cnt: new Uint16Array(41), ord: new Uint16Array(n) };
}
function yawToRight(p) { return Math.atan2(p.z, p.x); }
function shortTurn(from, to) { const d = ((to - from + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; return from + d; }

class NetworkView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.nodes = []; this.edges = []; this.rings = []; this.byPath = new Map();
    this.yaw = 0.7; this.pitch = REST_PITCH; this.zoom = 1; this.spin = 0; this.shift = 0;
    this.hover = null; this.query = ''; this.raf = 0; this.mouse = { x: -1, y: -1 };
    this.shown = null; this.fly = null; this.boxToken = 0;
    this.moons = []; this.cardEls = new Map();
    this.ripples = []; this.rippleQ = []; this.rippleGap = 2000; this.lastRipple = 0; this.meteors = [];
    this.focus = null; this.zoomTo = null; this.labelHits = []; this.hoverMoon = null;
    this.press = null; this.userStars = []; this.living = [];
    this.novas = []; this.remnants = []; this.nextNova = 0; this.nova = null; this.blasts = [];
    this.holeSprite = null; this.visitor = null; this.nextVisitor = 0; this.holes = []; this.frameNo = 0;
    this.rockets = []; this.flashes = []; this.rocks = []; this.gEnd = { px: -1e4, py: -1e4, r: 0, capY: 53, path: '', color: C.sand };
    this.act = { last: null, win: [], wh: 0, flood: null, cap: null, pend: new Map(), queue: [], held: [], heldAt: 0, delT: 0, fade: new Map(), mod: new Map(), typed: null, load: 0, seq: 0, heat: 0, heatAt: 0, scope: null };
    const R = rng(7), B = () => (R() + R() + R() - 1.5) / 1.5;
    this.dust = Array.from({ length: 650 }, () => {
      const r = 0.22 + 1.2 * Math.sqrt(R()), big = R() > 0.92;
      return { r, a0: R() * TAU, y: B() * 0.16, w: (0.6 + 0.8 * R()) * 1.1e-5 / (0.5 + r), al: (big ? 0.22 : 0.1) + Math.pow(R(), 1.6) * 0.36, big };
    });
    this.belt = makeBelt(R, 1.45, 8000, 7000);
    this.deep = Array.from({ length: 320 }, () => {
      const u = R() * 2 - 1, ph = R() * TAU, s = Math.sqrt(1 - u * u), r = 1.25 + 1.6 * R();
      return { x: s * Math.cos(ph) * r, y: u * r * 0.7, z: s * Math.sin(ph) * r, al: 0.12 + 0.4 * Math.pow(R(), 2), warm: R() < 0.25 };
    });
    this.intro = null; this.editing = false; this.views = {}; this.ftimes = [];
    this.scopes = [{ kind: 'root', name: '', prefix: '', tagp: '' }]; this.palette = [C.text]; this.big = false; this.quota = Infinity;
  }
  getViewType() { return VIEW; }
  getDisplayText() { return 'Rho Network'; }
  getIcon() { return 'globe'; }

  note(line) { this.plugin.diag(line); }
  fail(where, e) {
    this.note(`ERROR in ${where}: ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`);
    console.error(`Rho Network: ${where}`, e);
    if (!this.errEl) { this.errEl = this.contentEl.appendChild(document.createElement('div')); this.errEl.className = 'rn-error'; }
    this.errEl.textContent = `Rho Network hit a problem in ${where}: ${e && e.message ? e.message : e}. The developer console (Ctrl+Shift+I) has the details.`;
  }

  async onOpen() {
    try { this.open0(); } catch (e) { this.fail('opening', e); }
  }
  open0() {
    const el = this.contentEl;
    el.empty();
    el.addClass('rho-network-view');
    el.tabIndex = 0;
    this.note('opening');
    this.canvas = el.appendChild(document.createElement('canvas'));
    this.ctx = this.canvas.getContext('2d');
    this.ui(el);
    this.loadViews();
    this.build();
    this.note(`built: ${this.nodes.length} notes, ${this.edges.length} links`);
    this.loadStars();
    this.loadNovas();
    this.editing = this.loadFlag('edit');
    this.syncEditBtn();
    this.intro = settingOf(this.plugin.settings, 'intro') ? { t0: 0 } : null;
    if (!this.intro) { this.zoom = INTRO_ZOOM; this.openOut = true; }
    this.paintTheme();
    this.plugin.views.add(this);
    this.setMoons(this.plugin.hub.allMoons());
    this.mountCards();
    this.registerInterval(window.setInterval(() => this.drawWidgets(), 60000));

    const md = (f) => f && f.extension === 'md';
    this.registerEvent(this.app.vault.on('create', (f) => { if (md(f)) { this.activity('create', f.path); this.soon(); this.wSoon(f.path); } }));
    this.registerEvent(this.app.vault.on('delete', (f) => { if (md(f)) { if (f.path === this.shown) this.closeNote(); this.activity('delete', f.path); this.soon(); this.wSoon(f.path); } }));
    this.registerEvent(this.app.vault.on('rename', (f, old) => {
      if (!md(f)) return;
      if (old === this.shown) { this.shown = f.path; if (this.edit) this.edit.path = f.path; this.boxHead(); }
      if (this.views[old]) { this.views[f.path] = (this.views[f.path] || 0) + this.views[old]; delete this.views[old]; this.saveViews(); }
      this.activity('rename', f.path, old);
      this.soon(); this.wSoon(f.path, old);
    }));
    this.registerEvent(this.app.vault.on('modify', (f) => {
      if (f.path === this.shown && this.edit && this.edit.path === f.path) this.editChanged(f).catch(() => {});
      else if (f.path === this.shown) { clearTimeout(this.reboxT); this.reboxT = setTimeout(() => this.renderBox(false), 400); }
      if (md(f)) { if (!this.act.mod.has(f.path)) this.act.mod.set(f.path, this.noteSig(f.path)); this.activity('modify', f.path); this.wSoon(f.path); }
    }));
    this.registerEvent(this.app.metadataCache.on('resolved', () => { this.wRes = (this.wRes || 0) + 1; if (!this.sameLinks()) this.soon(); }));
    this.registerEvent(this.app.metadataCache.on('changed', (f) => { if (md(f)) this.wSoon(f.path); }));
    this.registerEvent(this.app.workspace.on('file-open', (f) => { if (md(f)) { this.countView(f.path); this.wSoon(); } }));
    this.registerEvent(this.app.workspace.on('editor-change', (ed, info) => { const f = info && info.file; if (f) this.act.typed = { path: f.path, at: performance.now() }; }));

    this.ro = new ResizeObserver(() => { if (this.resize()) this.redraw(); });
    this.ro.observe(el);
    this.resize();
    this.input(el);
    try { el.focus({ preventScroll: true }); } catch {   }
    let firstDrawn = false, failed = false;
    const loop = (t) => {
      this.raf = requestAnimationFrame(loop);
      if (document.hidden || !el.isConnected || el.clientWidth < 2 || el.clientHeight < 2) return;
      if (Math.abs(el.clientWidth - this.W) > 1 || Math.abs(el.clientHeight - this.H) > 1) this.resize();
      try {
        const a = performance.now();
        this.frame(t);
        this.lastCost = performance.now() - a;
        this.quality(this.lastCost, t);
        if (!firstDrawn) { firstDrawn = true; this.note(`first frame drawn at ${Math.round(this.W)}×${Math.round(this.H)}, drawn at ${this.dpr.toFixed(2)}×`); }
      } catch (e) { if (!failed) { failed = true; this.fail('drawing', e); } }
    };
    this.raf = requestAnimationFrame(loop);
    this.note('drawing loop started');
  }
  async onClose() { this.settleDeletes(); this.plugin.views.delete(this); cancelAnimationFrame(this.raf); this.dropGL(); clearTimeout(this.wT); clearTimeout(this.setT); if (this.ro) this.ro.disconnect(); if (this.demoT) this.demoT.forEach(clearTimeout); }

  ui(el) {
    const div = (cls, parent = el) => { const d = parent.appendChild(document.createElement('div')); d.className = cls; return d; };
    const top = div('rn-top');
    const topL = div('rn-top-l', top), topM = div('rn-top-m', top), topR = div('rn-top-r', top);
    const title = div('rn-title', topL);
    title.textContent = '◎ RHO NETWORK';
    const pv = title.appendChild(document.createElement('span')); pv.className = 'rn-pver'; pv.textContent = `v${(this.plugin.manifest && this.plugin.manifest.version) || ''}`;
    this.backEl = div('rn-back', topL); this.backEl.textContent = '‹ BACK'; this.backEl.title = 'Back out (Esc)'; this.backEl.classList.add('rn-hidden');
    this.backEl.onclick = () => this.back();
    this.crumbEl = div('rn-crumbs', topL); this.crumbEl.classList.add('rn-hidden');
    this.q = topM.appendChild(document.createElement('input'));
    this.q.className = 'rn-query'; this.q.placeholder = 'Query network  /'; this.q.spellcheck = false;
    this.clock = div('rn-live', topR);
    this.togEls = new Map();
    for (const [key, label, tip] of [['ringNames', 'RINGS', 'Ring names on/off'], ['nearNames', 'NAMES', 'Names of the planets near the mouse on/off']]) {
      const b = div('rn-tog', topR); b.textContent = label; b.title = tip;
      b.onclick = () => this.plugin.setSetting(key, !settingOf(this.plugin.settings, key));
      this.togEls.set(key, b);
    }
    this.syncToggles();
    const view = div('rn-tog', topR); view.textContent = 'VIEW'; view.title = 'Viewing spot: everything else hidden (O; O or Esc to come back)';
    view.onclick = () => this.setLook(true);
    this.gearBtn = div('rn-gearbtn', topR);
    this.gearBtn.textContent = '⚙'; this.gearBtn.title = 'Settings';
    this.gearBtn.onclick = () => (this.gear ? this.closeGear() : this.openGear());
    this.cards = div('rn-cards');
    this.addBtn = div('rn-add', this.cards);
    this.addBtn.textContent = '+'; this.addBtn.title = 'Add a widget';
    this.addBtn.onclick = (e) => this.addMenu(e);
    this.addBtn.addEventListener('contextmenu', (e) => { e.preventDefault(); this.addMenu(e); });
    this.hasCards = false;
    el.toggleClass('no-panel', true);

    this.box = div('rn-box');
    const bar = div('rn-box-bar', this.box);
    this.boxTitle = div('rn-box-title', bar);
    this.boxPath = div('rn-box-path', bar);
    const btn = (label, tip, fn) => { const b = bar.appendChild(document.createElement('button')); b.className = 'rn-btn'; b.textContent = label; b.title = tip; b.onclick = fn; return b; };
    this.editBtn = btn('EDIT', 'Write in the note here (on/off)', () => this.setEditing(!this.editing));
    this.openBtn = btn('OPEN ↗', 'Open in a tab', () => this.shown && this.shown !== GRAVE && this.openNote(this.shown));
    btn('✕', 'Close (Esc)', () => this.closeNote());
    this.boxBody = div('rn-box-body markdown-rendered', this.box);
    this.grip(div('rn-grip rn-grip-x', this.box), true, false);
    this.grip(div('rn-grip rn-grip-y', this.box), false, true);
    this.grip(div('rn-grip rn-grip-xy', this.box), true, true);
    this.boxSize = this.loadBox();
    this.boxBody.addEventListener('click', (e) => this.boxClick(e));

    div('rn-motto').textContent = 'Every note a node. Every link a line.';
    this.hintEl = div('rn-hint');
    this.hint();
    this.cue = div('rn-cue'); this.cue.textContent = 'VIEWING SPOT · O OR ESC TO COME BACK';
    this.lookOut = div('rn-lookout'); this.lookOut.textContent = '✕ LEAVE VIEW'; this.lookOut.title = 'Back to the map (O or Esc)';
    this.lookOut.onclick = () => this.setLook(false);
    this.tip = div('rn-tip');
    this.toastEl = div('rn-toast');
  }
  hint() {
    const extra = [...this.plugin.hub.keys.entries()].map(([k, o]) => `${k.toUpperCase()} · ${o.label}`);
    this.hintEl.textContent = ['DRAG · ORBIT', 'WHEEL · ZOOM', 'CLICK · READ NOTE', 'ORBIT NAME · FOCUS / DIVE', ...extra, '/ · QUERY', 'G · GROUPING', 'O · VIEW', 'T · TIME-LAPSE', 'ESC · BACK', 'DOUBLE-CLICK · RESET'].join('    ');
  }
  columns() {
    const st = this.plugin.settings, cards = this.plugin.hub.allCards(), byKey = new Map(cards.map((c) => [c.key, c]));
    const list = Array.isArray(st.widgets) ? st.widgets : WIDGET_DEFAULT, hid = st.hiddenCards || {};
    const hidden = (k) => Object.prototype.hasOwnProperty.call(hid, k), listed = new Set(list.map((w) => w && w.id)), out = [];
    for (const c of cards) if (!listed.has(c.key) && !hidden(c.key)) out.push({ id: c.key, type: 'card', card: c });
    for (const w of list) {
      if (!w || typeof w.id !== 'string') continue;
      if (w.type === 'card') { const c = byKey.get(w.id); if (c && !hidden(w.id)) out.push({ id: w.id, type: 'card', card: c }); }
      else if (WIDGETS[w.type]) out.push(w);
    }
    return out;
  }
  mountCards() {
    const want = this.columns(), ids = new Set(want.map((w) => w.id)), memo = {};
    for (const [k, el] of this.cardEls) if (!ids.has(k)) { if (el._wcomp) this.removeChild(el._wcomp); el.remove(); this.cardEls.delete(k); }
    this.colOf = new Map(want.map((w) => [w.id, w]));
    const els = want.map((w) => {
      let el = this.cardEls.get(w.id);
      if (!el) { el = document.createElement('div'); el.className = 'rn-card'; el.classList.add('rn-hidden'); el.dataset.wid = w.id; this.cardEls.set(w.id, el); this.wireCard(el); }
      return el;
    });
    let ref = this.addBtn;
    for (let i = els.length - 1; i >= 0; i--) { if (els[i].parentNode !== this.cards || els[i].nextElementSibling !== ref) this.cards.insertBefore(els[i], ref); ref = els[i]; }
    for (const w of want) if (w.type === 'card') this.renderCard(w.card); else this.drawWidget(w, memo);
    this.hasCards = want.length > 0;
    this.contentEl.toggleClass('no-panel', !this.hasCards);
    this.fitBox();
  }
  renderCard(c) {
    const el = this.cardEls.get(c.key);
    if (el) try { c.render(el, this); } catch (e) { this.fail(`the ${c.key} card`, e); }
  }
  wSoon(...paths) {
    if (this.tasks) for (const p of paths) if (p) this.tasks.dirty.add(p);
    if (!this.wT) this.wT = setTimeout(() => { this.wT = 0; this.drawWidgets(); }, WIDGET_MS);
  }
  drawWidgets() {
    if (!this.colOf) return;
    const memo = {};
    for (const w of this.colOf.values()) if (w.type !== 'card') this.drawWidget(w, memo);
  }
  drawWidget(w, memo = {}) {
    const el = this.cardEls.get(w.id), fn = this[`w_${w.type}`];
    if (!el || !fn) return;
    try { fn.call(this, el, w, memo); } catch (e) {
      this.note(`ERROR in the ${w.type} widget: ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`);
      console.error(`Rho Network: the ${w.type} widget`, e);
      this.card(el, WIDGETS[w.type].name, '', '', [{ k: "couldn't draw this", v: '' }]);
    }
  }
  wFiles(memo) { return memo.files || (memo.files = this.mdFiles()); }
  mdFiles() {
    const all = this.app.vault.getMarkdownFiles(), ex = excludeList(this.plugin.settings);
    return ex.length ? all.filter((f) => !ex.some((e) => f.path.startsWith(e))) : all;
  }
  wRow(path, v, title) { return { k: baseName(path), v, title: title || path, click: () => this.goToNote(path) }; }
  w_recent(el, w, memo) {
    const files = this.wFiles(memo), now = Date.now(), n = w.n >= 1 && w.n <= 20 ? Math.floor(w.n) : 5, day0 = new Date(now).setHours(0, 0, 0, 0);
    let today = 0;
    for (const f of files) if (f.stat.mtime >= day0) today++;
    const top = topBy(files, n, (f) => f.stat.mtime);
    this.card(el, 'Recent edits', today ? `${today} today` : '', 'num', top.length ? top.map((f) => this.wRow(f.path, agoShort(f.stat.mtime, now))) : [{ k: 'no notes yet', v: '' }]);
  }
  w_spark(el, w, memo) {
    const S = SPANS[w.span] || SPANS['14d'], end = new Date();
    if (S.ms < 864e5) end.setMinutes(60, 0, 0); else end.setHours(24, 0, 0, 0);
    const b = sparkBuckets(this.wFiles(memo), (f) => f.stat.mtime, S.n, S.ms, end.getTime()), total = b.reduce((a, x) => a + x, 0);
    if (!el._spark) { el._spark = document.createElement('canvas'); el._spark.className = 'rn-spark'; }
    this.card(el, 'Activity', total.toLocaleString('en-GB'), 'num', [], { body: el._spark, foot: S.foot });
    this.drawSpark(el._spark, b);
  }
  drawSpark(cv, b) {
    const W = 190, H = 46, r = Math.min(2, window.devicePixelRatio || 1), n = b.length;
    cv.width = Math.round(W * r); cv.height = Math.round(H * r); cv.style.width = `${W}px`; cv.style.height = `${H}px`;
    const g = cv.getContext('2d');
    if (!g || !n) return;
    g.setTransform(r, 0, 0, r, 0, 0); g.clearRect(0, 0, W, H);
    const max = Math.max(1, ...b), px = (i) => 3 + (i * (W - 6)) / Math.max(1, n - 1), py = (v) => H - 4 - (v / max) * (H - 12);
    const trace = () => { g.moveTo(px(0), py(b[0])); for (let i = 1; i < n; i++) { const xm = (px(i - 1) + px(i)) / 2; g.bezierCurveTo(xm, py(b[i - 1]), xm, py(b[i]), px(i), py(b[i])); } };
    const fill = g.createLinearGradient(0, 0, 0, H);
    fill.addColorStop(0, rgba(C.sand, 0.16)); fill.addColorStop(1, rgba(C.sand, 0));
    g.beginPath(); trace(); g.lineTo(px(n - 1), H); g.lineTo(px(0), H); g.closePath(); g.fillStyle = fill; g.fill();
    g.beginPath(); trace(); g.strokeStyle = rgba(C.sand, 0.75); g.lineWidth = 1.2; g.lineJoin = 'round'; g.stroke();
    g.beginPath(); g.arc(px(n - 1), py(b[n - 1]), 2, 0, TAU); g.fillStyle = C.sand; g.fill();
  }
  openTasks() {
    const MC = this.app.metadataCache;
    const count = (f) => { const c = f && f.extension === 'md' && MC.getFileCache(f), li = c && c.listItems; let n = 0; if (li) for (const x of li) if (x.task === ' ' || x.task === '/') n++; return n; };
    if (!this.tasks) {
      const by = new Map();
      for (const f of this.mdFiles()) { const n = count(f); if (n) by.set(f.path, n); }
      this.tasks = { by, dirty: new Set() };
    } else if (this.tasks.dirty.size) {
      for (const p of this.tasks.dirty) { const n = count(this.app.vault.getAbstractFileByPath(p)); if (n) this.tasks.by.set(p, n); else this.tasks.by.delete(p); }
      this.tasks.dirty.clear();
    }
    return this.tasks.by;
  }
  w_tasks(el) {
    const by = this.openTasks();
    let total = 0;
    for (const n of by.values()) total += n;
    const top = topBy(by.entries(), 5, (e) => e[1]);
    this.card(el, 'Open tasks', total.toLocaleString('en-GB'), 'num', top.length ? top.map(([p, n]) => this.wRow(p, String(n), `${p} · ${n} open`)) : [{ k: 'none open', v: '' }]);
  }
  inboxOf(w) {
    if (w.folder) return w.folder;
    const V = this.vix;
    if (!V) return null;
    if (V.inbox === undefined) {
      V.inbox = null;
      for (const p of V.all) { const i = p.indexOf('/'); if (i > 0 && /inbox/i.test(p.slice(0, i))) { V.inbox = p.slice(0, i); break; } }
    }
    return V.inbox;
  }
  w_inbox(el, w, memo) {
    const dir = this.inboxOf(w);
    if (!dir) { this.card(el, 'Inbox', '', '', [{ k: 'no inbox folder', v: '' }], { foot: 'right-click to pick one' }); return; }
    const pre = `${dir}/`, now = Date.now(), files = this.wFiles(memo).filter((f) => f.path.startsWith(pre)), old = topBy(files, 4, (f) => -f.stat.ctime);
    this.card(el, 'Inbox', files.length.toLocaleString('en-GB'), 'num', old.length ? old.map((f) => this.wRow(f.path, agoShort(f.stat.ctime, now))) : [{ k: 'empty', v: '' }], { foot: `${dir} · oldest first` });
  }
  w_today(el, w, memo) {
    const now = new Date(), y = now.getFullYear(), m = now.getMonth(), d = now.getDate(), key = `${y}-${m}-${d}`, V = this.vix;
    let hits = V && V.today && V.today.key === key ? V.today.hits : null;
    if (!hits) {
      hits = [];
      const re = new RegExp(`(?:^|\\D)(\\d{4})-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}(?:\\D|$)`);
      for (const f of this.wFiles(memo)) {
        const c = new Date(f.stat.ctime);
        let yr = c.getMonth() === m && c.getDate() === d ? c.getFullYear() : 0;
        if (!(yr && yr < y)) { const r = re.exec(f.basename || baseName(f.path)); yr = r ? Number(r[1]) : 0; }
        if (yr > 1970 && yr < y) hits.push({ path: f.path, yr, t: f.stat.mtime });
      }
      hits.sort((a, b) => b.yr - a.yr || b.t - a.t);
      if (V) V.today = { key, hits };
    }
    this.card(el, 'On this day', `${d} ${MONTHS[m]}`, 'calm', hits.length ? hits.slice(0, 6).map((h) => this.wRow(h.path, String(h.yr))) : [{ k: 'nothing from past years', v: '' }],
      { foot: hits.length > 6 ? `${hits.length} notes in all` : '' });
  }
  w_opened(el) {
    const V = this.vix, top = topBy(Object.entries(this.views || {}).filter(([p]) => !V || V.fileOf.has(p)), 6, (e) => e[1]);
    this.card(el, 'Most opened', '', '', top.length ? top.map(([p, n]) => this.wRow(p, String(n), `${p} · opened ${n} times`)) : [{ k: 'counted from now on', v: '' }]);
  }
  w_stats(el, w, memo) {
    const V = this.vix, files = this.wFiles(memo), now = Date.now(), fmt = (n) => n.toLocaleString('en-GB'), MC = this.app.metadataCache;
    if (V && !V.wstat) {
      let tags;
      if (MC.getTags) tags = new Set(Object.keys(MC.getTags() || {}).map((t) => t.replace(/^#/, '').toLowerCase())).size;
      else { const s = new Set(); for (const p of V.all) for (const t of V.tagsOf(p)) s.add(t); tags = s.size; }
      V.wstat = { dirs: foldersOf(V.all).size, tags };
    }
    let wk = 0, mo = 0;
    for (const f of files) { if (now - f.stat.mtime < 7 * 864e5) wk++; if (now - f.stat.ctime < 30 * 864e5) mo++; }
    const S = (V && V.wstat) || { dirs: 0, tags: 0 };
    this.card(el, 'Vault', '', '', [
      { k: 'Notes', v: fmt(files.length) }, { k: 'Links', v: fmt(V ? V.links : 0), title: 'Notes linked, each pair once' },
      { k: 'Folders', v: fmt(S.dirs) }, { k: 'Tags', v: fmt(S.tags) },
      { k: 'Edited · 7 d', v: fmt(wk) }, { k: 'New · 30 d', v: fmt(mo) },
    ]);
  }
  w_loose(el) {
    const V = this.vix;
    if (!V) return;
    if (!V.orphans) { const o = []; for (let i = 0; i < V.all.length; i++) if (!V.gdeg[i]) o.push(i); V.orphans = o; }
    if (!this.looseMemo || this.looseMemo.res !== this.wRes) {
      const un = this.app.metadataCache.unresolvedLinks || {}, per = [];
      let broken = 0;
      for (const src in un) { let n = 0; for (const k in un[src]) n++; if (n) { broken += n; per.push([src, n]); } }
      this.looseMemo = { res: this.wRes, broken, top: topBy(per, 3, (e) => e[1]) };
    }
    const L = this.looseMemo, fmt = (n) => n.toLocaleString('en-GB');
    this.card(el, 'Loose ends', '', '', [
      { k: 'ORPHANS', v: fmt(V.orphans.length), title: 'Notes with no links in or out · click for the next one', click: V.orphans.length ? () => this.nextOrphan() : null },
      { k: 'Broken links', v: fmt(L.broken), title: "Links to notes that don't exist yet" },
      ...L.top.map(([p, n]) => this.wRow(p, String(n), `${p} · ${n} broken`)),
    ]);
  }
  nextOrphan() {
    const V = this.vix, o = V && V.orphans;
    if (!o || !o.length) return;
    this.orphanAt = this.orphanAt === undefined ? 0 : (this.orphanAt + 1) % o.length;
    this.goToNote(V.all[o[this.orphanAt % o.length]]);
  }
  w_note(el, w) {
    const f = w.path && this.app.vault.getAbstractFileByPath(w.path);
    if (!f || f.extension !== 'md') {
      el._wsig = '';
      this.card(el, w.path ? baseName(w.path) : 'Note', '', '', [{ k: 'note not found', v: '' }], { foot: 'right-click to pick another' });
      return;
    }
    if (!el._wbody) {
      el._wbody = document.createElement('div'); el._wbody.className = 'rn-wnote markdown-rendered';
      el._wbody.addEventListener('click', (e) => this.boxClick(e, el._wpath));
    }
    el._wpath = f.path;
    this.card(el, f.basename || baseName(f.path), agoShort(f.stat.mtime), 'calm', [], { body: el._wbody, onHead: () => this.goToNote(f.path) });
    const sig = `${f.path}|${f.stat.mtime}`;
    if (el._wsig !== sig) { el._wsig = sig; this.wRenderNote(el, f).catch(() => {}); }
  }
  async wRenderNote(el, f) {
    const tok = (el._wtok = (el._wtok || 0) + 1), body = el._wbody, name = f.basename || baseName(f.path);
    let text = '';
    try { text = await this.app.vault.cachedRead(f); } catch {   }
    if (tok !== el._wtok) return;
    text = String(text || '').replace(/^﻿/, '').replace(/\r/g, '');
    if (text.startsWith('---')) { const e = text.indexOf('\n---', 3); if (e > 0) text = text.slice(text.indexOf('\n', e + 1) + 1 || text.length); }
    text = text.replace(/^\s*#\s+(.+)\n/, (all, h) => (h.trim().toLowerCase() === name.toLowerCase() ? '' : all)).replace(/^(?:[ \t]*\n)+/, '');
    if (text.length > 1200) { const cut = text.lastIndexOf('\n', 1200); text = text.slice(0, cut > 400 ? cut : 1200); }
    if (el._wcomp) this.removeChild(el._wcomp);
    const comp = (el._wcomp = new Component());
    this.addChild(comp);
    body.textContent = '';
    try {
      if (MarkdownRenderer.render) await MarkdownRenderer.render(this.app, text, body, f.path, comp);
      else await MarkdownRenderer.renderMarkdown(text, body, f.path, comp);
    } catch { body.textContent = text; }
    if (tok === el._wtok) body.classList.toggle('long', body.scrollHeight > 170);
  }
  w_folder(el, w, memo) {
    const src = String(w.src || ''), V = this.vix, now = Date.now();
    if (!src) { this.card(el, 'Folder', '', '', [{ k: 'nothing picked', v: '' }], { foot: 'right-click to pick one' }); return; }
    let name, match;
    if (src[0] === '#') { const t = src.slice(1).toLowerCase(); name = src; match = (p) => !!V && V.tagsOf(p).some((x) => x === t || x.startsWith(`${t}/`)); }
    else { const dir = src.replace(/\/+$/, ''), pre = `${dir}/`; name = dir.slice(dir.lastIndexOf('/') + 1); match = (p) => p.startsWith(pre); }
    const files = this.wFiles(memo).filter((f) => match(f.path)), top = topBy(files, 6, (f) => f.stat.mtime);
    this.card(el, name, files.length.toLocaleString('en-GB'), 'num', top.length ? top.map((f) => this.wRow(f.path, agoShort(f.stat.mtime, now))) : [{ k: 'no notes', v: '' }],
      { foot: src[0] === '#' ? 'newest first' : `${src.replace(/\/+$/, '')} · newest first` });
  }

  wEdit(fn) {
    const st = this.plugin.settings;
    if (!Array.isArray(st.widgets)) st.widgets = WIDGET_DEFAULT.map((w) => Object.assign({}, w));
    fn(st.widgets, st);
    this.plugin.saveSettings();
    for (const v of this.plugin.views) v.mountCards();
  }
  addWidget(type) {
    if (!WIDGETS[type]) return;
    const put = (conf) => {
      let id = `w:${type}`;
      this.wEdit((list) => { if (list.some((w) => w.id === id)) id = `w:${type}:${Date.now().toString(36)}`; list.push(Object.assign({ id, type }, conf)); });
      const el = this.cardEls.get(id);
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    };
    if (type === 'note') this.pickFor('note', (p) => put({ path: p }));
    else if (type === 'folder') this.pickFor('source', (s) => put({ src: s }));
    else put(type === 'recent' ? { n: 5 } : type === 'spark' ? { span: '14d' } : {});
  }
  setWidget(id, patch) {
    this.wEdit((list) => { const w = list.find((x) => x.id === id); if (w) for (const k in patch) { if (patch[k] === undefined) delete w[k]; else w[k] = patch[k]; } });
  }
  removeWidget(id) {
    const w = this.colOf && this.colOf.get(id);
    if (!w) return;
    const el = this.cardEls.get(id);
    this.wEdit((list, st) => {
      if (w.type === 'card') st.hiddenCards = Object.assign({}, st.hiddenCards, { [id]: (el && el.dataset.label) || id.slice(id.indexOf(':') + 1) });
      const i = list.findIndex((x) => x.id === id);
      if (i >= 0) list.splice(i, 1);
    });
  }
  showCard(key) { this.wEdit((list, st) => { if (st.hiddenCards) delete st.hiddenCards[key]; }); }
  moveWidget(id, d) {
    const ids = this.columns().map((w) => w.id), i = ids.indexOf(id), j = i + d;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    this.saveOrder(ids);
  }
  saveOrder(ids) {
    this.wEdit((list) => {
      const byId = new Map(list.map((w) => [w.id, w])), next = [];
      for (const id of ids) {
        const c = this.colOf && this.colOf.get(id), w = byId.get(id) || (c && c.type === 'card' ? { id, type: 'card' } : null);
        if (w) { next.push(w); byId.delete(id); }
      }
      next.push(...byId.values());
      list.length = 0; list.push(...next);
    });
  }
  pickFor(kind, done) {
    if (!FuzzySuggestModal) return null;
    const V = this.vix, all = V ? V.all : this.mdFiles().map((f) => f.path);
    if (kind === 'note') return openPicker(this.app, all, (p) => p.replace(/\.md$/, ''), 'Pick a note to show', done);
    const items = [...foldersOf(all)].sort();
    if (kind === 'source') {
      const MC = this.app.metadataCache, tags = new Set();
      if (MC.getTags) for (const t of Object.keys(MC.getTags() || {})) tags.add(`#${t.replace(/^#/, '').toLowerCase()}`);
      else if (V) for (const p of all) for (const t of V.tagsOf(p)) tags.add(`#${t}`);
      items.push(...[...tags].sort());
    }
    return openPicker(this.app, items, (x) => x, kind === 'source' ? 'Pick a folder or a #tag' : 'Pick the inbox folder', done);
  }
  addMenu(e) {
    if (!Menu) return null;
    const menu = new Menu(), have = new Set(this.columns().map((w) => w.type)), hid = this.plugin.settings.hiddenCards || {};
    for (const [type, k] of Object.entries(WIDGETS)) menu.addItem((it) => {
      it.setTitle(k.name).setIcon(k.icon);
      if (!k.many && have.has(type)) { if (it.setChecked) it.setChecked(true); if (it.setDisabled) it.setDisabled(true); } else it.onClick(() => this.addWidget(type));
    });
    const loaded = new Set(this.plugin.hub.allCards().map((c) => c.key)), off = Object.entries(hid).filter(([key]) => loaded.has(key));
    if (off.length) { menu.addSeparator(); for (const [key, label] of off) menu.addItem((it) => it.setTitle(`Show ${label}`).setIcon('eye').onClick(() => this.showCard(key))); }
    menu.showAtMouseEvent(e);
    return menu;
  }
  widgetMenu(id, e) {
    const w = this.colOf && this.colOf.get(id);
    if (!w || !Menu) return null;
    const menu = new Menu(), ids = this.columns().map((x) => x.id), at = ids.indexOf(id), set = (patch) => () => this.setWidget(id, patch);
    const item = (title, icon, fn, { on = false, off = false } = {}) => menu.addItem((it) => {
      it.setTitle(title).setIcon(icon);
      if (on && it.setChecked) it.setChecked(true);
      if (off) { if (it.setDisabled) it.setDisabled(true); } else it.onClick(fn);
    });
    let own = true;
    if (w.type === 'recent') for (const n of [5, 8, 12]) item(`Show ${n}`, 'list', set({ n }), { on: (w.n || 5) === n });
    else if (w.type === 'spark') for (const [s, S] of Object.entries(SPANS)) item(`Last ${S.label}`, 'activity', set({ span: s }), { on: (w.span || '14d') === s });
    else if (w.type === 'inbox') {
      item(w.folder ? 'Pick another folder…' : 'Pick the inbox folder…', 'folder', () => this.pickFor('dir', (f) => this.setWidget(id, { folder: f })));
      if (w.folder) item('Find it by its name again', 'search', set({ folder: undefined }));
    } else if (w.type === 'note') {
      if (w.path) item('Open the note', 'file-text', () => this.goToNote(w.path));
      item('Show another note…', 'file', () => this.pickFor('note', (p) => this.setWidget(id, { path: p })));
    } else if (w.type === 'folder') item('Show another folder or tag…', 'folder', () => this.pickFor('source', (s) => this.setWidget(id, { src: s })));
    else own = false;
    if (own) menu.addSeparator();
    item('Move up', 'arrow-up', () => this.moveWidget(id, -1), { off: at <= 0 });
    item('Move down', 'arrow-down', () => this.moveWidget(id, 1), { off: at >= ids.length - 1 });
    item(w.type === 'card' ? 'Hide' : 'Remove', 'x', () => this.removeWidget(id));
    menu.showAtMouseEvent(e);
    return menu;
  }
  wireCard(el) {
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); this.widgetMenu(el.dataset.wid, e); });
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.target && e.target.closest && e.target.closest('input, textarea, select'))) return;
      this.drag = { el, y0: e.clientY, pid: e.pointerId, on: false };
    });
    el.addEventListener('pointermove', (e) => this.dragMove(e));
    el.addEventListener('pointerup', () => this.dragDone());
    el.addEventListener('pointercancel', () => this.dragDone());
    el.addEventListener('click', (e) => { if (performance.now() - (this.dropAt || -1e9) < 250) { e.preventDefault(); e.stopPropagation(); } }, true);
  }
  colEls(shown = true) { return [...this.cards.children].filter((k) => k !== this.addBtn && (!shown || !k.classList.contains('rn-hidden'))); }
  dragMove(e) {
    const d = this.drag;
    if (!d) return;
    if (!(e.buttons & 1)) { this.drag = null; return; }
    const dy = e.clientY - d.y0;
    if (!d.on) {
      if (Math.abs(dy) < 5) return;
      const kids = this.colEls();
      d.on = true; d.top0 = d.el.offsetTop; d.h = d.el.offsetHeight;
      d.base = kids.length ? kids[0].offsetTop : 0;
      d.gap = kids.length > 1 ? Math.max(0, kids[1].offsetTop - kids[0].offsetTop - kids[0].offsetHeight) : 10;
      d.max = d.base + kids.reduce((s, k) => s + k.offsetHeight, 0) + d.gap * (kids.length - 1) - d.h;
      d.el.classList.add('lifted'); this.cards.classList.add('sorting');
      try { d.el.setPointerCapture(d.pid); } catch {   }
    }
    const top = Math.max(d.base, Math.min(d.max, d.top0 + dy)), mid = top + d.h / 2, others = this.colEls().filter((k) => k !== d.el);
    let y = d.base, at = others.length;
    for (let i = 0; i < others.length; i++) { const h = others[i].offsetHeight; if (mid < y + h / 2) { at = i; break; } y += h + d.gap; }
    const ref = others[at] || this.addBtn;
    if (d.el.nextElementSibling !== ref) this.flip(() => this.cards.insertBefore(d.el, ref), d.el);
    d.el.style.transform = `translateY(${top - d.el.offsetTop}px)`;
  }
  dragDone() {
    const d = this.drag;
    this.drag = null;
    if (!d || !d.on) return;
    d.el.classList.remove('lifted'); this.cards.classList.remove('sorting');
    d.el.style.removeProperty('transform');
    this.dropAt = performance.now();
    this.saveOrder(this.colEls(false).map((k) => k.dataset.wid));
  }
  flip(change, skip) {
    const kids = this.colEls().filter((k) => k !== skip), was = kids.map((k) => k.getBoundingClientRect().top);
    change();
    kids.forEach((k, i) => {
      k.classList.add('rn-snap'); k.style.removeProperty('transform');
      const dy = was[i] - k.getBoundingClientRect().top;
      if (!dy) { k.classList.remove('rn-snap'); return; }
      k.style.transform = `translateY(${dy}px)`;
      void k.offsetHeight;
      k.classList.remove('rn-snap'); k.style.removeProperty('transform');
    });
  }

  get scope() { return this.scopes[this.scopes.length - 1]; }
  scopeName(s) { return s.kind === 'root' ? this.app.vault.getName() : s.name; }
  build() {
    this.morph = null; this.morphE = 1;
    const files = this.mdFiles(), MC = this.app.metadataCache, links = MC.resolvedLinks || {};
    const N = files.length, all = new Array(N), fileOf = new Map(), idx = new Map();
    for (let i = 0; i < N; i++) { const p = files[i].path; all[i] = p; fileOf.set(p, files[i]); idx.set(p, i); }
    const nbr = new Array(N), gdeg = new Int32Array(N), inb = new Int32Array(N), seen = new Set();
    for (let i = 0; i < N; i++) nbr[i] = [];
    for (const src in links) {
      const a = idx.get(src); if (a === undefined) continue;
      for (const dst in links[src]) {
        const b = idx.get(dst); if (b === undefined || a === b) continue;
        inb[b]++;
        const key = a < b ? a * N + b : b * N + a;
        if (seen.has(key)) continue;
        seen.add(key); nbr[a].push(b); nbr[b].push(a); gdeg[a]++; gdeg[b]++;
      }
    }
    this.vix = { all, gdeg, fileOf, lnames: null, links: seen.size };
    const tagCache = new Map();
    const tagsOf = (p) => {
      let t = tagCache.get(p);
      if (t === undefined) {
        t = [];
        const f = fileOf.get(p), c = f && MC.getFileCache && MC.getFileCache(f);
        const add = (x) => { if (typeof x !== 'string') return; x = x.trim().replace(/^#/, '').toLowerCase(); if (x && !t.includes(x)) t.push(x); };
        if (c) {
          if (Array.isArray(c.tags)) for (const x of c.tags) add(x && x.tag);
          const fm = c.frontmatter && (c.frontmatter.tags !== undefined ? c.frontmatter.tags : c.frontmatter.tag);
          if (Array.isArray(fm)) fm.forEach(add); else if (typeof fm === 'string') fm.split(/[,\s]+/).forEach(add);
        }
        tagCache.set(p, t);
      }
      return t;
    };
    this.vix.tagsOf = tagsOf;
    let members = all;
    for (let s = 1; s < this.scopes.length; s++) {
      const next = members.filter((p) => inScope(this.scopes[s], p, tagsOf));
      if (next.length < 2) { this.scopes.length = s; break; }
      members = next;
    }
    const S = this.scope, root = this.scopes.length === 1;
    let hub = null;
    if (root) {
      const own = `${this.app.vault.getName()}.md`;
      if (fileOf.has(own)) hub = own;
      else { let bi = -1; for (let i = 0; i < N; i++) if (inb[i] > (bi < 0 ? 0 : inb[bi]) && !all[i].includes('/')) bi = i; hub = bi < 0 ? null : all[bi]; }
    } else {
      const mset = new Set(members), inbound = new Map();
      for (const p of members) { const tg = links[p]; if (tg) for (const d in tg) if (d !== p && mset.has(d)) inbound.set(d, (inbound.get(d) || 0) + 1); }
      hub = scopeHub(S, members, inbound);
    }
    this.hub = hub;
    const LO = this.plugin.hub.layout();
    let fresh = [], outer = [], belt2 = false;
    if (root) {
      const since = LO.freshSince ? new Date(`${LO.freshSince}T00:00:00`).getTime() : NaN, skip = new Set(LO.freshSkip);
      if (Number.isFinite(since)) fresh = files.filter((f) => f.stat && f.stat.ctime >= since && !skip.has(f.path)).sort((a, b) => a.stat.ctime - b.stat.ctime || byName(a.path, b.path)).map((f) => f.path);
      outer = LO.outer; belt2 = !!settingOf(this.plugin.settings, 'belt2');
    }
    const grp = groupNotes(members, { mode: (this.plugin.settings && this.plugin.settings.groupBy) || 'auto', prefix: S.prefix || '', tagp: S.tagp || '', hub, tagsOf, keep: outer,
      nbrs: (p) => nbr[idx.get(p)].map((j) => all[j]) });
    this.grouping = grp.mode;
    const lm = this.lmemo || (this.lmemo = new Map()), lc = this.lcache || (this.lcache = new Map());
    const sp0 = settingOf(this.plugin.settings, 'ringSpacing') / 100, spc = 1.3 * sp0, lo = { groupOf: grp.groupOf, outer, fresh, belt2, memo: lm };
    const { nodes, rings, rmax, outerMax, outerIn, belt2: b2, grow, spr, capped } = layout(members, hub, { ...lo, cache: lc, spacing: spc, tilt: settingOf(this.plugin.settings, 'ringTilt') / 100 });
    const fsp = this.fitSp || (this.fitSp = Math.min(sp0, 1.6)), F =fsp === spc ? null : layout(members, hub, { ...lo, spacing: fsp, fitOnly: true });
    this.fit1 = F ? { rings: F.rings, rmax: F.rmax, outerIn: F.outerIn || F.outerMax } : null;
    this.outerMax = outerMax; this.outerIn = outerIn || outerMax; this.grow = (F ? F.grow : grow) || 1; this.spr = (F ? F.spr : spr) || 1; this.orbits = rings.filter((r, i) => i && !r.fresh).length;
    this.sparse = Math.max(1, Math.min(2, Math.pow(4000 / Math.max(1, nodes.length), 0.35)));
    if (!b2) this.belt2 = null;
    else if (!this.belt2) this.belt2 = makeBelt(rng(8), b2.c, 7000, 6000);
    else if (this.belt2.c !== b2.c) { const d = b2.c - this.belt2.c; for (const r of this.belt2.rocks) r.r += d; this.belt2.c = b2.c; }
    if (this.belt2) this.belt2.dc = 0;
    rings.forEach((r, i) => {
      r.ci = Math.cos(r.incl); r.si = Math.sin(r.incl); r.ca = Math.cos(r.asc); r.sa = Math.sin(r.asc);
      r.child = grp.child.get(r.name) || null;
      if (i && !r.fresh) {
        const L = (r.line = new Float32Array(363));
        for (let a = 0; a <= 120; a++) { const th = (a / 120) * TAU, x = Math.cos(th) * r.radius, z = Math.sin(th) * r.radius, z1 = z * r.ci; L[3 * a] = x * r.ca + z1 * r.sa; L[3 * a + 1] = -z * r.si; L[3 * a + 2] = -x * r.sa + z1 * r.ca; }
      }
    });
    const keys = [...new Set(grp.groupOf.values())].filter(Boolean).sort();
    const ringColor = new Map(keys.map((k, i) => [k, PALETTE[i % PALETTE.length]]));
    const preset = settingOf(this.plugin.settings, 'planetColors'), PRE = PRESETS[preset] || null, fixed = this.plugin.hub.fixedOf();
    const custom = PRE ? null : this.plugin.hub.colorOf(), pal = [], palIx = new Map();
    rings.forEach((r, i) => { r.tone = preset === 'halloween' ? HALLOWEEN[i % HALLOWEEN.length] : null; });
    const colorIx = (c) => { let i = palIx.get(c); if (i === undefined) { i = pal.length; pal.push(c); palIx.set(c, i); } return i; };
    const now = Date.now(), views = this.views || {}, at = new Int32Array(N).fill(-1);
    const prev = this.byPath;
    if (prev && prev.size) for (let k = 0; k < nodes.length; k++) {
      const n = nodes[k], o = prev.get(n.path);
      if (o) { o.ring = n.ring; o.th = n.th; o.l = n.l; o.x = n.x; o.y = n.y; o.z = n.z; o.fresh = n.fresh; nodes[k] = o; }
    }
    this.byPath = new Map();
    nodes.forEach((n, k) => {
      const gi = idx.get(n.path), gk = n.path === hub ? '' : grp.groupOf.get(n.path);
      n.gi = gi; at[gi] = k;
      n.file = fileOf.get(n.path); n.name = baseName(n.path); n.lname = n.name.toLowerCase();
      n.color = (fixed && fixed(n.path)) || (PRE ? (n.path === hub ? C.text : PRE[Math.abs(n.ring | 0) % PRE.length]) : (custom && custom(n.path)) || (gk ? ringColor.get(gk) : C.text)); n.ci = colorIx(n.color);
      n.deg = 0; n.gdeg = gdeg[gi]; n.adj = []; n.v = 1; n.promo = 0; n.m = 0; n.qr = 0; n.pl = true; n.px = n.py = -1e4; n.ps = 0; n.pn = 0;
      n.rank = 0; n.sec = -1; n.star = 0; n.wd = 0;
      n.score = planetScore(n.gdeg, now - (n.file && n.file.stat ? n.file.stat.mtime : 0), views[n.path]);
      this.byPath.set(n.path, n);
    });
    this.palette = pal;
    const edges = [];
    for (let k = 0; k < nodes.length; k++) {
      const a = nodes[k], gi = a.gi;
      for (const gj of nbr[gi]) {
        if (gj < gi) continue;
        const kb = at[gj]; if (kb < 0) continue;
        const b = nodes[kb]; edges.push([a, b]); a.deg++; b.deg++; a.adj.push(b); b.adj.push(a);
      }
    }
    const perRing = rings.map(() => []);
    for (const n of nodes) { n.rank = 0; if (n.ring >= 0 && perRing[n.ring]) perRing[n.ring].push(n); }
    for (const list of perRing) { list.sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : 1)); for (let i = 0; i < list.length; i++) list[i].rank = i; }
    this.big = nodes.length > PLANET_ALL || edges.length > BIG_EDGES;
    this.quota = this.big ? Math.max(PLANET_MIN, Math.floor(PLANET_SUM / Math.max(1, rings.length))) : Infinity;
    this.bundles = null; this.sec = null;
    if (this.big) {
      const SEC = 12, ns = rings.length * SEC, sx = new Float64Array(ns), sy = new Float64Array(ns), sz = new Float64Array(ns), sc = new Int32Array(ns);
      for (const n of nodes) {
        if (n.ring < 0 || !n.l) { n.sec = -1; continue; }
        const th = ((n.th % TAU) + TAU) % TAU, s = n.ring * SEC + Math.min(SEC - 1, Math.floor((th / TAU) * SEC));
        n.sec = s; sx[s] += n.l.x; sy[s] += n.l.y; sz[s] += n.l.z; sc[s]++;
      }
      for (let s = 0; s < ns; s++) if (sc[s]) { sx[s] /= sc[s]; sy[s] /= sc[s]; sz[s] /= sc[s]; }
      const pair = new Map();
      for (const [a, b] of edges) {
        if (a.sec < 0 || b.sec < 0 || a.sec === b.sec) continue;
        const key = a.sec < b.sec ? a.sec * ns + b.sec : b.sec * ns + a.sec;
        pair.set(key, (pair.get(key) || 0) + 1);
      }
      const top = [...pair].sort((x, y) => y[1] - x[1] || x[0] - y[0]).slice(0, 150), cmax = top.length ? top[0][1] : 1;
      this.bundles = top.map(([key, c]) => ({ a: Math.floor(key / ns), b: key % ns, c, band: Math.min(3, Math.floor((4 * Math.log(1 + c)) / Math.log(2 + cmax))) }));
      this.sec = { n: ns, x: sx, y: sy, z: sz, c: sc, px: new Float32Array(ns), py: new Float32Array(ns) };
    }
    this.rcs = new Float64Array(rings.length); this.rss = new Float64Array(rings.length);
    this.dK = new Int32Array(nodes.length); this.dOrd = new Int32Array(nodes.length); this.dCnt = new Int32Array(pal.length * 8 + 2);
    this.nodes = nodes; this.edges = edges; this.rings = rings; this.rmax = rmax; this.hubNode = hub ? this.byPath.get(hub) || null : null;
    const FR = F ? this.fit1.rings : rings, FM = F ? this.fit1.rmax : rmax, FI = F ? this.fit1.outerIn : this.outerIn;
    const FN = FR.filter((r) => !r.far);
    this.ext = FN.some((r) => r.giant) ? viewExtent(FN.filter((r) => !r.giant), FM, 1.8 * FM) : viewExtent(FN, FM, FI);
    this.extAll = viewExtent(rings, rmax, Math.max(this.outerMax || 0, 1.75 * rmax), 6);
    this.capped = !!capped;
    this.extLand = capped ? viewExtent(FR.filter((r) => !r.outer), FM, 1.75 * FM, 6) : viewExtent(FN, FM, Math.max(FI || 0, 1.75 * FM), 6);
    const csp = this.coreSp || (this.coreSp = spc), CL = csp === spc ? { rings, rmax, outerMax } : layout(members, hub, { ...lo, spacing: csp, fitOnly: true });
    const DB = (m) => Math.max(3400, 1.7 * Math.max(1.8 * CL.rmax, m));
    this.extCore = viewExtent(CL.rings.filter((r) => (!r.outer || (r.giant && !capped)) && !r.far), CL.rmax, 1.75 * CL.rmax, DB(CL.outerMax || 0) / DB(1.75 * CL.rmax));
    this.qNodes = null; this.pNodes = null;
    if (this.focus !== null && !this.rings[this.focus]) this.focus = null;
    this.crumbs();
    this.rebuildDue = false; this.landed();
  }
  soon() { this.rebuildDue = true; clearTimeout(this.rebuildT); this.rebuildT = setTimeout(() => { this.build(); this.wSoon(); }, 1500); }
  drill(scope) {
    if (!scope) return;
    this.scopes.push(scope); this.afterScope(2.2);
  }
  scopeUp(to = this.scopes.length - 2) {
    if (to < 0 || to >= this.scopes.length - 1) return false;
    this.scopes.length = to + 1; this.afterScope(0.45);
    return true;
  }
  afterScope(z) {
    this.endIntro(); this.lapse = null; this.focus = null; this.hover = null; this.fly = null;
    this.build();
    this.zoom = z; this.zoomTo = 1;
  }
  regroup() {
    const fr = this.focus !== null && this.rings ? this.rings[this.focus] : null, fname = fr ? fr.name : null;
    this.lapse = null; this.hover = null; this.fly = null;
    this.keepK = this.intro || !this.k ? 0 : this.k * this.zoom;
    this.build();
    const fi = fname === null ? -1 : this.rings.findIndex((r) => r.name === fname);
    this.focus = fi < 0 ? null : fi;
  }
  crumbs() {
    const el = this.crumbEl; if (!el) return;
    el.textContent = '';
    if (this.scopes.length < 2) { el.classList.add('rn-hidden'); return; }
    el.classList.remove('rn-hidden');
    this.scopes.forEach((s, i) => {
      if (i) el.appendChild(document.createElement('i')).textContent = '›';
      const b = el.appendChild(document.createElement('span'));
      b.textContent = i ? s.name : 'Vault';
      if (i < this.scopes.length - 1) { b.className = 'up'; b.onclick = () => this.scopeUp(i); }
    });
  }
  back() {
    if (this.focus !== null) this.toggleFocus(this.focus);
    else this.scopeUp();
  }
  syncToggles() {
    for (const [k, b] of this.togEls || []) b.classList.toggle('on', !!settingOf(this.plugin.settings, k));
  }
  cycleGrouping() {
    const st = this.plugin.settings, i = GROUP_MODES.indexOf(settingOf(st, 'groupBy'));
    this.plugin.setSetting('groupBy', GROUP_MODES[(i + 1) % GROUP_MODES.length]);
    this.toast(`grouped by ${st.groupBy === 'auto' ? `auto (${this.grouping})` : st.groupBy}`);
  }
  theme() { return THEMES[settingOf(this.plugin.settings, 'theme')] || THEMES.deep; }
  planetScale() { return (settingOf(this.plugin.settings, 'planetSize') / 100) * 0.7; }
  paintTheme() {
    this.contentEl.classList.toggle('rn-paper', settingOf(this.plugin.settings, 'theme') === 'paper');
    if (this.contentEl.style && this.contentEl.style.setProperty) this.contentEl.style.setProperty('--rn-paper-lum', String(paperLum(settingOf(this.plugin.settings, 'darkness'))));
  }
  applySetting(key) {
    const later = (ms, fn) => { clearTimeout(this.setT); this.setT = setTimeout(() => { try { fn(); } catch (e) { this.fail('a setting', e); } }, ms); };
    if (key === 'theme') { this.paintTheme(); this.liftKey = null; this.vig = null; }
    else if (key === 'darkness') { this.liftKey = null; this.paintTheme(); }
    else if (key === 'glow') { this.glows = null; this.spots = null; }
    else if (key === 'stars') this.starsDirty = true;
    else if (key === 'quality') { this.scale = 0; this.ftimes.length = 0; if (this.resize()) this.redraw(); }
    else if (key === 'groupBy') this.regroup();
    else if (key === 'ringSpacing' || key === 'ringTilt') later(180, () => this.reflow());
    else if (key === 'belt2' || key === 'planetColors') later(180, () => this.build());
    else if (key === 'exclude') later(600, () => { this.build(); this.wSoon(); });
    this.syncToggles();
    if (this.gear) this.gearSync();
  }
  reflow() {
    const old = this.nodes, rings0 = this.rings, M0 = this.morph, e0 = M0 ? this.morphE : 1;
    if (this.intro || !old || !old.length || !rings0 || !this.rmax) { this.build(); return; }
    const was = new Map(), L0 = M0 && M0.L0;
    for (let k = 0; k < old.length; k++) {
      const n = old[k], l = n.l;
      if (!l) continue;
      const a = L0 ? L0[3 * k] : NaN;
      was.set(n, a === a ? [a + (l.x - a) * e0, L0[3 * k + 1] + (l.y - L0[3 * k + 1]) * e0, L0[3 * k + 2] + (l.z - L0[3 * k + 2]) * e0] : [l.x, l.y, l.z]);
    }
    const rkey = (r) => `${r.name}\u0001${r.outer ? 1 : 0}${r.fresh ? 1 : 0}`, rwas = new Map();
    for (const r of rings0) {
      const m = r.m0, line = r.line ? new Float32Array(r.line) : null;
      if (m && m.line && line) for (let j = 0; j < line.length; j++) line[j] = m.line[j] + (line[j] - m.line[j]) * e0;
      rwas.set(rkey(r), { incl: m ? m.incl + (r.incl - m.incl) * e0 : r.incl, radius: m ? m.radius + (r.radius - m.radius) * e0 : r.radius, line });
    }
    const from = {};
    for (const f of MORPH_NUM) from[f] = this[f];
    for (const f of MORPH_EXT) from[f] = this[f] ? { ...this[f] } : null;
    const S0 = this.sec, sec0 = S0 ? { n: S0.n, x: S0.x.slice(), y: S0.y.slice(), z: S0.z.slice() } : null;
    const c0 = this.belt2 ? this.belt2.c + this.belt2.dc : null;
    this.build();
    const N = this.nodes, L = new Float32Array(3 * N.length).fill(NaN);
    for (let k = 0; k < N.length; k++) { const p = N[k].l && was.get(N[k]); if (p) { L[3 * k] = p[0]; L[3 * k + 1] = p[1]; L[3 * k + 2] = p[2]; } }
    for (const r of this.rings) { const o = rwas.get(rkey(r)); r.m0 = o || null; r.rr = o ? o.radius : r.radius; }
    const to = {};
    for (const f of MORPH_NUM) to[f] = this[f];
    for (const f of MORPH_EXT) to[f] = this[f];
    const S1 = this.sec, sec = S1 && sec0 && sec0.n === S1.n ? { a: sec0, b: { x: S1.x.slice(), y: S1.y.slice(), z: S1.z.slice() } } : null;
    const dc = this.belt2 && c0 !== null ? c0 - this.belt2.c : 0;
    this.morph = { t0: performance.now(), L0: L, from, to, cur: {}, sec, dc };
    this.tickMorph();
  }
  tickMorph() {
    const M = this.morph;
    if (!M) { this.morphE = 1; return; }
    const k = Math.max(0, Math.min(1, (performance.now() - M.t0) / MORPH_MS)), e = k * k * (3 - 2 * k), mix = (a, b) => a + (b - a) * e;
    const end = k >= 1;
    this.morphE = end ? 1 : e;
    for (const f of MORPH_NUM) this[f] = end || typeof M.from[f] !== 'number' ? M.to[f] : mix(M.from[f], M.to[f]);
    for (const f of MORPH_EXT) {
      const a = M.from[f], b = M.to[f];
      if (end || !a || !b) { this[f] = b; continue; }
      const c = M.cur[f] || (M.cur[f] = { x: 0, up: 0, down: 0 });
      c.x = mix(a.x, b.x); c.up = mix(a.up, b.up); c.down = mix(a.down, b.down); this[f] = c;
    }
    for (const r of this.rings || []) {
      const m = r.m0;
      if (!m) continue;
      const inc = end ? r.incl : mix(m.incl, r.incl);
      r.ci = Math.cos(inc); r.si = Math.sin(inc); r.rr = end ? r.radius : mix(m.radius, r.radius);
      if (end) r.m0 = null;
    }
    const S = this.sec, Q = M.sec;
    if (S && Q) for (let i = 0; i < S.n; i++) { S.x[i] = mix(Q.a.x[i], Q.b.x[i]); S.y[i] = mix(Q.a.y[i], Q.b.y[i]); S.z[i] = mix(Q.a.z[i], Q.b.z[i]); }
    if (this.belt2) this.belt2.dc = end ? 0 : M.dc * (1 - e);
    if (end) this.morph = null;
  }
  openGear() {
    if (this.gear) return;
    const mk = (tag, cls, parent) => { const d = parent.appendChild(document.createElement(tag)); if (cls) d.className = cls; return d; };
    const g = (this.gear = mk('div', 'rn-gear', this.contentEl)), P = this.plugin;
    const head = mk('div', 'rn-gear-head', g);
    mk('span', '', head).textContent = 'SETTINGS';
    const x = mk('span', 'rn-gear-x', head); x.textContent = '✕'; x.title = 'Close (Esc)'; x.onclick = () => this.closeGear();
    this.gearRows = new Map();
    for (const o of SETTINGS) {
      if (o.hidden) continue;
      if (o.sec) { mk('div', 'rn-gsec', g).textContent = o.sec; continue; }
      const row = mk('div', 'rn-grow', g), lab = mk('div', 'rn-glabel', row);
      row.title = o.desc;
      mk('span', '', lab).textContent = o.name;
      const val = mk('b', '', lab);
      let ctl, rst = null;
      if (o.range) {
        ctl = mk('input', 'rn-grange', row); ctl.type = 'range'; ctl.min = String(o.range[0]); ctl.max = String(o.range[1]); ctl.step = String(o.range[2]);
        ctl.addEventListener('input', () => P.setSetting(o.key, +ctl.value));
        const dflt = DEFAULTS[o.key], u = o.unit || '', [lo, hi, st] = o.range;
        rst = mk('span', 'rn-greset', lab); rst.textContent = '↺'; rst.title = `Back to the default, ${dflt}${u}`; lab.insertBefore(rst, val);
        rst.onclick = () => P.setSetting(o.key, dflt);
        ctl.addEventListener('dblclick', () => P.setSetting(o.key, dflt));
        val.className = 'rn-gval'; val.title = 'Click to type the exact number';
        const box = mk('input', 'rn-gnum', lab); box.type = 'text'; box.inputMode = 'decimal'; box.classList.add('rn-hidden');
        const close = (keep) => {
          if (box.classList.contains('rn-hidden')) return;
          box.classList.add('rn-hidden'); val.classList.remove('rn-hidden');
          try { this.contentEl.focus({ preventScroll: true }); } catch {   }
          const x = parseFloat(String(box.value).replace(',', '.'));
          if (keep && Number.isFinite(x)) P.setSetting(o.key, Math.max(lo, Math.min(hi, Math.round((x - lo) / st) * st + lo)));
        };
        val.onclick = () => { val.classList.add('rn-hidden'); box.classList.remove('rn-hidden'); box.value = String(settingOf(P.settings, o.key)); box.focus(); box.select(); };
        box.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); close(true); } else if (e.key === 'Escape') { e.preventDefault(); close(false); } });
        box.addEventListener('blur', () => close(true));
      } else if (o.choice) {
        ctl = mk('div', 'rn-gchoice', row);
        for (const [v, name] of o.choice) { const b = mk('span', '', ctl); b.textContent = name; b.dataset.v = v; b.onclick = () => P.setSetting(o.key, v); }
      } else if (o.toggle) {
        ctl = mk('span', 'rn-gtoggle', lab); ctl.onclick = () => P.setSetting(o.key, !settingOf(P.settings, o.key));
      } else if (o.list) {
        ctl = mk('textarea', 'rn-glist', row); ctl.rows = 3; ctl.spellcheck = false; ctl.placeholder = 'Archive\nTemplates';
        ctl.addEventListener('input', () => P.setSetting(o.key, ctl.value.split('\n')));
      }
      this.gearRows.set(o.key, { o, ctl, val, rst });
    }
    this.gearBtn.classList.add('on');
    this.gearSync();
  }
  closeGear() {
    if (!this.gear) return;
    this.gear.remove(); this.gear = null; this.gearRows = null;
    this.gearBtn.classList.remove('on');
    try { this.contentEl.focus({ preventScroll: true }); } catch {   }
  }
  gearSync() {
    const S = this.plugin.settings;
    for (const [key, { o, ctl, val, rst }] of this.gearRows || []) {
      const v = settingOf(S, key);
      if (o.range) { if (+ctl.value !== v) ctl.value = String(v); val.textContent = `${v}${o.unit || ''}`; rst.classList.toggle('rn-off', v === DEFAULTS[key]); }
      else if (o.choice) for (const b of ctl.children) b.classList.toggle('on', b.dataset.v === v);
      else if (o.toggle) ctl.classList.toggle('on', !!v);
      else if (o.list && document.activeElement !== ctl) ctl.value = v.join('\n');
    }
  }
  findNote(q) {
    const V = this.vix; if (!V || !q) return null;
    if (!V.lnames) V.lnames = V.all.map((p) => baseName(p).toLowerCase());
    let best = -1, bt = 9, bd = -1;
    for (let i = 0; i < V.all.length; i++) {
      const nm = V.lnames[i], tier = nm === q ? 0 : nm.startsWith(q) ? 1 : nm.includes(q) ? 2 : 9;
      if (tier < bt || (tier === bt && tier < 9 && V.gdeg[i] > bd)) { best = i; bt = tier; bd = V.gdeg[i]; }
    }
    return bt < 9 ? V.all[best] : null;
  }
  goToNote(path) {
    if (!path) return;
    if (!this.byPath.has(path) && this.scopes.length > 1) { this.scopes.length = 1; this.afterScope(1); }
    this.showNote(path);
  }

  card(el, name, state, cls, rows, { down = false, foot = '', ver = null, body = null, onHead = null } = {}) {
    el.textContent = ''; el.classList.remove('rn-hidden'); el.classList.toggle('down', down); el.dataset.label = name;
    const head = el.appendChild(document.createElement('div')); head.className = 'rn-head';
    const nm = head.appendChild(document.createElement('span')); nm.className = 'rn-hname'; nm.textContent = name;
    if (onHead) { nm.classList.add('go'); nm.onclick = onHead; }
    if (ver) { const v = nm.appendChild(document.createElement('span')); v.className = 'rn-ver'; v.textContent = ver.text; v.title = ver.title; }
    if (state) { const st = head.appendChild(document.createElement('span')); st.className = cls || ''; st.textContent = state; }
    for (const r of rows) {
      const row = el.appendChild(document.createElement('div')); row.className = 'rn-kv' + (r.click ? ' click' : '') + (r.flash ? ' flash' : '');
      row.appendChild(document.createElement('span')).textContent = r.k;
      const b = row.appendChild(document.createElement('b')); b.textContent = r.v; if (r.cls) b.className = r.cls;
      if (r.title) row.title = r.title;
      if (r.click) row.onclick = r.click;
    }
    if (body) el.appendChild(body);
    if (foot) { const f = el.appendChild(document.createElement('div')); f.className = 'rn-foot'; f.textContent = foot; }
    return el;
  }
  setMoons(list) {
    const had = new Map(this.moons.map((m) => [m.key, m]));
    this.moons = list.map((m) => {
      const o = had.get(m.key);
      return Object.assign({
        r: 1.34 + 0.18 * hash(m.id + 'r'), incl: (hash(m.id + 'i') - 0.5) * 0.55,
        asc: hash(m.id + 'a') * TAU, a0: hash(m.id + 'p') * TAU, w: (0.8 + 0.4 * hash(m.id + 'w')) * 1.0e-5, sx: o ? o.sx : -99, sy: o ? o.sy : -99,
      }, m);
    });
  }
  copyText(text, label = 'copied') {
    const done = () => this.toast(label);
    const fallback = () => {
      try {
        const ta = document.body.appendChild(document.createElement('textarea'));
        ta.value = text; ta.select(); const ok = document.execCommand('copy'); ta.remove();
        this.toast(ok ? label : 'could not copy');
      } catch { this.toast('could not copy'); }
    };
    try { navigator.clipboard.writeText(text).then(done, fallback); } catch { fallback(); }
  }
  copy(m) { if (m && m.copy) this.copyText(m.copy, `${m.name} · copied`); }
  toast(text, ms = /^demo/.test(text) ? 5000 : 1600) {
    this.toastEl.textContent = text; this.toastEl.classList.add('show');
    clearTimeout(this.toastT); this.toastT = setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }
  shoot() {
    const W = this.W || 1200, H = this.H || 800, side = Math.random() < 0.5 ? -1 : 1, ang = 0.4 + Math.random() * 0.4;
    this.meteor(W * (0.2 + Math.random() * 0.6), H * (0.04 + Math.random() * 0.2), side > 0 ? ang : Math.PI - ang,
      { speed: Math.min(W, H) * 0.0005, dur: 2600, w: 2.1, a: 1, trail: 950, sparks: 1 });
  }
  meteor(x, y, heading, o) {
    this.meteors.push({
      t0: performance.now(), last: performance.now(), x, y, heading, turn: (Math.random() - 0.5) * 0.00025, fall: 0,
      speed: o.speed, dur: o.dur, w: o.w, a: o.a, trail: o.trail, train: o.trail * 2.2, sparkRate: o.sparks,
      ph: Math.random() * 9, ph2: Math.random() * 9, pts: [], sparks: [],
    });
  }
  drawMeteors(now) {
    const ctx = this.ctx;
    this.meteors = this.meteors.filter((m) => Number.isFinite(m.x) && Number.isFinite(m.y) && Number.isFinite(m.fall));
    for (const m of this.meteors) {
      const dt = Math.max(0, Math.min(50, now - m.last)), k = Math.max(0, (now - m.t0) / m.dur); m.last = Math.max(m.last, now);
      if (k < 1) {
        const near = 0.25 + 0.75 * Math.pow(k, 1.4);
        m.heading += m.turn * dt; m.fall += 0.00009 * dt;
        for (const h of this.holes) {
          const hx = h.x - m.x, hy = h.y - m.y, d = Math.hypot(hx, hy);
          if (d < h.rs) { m.t0 = now - m.dur; m.swallowed = true; break; }
          if (d < 14 * h.te) { const acc = (0.002 * h.te * h.te) / Math.max(d * d, h.rs * h.rs); m.pvx = (m.pvx || 0) + (hx / d) * acc * dt; m.pvy = (m.pvy || 0) + (hy / d) * acc * dt; }
        }
        for (const w of this.waves || []) {
          const wx = m.x - w.x, wy = m.y - w.y, d = Math.hypot(wx, wy) || 1, push = 0.0004 * Math.exp(-(((d - w.r) / 40) ** 2)) * (1 - 0.6 * Math.min(1, d / w.far));
          if (push > 1e-6) { m.pvx = (m.pvx || 0) + (wx / d) * push * dt; m.pvy = (m.pvy || 0) + (wy / d) * push * dt; m.kick = Math.max(m.kick || 0, push / 0.0004); }
        }
        if (m.kick) m.kick = Math.max(0, m.kick - dt / 600);
        m.x += (Math.cos(m.heading) * m.speed * near + (m.pvx || 0)) * dt;
        m.y += (Math.sin(m.heading) * m.speed * near + m.fall * near + (m.pvy || 0)) * dt;
        let glow = Math.min(1, k / 0.45) * (k > 0.82 ? (1 - k) / 0.18 : 1) * m.a;
        glow *= 0.8 + 0.2 * Math.sin(now / 17 + m.ph) * Math.sin(now / 41 + m.ph2);
        glow *= 1 + 0.5 * Math.exp(-(((k - 0.72) / 0.05) ** 2)) + 0.6 * (m.kick || 0);
        m.glow = glow; m.wNow = m.w * near;
        m.pts.push({ x: m.x, y: m.y, t: now, w: m.wNow, g: Math.min(1.3, glow) });
        if (Math.random() < m.sparkRate * glow * dt * 0.02) {
          const back = m.heading + Math.PI + (Math.random() - 0.5) * 0.9, v = 0.02 + Math.random() * 0.05;
          m.sparks.push({ x: m.x, y: m.y, vx: Math.cos(back) * v, vy: Math.sin(back) * v, t: now, life: 250 + Math.random() * 450, a: glow * (0.5 + 0.5 * Math.random()) });
        }
      }
      m.pts = m.pts.filter((p) => now - p.t < m.train);
      m.sparks = m.sparks.filter((s) => now - s.t < s.life);
      ctx.lineCap = 'round';
      for (let i = 1; i < m.pts.length; i++) {
        const p = m.pts[i], q = m.pts[i - 1], age = now - p.t;
        const linger = 0.13 * p.g * (1 - age / m.train);
        if (linger > 0.004) { ctx.strokeStyle = rgba(C.sand, linger); ctx.lineWidth = p.w * 1.8; ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(p.x, p.y); ctx.stroke(); }
        const f = age / m.trail;
        if (f >= 1) continue;
        const col = f < 0.25 ? '#fff6e0' : f < 0.6 ? C.sand : '#d9a46a';
        ctx.strokeStyle = rgba(col, p.g * Math.pow(1 - f, 1.6) * 0.9); ctx.lineWidth = Math.max(0.4, p.w * (1 - 0.7 * f));
        ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      }
      ctx.lineCap = 'butt';
      for (const s of m.sparks) {
        const age = now - s.t; s.vy += 0.00004 * dt; s.x += s.vx * dt; s.y += s.vy * dt;
        ctx.fillStyle = rgba(age < s.life * 0.4 ? '#fff0d0' : '#d9a46a', s.a * (1 - age / s.life)); ctx.fillRect(s.x, s.y, 1.2, 1.2);
      }
      if (k < 1 && m.glow > 0.02 && Number.isFinite(m.wNow)) {
        const r = m.wNow * 4 + 1.5, hg = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, r);
        hg.addColorStop(0, rgba('#ffffff', Math.min(1, 0.95 * m.glow))); hg.addColorStop(0.4, rgba('#fff6e0', 0.35 * m.glow)); hg.addColorStop(1, rgba(C.sand, 0));
        ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(m.x, m.y, r, 0, TAU); ctx.fill();
      }
    }
    this.meteors = this.meteors.filter((m) => (now - m.t0) / m.dur < 1 || m.pts.length || m.sparks.length);
  }

  openNote(path) { const f = this.app.vault.getAbstractFileByPath(path); if (f) this.app.workspace.getLeaf('tab').openFile(f); }

  async showNote(path, fly = true) {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!f) return;
    if (this.shown !== path) { this.flushEdit(); this.edit = null; this.countView(path); }
    this.shown = path;
    this.box.classList.add('open');
    this.fitBox();
    this.boxHead();
    const n = this.byPath.get(path);
    if (fly && n && path !== this.hub) this.fly = { from: this.yaw, to: shortTurn(this.yaw, yawToRight(n)), t0: performance.now(), dur: 900 };
    await this.renderBox(true);
  }
  boxHead() {
    const p = this.shown || '';
    for (const b of [this.openBtn, this.editBtn]) b.classList.toggle('rn-hidden', p === GRAVE);
    if (p === GRAVE) { this.boxTitle.textContent = 'Graveyard'; this.boxPath.textContent = `${this.graveyard.length} swallowed by the black hole`; return; }
    this.boxTitle.textContent = p.split('/').pop().replace(/\.md$/, '');
    this.boxPath.textContent = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : this.app.vault.getName();
  }
  get graveyard() { return this.plugin.hub.graves; }
  gravesChanged() { if (this.shown === GRAVE) { this.boxHead(); this.renderGrave(); } }
  showGraveyard() {
    this.flushEdit(); this.edit = null;
    this.shown = GRAVE;
    this.box.classList.add('open');
    this.fitBox(); this.boxHead(); this.renderGrave();
  }
  renderGrave() {
    const body = this.boxBody; body.textContent = ''; body.scrollTop = 0;
    if (!this.graveyard.length) { body.appendChild(document.createElement('p')).textContent = 'Nothing here yet. What the black hole swallows lands here.'; return; }
    const list = body.appendChild(document.createElement('div')); list.className = 'rn-grave';
    for (const g of this.graveyard) {
      const row = list.appendChild(document.createElement('div')); row.className = 'rn-grave-row';
      row.appendChild(document.createElement('b')).textContent = g.name;
      const at = new Date(g.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      row.appendChild(document.createElement('span')).textContent = g.line || at;
      if (g.copy) { row.title = 'Click to copy'; row.onclick = () => this.copy(g); }
    }
  }
  setLook(on) {
    this.look = !!on; this.contentEl.toggleClass('rn-look', this.look);
    if (this.look) { this.closeNote(); this.tip.classList.remove('show'); this.cue.classList.remove('show'); void this.cue.offsetWidth; this.cue.classList.add('show'); this.stir(); }
    else { this.cue.classList.remove('show'); clearTimeout(this.stirT); this.contentEl.toggleClass('rn-stir', false); }
  }
  stir() {
    if (!this.look) return;
    this.contentEl.toggleClass('rn-stir', true); clearTimeout(this.stirT);
    this.stirT = setTimeout(() => this.contentEl.toggleClass('rn-stir', false), 2500);
  }
  toggleLapse() {
    if (this.lapse) { this.lapse = null; return; }
    let n = 0, lo = Infinity, hi = Date.now();
    for (const nd of this.nodes) { const c = nd.file && nd.file.stat && nd.file.stat.ctime; if (c > 0) { n++; if (c < lo) lo = c; if (c > hi) hi = c; } }
    if (n < 2) return;
    this.closeNote(); this.endIntro();
    this.lapse = { t0: performance.now(), from: lo, to: hi };
  }
  closeNote() { this.flushEdit(); this.edit = null; this.shown = null; this.box.classList.remove('open'); this.boxBody.textContent = ''; if (this.boxComp) { this.removeChild(this.boxComp); this.boxComp = null; } }
  async renderBox(toTop) {
    if (this.shown === GRAVE) return this.renderGrave();
    const path = this.shown, f = path && this.app.vault.getAbstractFileByPath(path);
    if (!f) return;
    if (this.editing) return this.renderEditor(f);
    this.edit = null;
    const token = ++this.boxToken;
    try {
      const text = await this.app.vault.cachedRead(f);
      if (token !== this.boxToken) return;
      const comp = new Component(), out = document.createElement('div');
      this.addChild(comp);
      if (MarkdownRenderer.render) await MarkdownRenderer.render(this.app, text, out, path, comp);
      else await MarkdownRenderer.renderMarkdown(text, out, path, comp);
      if (token !== this.boxToken) { this.removeChild(comp); return; }
      const keep = toTop ? 0 : this.boxBody.scrollTop;
      if (this.boxComp) this.removeChild(this.boxComp);
      this.boxComp = comp;
      this.boxBody.textContent = '';
      while (out.firstChild) this.boxBody.appendChild(out.firstChild);
      this.boxBody.scrollTop = keep;
    } catch (e) { this.note(`ERROR showing ${path}: ${e && e.message ? e.message : e}`); }
  }
  boxClick(e, from = this.shown || '') {
    const a = e.target.closest && e.target.closest('a.internal-link');
    if (!a) return;
    e.preventDefault(); e.stopPropagation();
    const link = (a.getAttribute('data-href') || a.getAttribute('href') || '').split('#')[0].split('|')[0];
    if (!link) return;
    const dest = this.app.metadataCache.getFirstLinkpathDest(link, from || '');
    if (!dest) return;
    if (dest.extension === 'md') this.showNote(dest.path); else this.app.workspace.getLeaf('tab').openFile(dest);
  }
  loadBox() {
    try { const v = JSON.parse(window.localStorage.getItem(`${KEY}-box:${this.app.vault.getName()}`)); if (v && v.w > 0 && v.h > 0) return v; } catch {   }
    return null;
  }
  saveBox() {
    try { window.localStorage.setItem(`${KEY}-box:${this.app.vault.getName()}`, JSON.stringify({ w: this.box.offsetWidth, h: this.box.offsetHeight })); } catch {   }
  }
  loadViews() { try { const v = JSON.parse(window.localStorage.getItem(`${KEY}-views:${this.app.vault.getName()}`)); this.views = v && typeof v === 'object' ? v : {}; } catch { this.views = {}; } this.topAt = 0; }
  saveViews() { try { window.localStorage.setItem(`${KEY}-views:${this.app.vault.getName()}`, JSON.stringify(this.views)); } catch {   } }
  countView(path) { this.views[path] = (this.views[path] || 0) + 1; this.topAt = 0; clearTimeout(this.viewsT); this.viewsT = setTimeout(() => this.saveViews(), 2000); }
  topNames() {
    if (this.top && performance.now() - this.topAt < 5000) return this.top;
    const pin = this.plugin.hub.allPins();
    const most = Object.keys(this.views).filter((p) => this.views[p] >= 5 && !pin.includes(p) && p !== this.hub).sort((a, b) => this.views[b] - this.views[a]);
    this.top = new Set(pin.concat(most).slice(0, 10));
    this.topAt = performance.now();
    return this.top;
  }
  loadFlag(name) { try { return window.localStorage.getItem(`${KEY}-${name}:${this.app.vault.getName()}`) === '1'; } catch { return false; } }
  saveFlag(name, on) { try { window.localStorage.setItem(`${KEY}-${name}:${this.app.vault.getName()}`, on ? '1' : '0'); } catch {   } }
  syncEditBtn() { if (this.editBtn) { this.editBtn.classList.toggle('on', this.editing); this.editBtn.textContent = this.editing ? 'EDIT ON' : 'EDIT OFF'; } }
  setEditing(on) {
    this.flushEdit();
    this.editing = on; this.saveFlag('edit', on); this.syncEditBtn();
    if (this.shown && this.shown !== GRAVE) this.renderBox(false);
  }
  async renderEditor(f) {
    if (this.edit && this.edit.dirty) await this.flushEdit();
    const token = ++this.boxToken;
    try {
      const text = await this.app.vault.read(f);
      if (token !== this.boxToken) return;
      if (this.boxComp) { this.removeChild(this.boxComp); this.boxComp = null; }
      this.boxBody.textContent = ''; this.boxBody.scrollTop = 0;
      const area = this.boxBody.appendChild(document.createElement('textarea'));
      area.className = 'rn-edit'; area.spellcheck = false; area.value = text;
      const E = this.edit = { path: f.path, base: text, area, dirty: false };
      area.addEventListener('input', () => { E.dirty = true; clearTimeout(this.editT); this.editT = setTimeout(() => this.flushEdit(), 600); });
      area.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); area.blur(); this.contentEl.focus(); } });
      area.focus({ preventScroll: true }); area.setSelectionRange(0, 0);
    } catch (e) { this.note(`ERROR opening ${f.path} to edit: ${e && e.message ? e.message : e}`); }
  }
  async flushEdit() {
    const E = this.edit; clearTimeout(this.editT);
    if (!E || !E.dirty) return;
    const text = E.area.value; E.dirty = false;
    const f = this.app.vault.getAbstractFileByPath(E.path); if (!f) return;
    try {
      const cur = await this.app.vault.read(f);
      if (cur !== E.base) { E.base = cur; if (this.edit === E && !E.dirty) E.area.value = cur; this.toast('changed elsewhere · not saved'); return; }
      E.base = text;
      await this.app.vault.modify(f, text);
    } catch (e) { this.note(`ERROR saving ${E.path}: ${e && e.message ? e.message : e}`); this.toast('could not save'); }
  }
  async editChanged(f) {
    const E = this.edit; if (!E || E.path !== f.path) return;
    const cur = await this.app.vault.read(f);
    if (cur === E.base || E.dirty || this.edit !== E) return;
    const a = E.area, s0 = a.selectionStart, s1 = a.selectionEnd, top = a.scrollTop;
    E.base = cur; a.value = cur; a.setSelectionRange(Math.min(s0, cur.length), Math.min(s1, cur.length)); a.scrollTop = top;
  }
  quality(ms, t) {
    const gap = this.qLast ? t - this.qLast : 16.7; this.qLast = t;
    if (gap > 250 || this.intro) return;
    if (settingOf(this.plugin.settings, 'quality') !== 'auto') return;
    const f = this.ftimes; f.push(gap);
    if (f.length < 120) return;
    const avg = f.reduce((a, b) => a + b, 0) / f.length; f.length = 0;
    if (avg > 23 && this.dpr > this.scaleMin + 0.01) {
      this.scale = Math.max(this.scaleMin, this.dpr - 0.25); if (this.resize()) this.redraw();
      this.note(`frames slow (${avg.toFixed(1)} ms, drawing ${ms.toFixed(1)} ms): now drawn at ${this.dpr.toFixed(2)}×`);
    }
  }
  fitBox() {
    if (!this.box.classList.contains('open')) return;
    const left = this.W < 980 ? 16 : this.hasCards ? 252 : 54;
    const maxW = Math.max(200, this.W - left - 16), maxH = Math.max(120, this.H - 54 - 64);
    const want = this.boxSize || { w: Math.min(760, maxW), h: Math.round(this.H * 0.36) };
    this.box.style.width = `${Math.round(Math.min(maxW, Math.max(340, want.w)))}px`;
    this.box.style.height = `${Math.round(Math.min(maxH, Math.max(150, want.h)))}px`;
  }
  grip(handle, dx, dy) {
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const start = { x: e.clientX, y: e.clientY, w: this.box.offsetWidth, h: this.box.offsetHeight };
      this.box.classList.add('resizing');
      const move = (ev) => { this.boxSize = { w: start.w + (dx ? ev.clientX - start.x : 0), h: start.h + (dy ? ev.clientY - start.y : 0) }; this.fitBox(); };
      const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); this.box.classList.remove('resizing'); this.boxSize = { w: this.box.offsetWidth, h: this.box.offsetHeight }; this.saveBox(); };
      window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    });
  }

  toggleFocus(i) {
    this.focus = this.focus === i ? null : i;
    const ring = this.focus !== null && this.rings[this.focus];
    this.zoomTo = ring ? Math.max(1, Math.min(2.4, (this.rmax * 0.95) / (ring.radius + ring.spread * (REACH + 0.1) + 30))) : 1;
  }

  input(el) {
    const c = this.canvas; let down = null;
    const at = (e) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const labelAt = (p) => this.labelHits.find((h) => p.x >= h.x - 4 && p.x <= h.x + h.w + 4 && p.y >= h.y - 4 && p.y <= h.y + h.h + 4);
    c.addEventListener('mousedown', (e) => {
      this.endIntro();
      down = { x: e.clientX, y: e.clientY, yaw: this.yaw, pitch: this.pitch, moved: 0 }; this.fly = null; c.classList.add('dragging');
      const p = at(e), onGlobe = this.globePx && Math.hypot(p.x - this.cx, p.y - this.cy) < this.globePx;
      this.press = !labelAt(p) && !this.pickMoon(p.x, p.y) && !this.pick(p.x, p.y) && !onGlobe ? { x: p.x, y: p.y, t0: performance.now() } : null;
    });
    window.addEventListener('mouseup', this.up = (e) => {
      if (!down) return;
      c.classList.remove('dragging');
      const placed = this.press && this.press.done; this.press = null;
      if (down.moved < 5 && !placed && !this.look && !this.lapse) {
        let ringHit = null;
        const p = at(e), label = labelAt(p), moon = !label && this.pickMoon(p.x, p.y), hit = !label && !moon && this.pick(p.x, p.y);
        const hole = !moon && !hit && this.holes.find((h) => h.core && Math.hypot(p.x - h.x, p.y - h.y) < Math.max(14, h.rs * 2.2));
        if (hole) this.showGraveyard();
        else if (label) this.labelClick(label.i);
        else if (moon) this.copy(moon);
        else if (hit) this.showNote(hit.path);
        else if (this.globePx && Math.hypot(p.x - this.cx, p.y - this.cy) < this.globePx && this.hub) this.showNote(this.hub, false);
        else if ((ringHit = this.pickRing(p.x, p.y)) !== null) this.toggleFocus(ringHit);
        else if (this.focus !== null) this.toggleFocus(this.focus);
      }
      down = null;
    });
    this.register(() => window.removeEventListener('mouseup', this.up));
    c.addEventListener('mousemove', (e) => {
      this.mouse = at(e);
      if (down && e.buttons === 0) { down = null; c.classList.remove('dragging'); }
      if (down) { down.moved = Math.max(down.moved, Math.hypot(e.clientX - down.x, e.clientY - down.y)); this.yaw = down.yaw + (e.clientX - down.x) * 0.006; this.pitch = Math.max(-1.35, Math.min(1.35, down.pitch + (e.clientY - down.y) * 0.006)); }
      if (this.press && !this.press.done && down && down.moved > 5) this.press = null;
      this.lastMove = performance.now(); this.overLabel = !!labelAt(this.mouse);
      this.overHole = !this.hover && !this.hoverMoon && this.holes.some((h) => h.core && Math.hypot(this.mouse.x - h.x, this.mouse.y - h.y) < Math.max(14, h.rs * 2.2));
      c.classList.toggle('pointing', !down && !this.look && !this.lapse && !!(this.overLabel || this.hover || this.hoverMoon || this.overHole));
    });
    c.addEventListener('mouseleave', () => { this.mouse = { x: -1, y: -1 }; this.overLabel = false; });
    c.addEventListener('wheel', (e) => {
      e.preventDefault(); const cut = !!this.intro; this.endIntro();
      const z = !cut && this.zoomTo !== null ? this.zoomTo : this.zoom;
      this.zoomTo = Math.max(Math.min(this.zoomMin || ZOOM_MIN, z), Math.min(this.zoomMax || 3.2, z * Math.exp(-e.deltaY * 0.0012)));
    }, { passive: false });
    c.addEventListener('dblclick', () => { this.yaw = 0.7; this.pitch = REST_PITCH; this.zoom = this.zoomLand || this.zoomMin || INTRO_ZOOM; this.zoomTo = null; this.fly = null; this.focus = null; });
    this.q.addEventListener('input', () => { this.query = this.q.value.trim().toLowerCase(); });
    this.q.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.goToNote(this.findNote(this.query));
      if (e.key === 'Escape') { e.stopPropagation(); this.q.value = ''; this.query = ''; this.q.blur(); el.focus(); }
    });
    el.addEventListener('mousemove', () => { if (this.look) this.stir(); });
    el.addEventListener('keydown', (e) => {
      const typing = document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
      const plain = !typing && !e.ctrlKey && !e.metaKey && !e.altKey;
      if ((e.key === 'o' || e.key === 'O') && plain) { e.preventDefault(); this.setLook(!this.look); }
      if ((e.key === 't' || e.key === 'T') && plain) { e.preventDefault(); this.toggleLapse(); }
      if ((e.key === 'g' || e.key === 'G') && plain && !this.look) { e.preventDefault(); this.cycleGrouping(); }
      if (e.key === 'Enter' && !typing && this.focus !== null && !this.look) { e.preventDefault(); this.labelClick(this.focus); }
      if (e.key === 'Backspace' && plain && !this.look && this.scopes.length > 1) { e.preventDefault(); this.scopeUp(); }
      const key = plain && !this.look && e.key.length === 1 && this.plugin.hub.keys.get(e.key.toLowerCase());
      if (key) { e.preventDefault(); try { key.fn(this); } catch (err) { this.fail(`the ${e.key} key`, err); } }
      if (e.key === '/' && !typing && !this.look) { e.preventDefault(); this.q.focus(); }
      if (e.key === 'Escape' && document.activeElement !== this.q) {
        if (this.gear) { e.preventDefault(); this.closeGear(); }
        else if (this.lapse) { e.preventDefault(); this.lapse = null; }
        else if (this.look) { e.preventDefault(); this.setLook(false); }
        else if (this.shown) { e.preventDefault(); this.closeNote(); el.focus(); }
        else if (this.focus !== null) { e.preventDefault(); this.toggleFocus(this.focus); }
        else if (this.scopes.length > 1) { e.preventDefault(); this.scopeUp(); }
      }
    });
  }
  labelClick(i) {
    const ring = this.rings[i];
    if (this.focus === i && ring && ring.child && (ring.count || 0) >= 2) this.drill(ring.child);
    else this.toggleFocus(i);
  }

  pick(mx, my) {
    let best = null, bd = 144;
    for (const n of this.nodes) {
      if (n.path === this.hub || (n.v ?? 1) < 0.4) continue;
      let x = n.px, y = n.py;
      if (x === undefined || x < -9e3) { const p = this.project(n); x = p.x; y = p.y; }
      const d = ((x - mx) ** 2 + (y - my) ** 2) * (n.pl === false ? 4 : 1);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }
  pickRing(mx, my) {
    const R = this.ringXY; let best = null, bd = 64;
    if (!R) return null;
    for (let i = 1; i < R.length; i++) {
      const B = R[i]; if (!B) continue;
      for (let a = 1; a <= 120; a++) {
        const x0 = B[2 * a - 2], y0 = B[2 * a - 1], dx = B[2 * a] - x0, dy = B[2 * a + 1] - y0, l = dx * dx + dy * dy;
        const t = l > 0 ? Math.max(0, Math.min(1, ((mx - x0) * dx + (my - y0) * dy) / l)) : 0, ex = x0 + t * dx - mx, ey = y0 + t * dy - my, d = ex * ex + ey * ey;
        if (d < bd) { bd = d; best = i; }
      }
    }
    return best;
  }
  pickMoon(mx, my) {
    let best = null, bd = 11;
    if (this.lapse) return null;
    for (const m of this.moons) { const d = Math.hypot(m.sx - mx, m.sy - my); if (d < bd) { bd = d; best = m; } }
    return best;
  }

  resize() {
    const el = this.contentEl, W0 = this.W, H0 = this.H;
    this.W = Math.max(1, el.clientWidth); this.H = Math.max(1, el.clientHeight);
    if (this.W !== W0 || this.H !== H0) this.sizeAt = performance.now();
    const dev = window.devicePixelRatio || 1;
    this.scaleMin = Math.max(1, dev);
    const Q = settingOf(this.plugin.settings, 'quality');
    this.dpr = Q === 'high' ? Math.max(2, dev) : Q === 'low' ? this.scaleMin : Math.max(this.scaleMin, this.scale || Math.min(2, Math.max(dev, 1.5)));
    const cw = Math.round(this.W * this.dpr), ch = Math.round(this.H * this.dpr), fresh = this.canvas.width !== cw || this.canvas.height !== ch;
    if (fresh) { this.canvas.width = cw; this.canvas.height = ch; }
    this.contentEl.toggleClass('narrow', this.W < 980);
    if (this.box) this.fitBox();
    return fresh;
  }
  redraw() {
    const el = this.contentEl;
    if (!this.lastT || document.hidden || !el.isConnected || el.clientWidth < 2 || el.clientHeight < 2) return;
    try { this.frame(this.lastT); } catch {   }
  }
  steady() { return performance.now() - (this.sizeAt || 0) > SIZE_HOLD; }

  project(p) {
    const q = rotX(rotY(p, this.yaw), this.pitch), D = this.D || 3400;
    const s = (D / (D + q.z)) * this.k * this.zoom;
    let x = this.cx + q.x * s, y = this.cy + q.y * s;
    if (this.waves && this.waves.length) { const o = this.waveAt(x, y); x += o.x; y += o.y; }
    return { x, y, s, near: Math.max(0, Math.min(1, 1 - (q.z + this.rmax) / (2 * this.rmax))) };
  }
  waveAt(x, y) {
    const o = this.wo || (this.wo = { x: 0, y: 0 }), now = this.wnow || 0;
    o.x = 0; o.y = 0;
    for (const w of this.waves) {
      const dx = x - w.x, dy = y - w.y, d = Math.sqrt(dx * dx + dy * dy) || 1, off = d - w.r, amp = w.amp * (1 - 0.6 * Math.min(1, d / w.far));
      let m = 0;
      if (off > -170 && off < 110) m += amp * Math.exp(-(((off + 25) / 50) ** 2)) * Math.sin(off / 8 - now / 38);
      if (off < 0) { const tb = w.tab, f = -off / 2, i = f | 0; if (i < tb.length - 1) m += amp * (tb[i] + (tb[i + 1] - tb[i]) * (f - i)); }
      o.x += (dx / d) * m; o.y += (dy / d) * m;
    }
    return o;
  }
  swellTable(ph) {
    const T = this.swellTabs || (this.swellTabs = new Map());
    let tb = T.get(ph);
    if (!tb) {
      tb = new Float32Array(Math.ceil((SETTLE_MS * WAVE_SPEED) / 2) + 2);
      for (let i = 0; i < tb.length; i++) {
        const tau = (2 * i) / WAVE_SPEED;
        if (tau < SETTLE_MS) tb[i] = 0.9 * (1 - Math.exp(-tau / 500)) * Math.exp(-tau / 9000) * (1 + 0.15 * Math.sin((TAU * tau) / 5200 + ph)) * (1 - smooth01((tau - 0.6 * SETTLE_MS) / (0.4 * SETTLE_MS)));
      }
      if (T.size > 8) T.clear();
      T.set(ph, tb);
    }
    return tb;
  }
  introCam(t, dtMs) {
    const I = this.intro; if (!I) return 0;
    const Z0 = 16, BELOW = -0.87;
    if (!I.t0) {
      I.n = (I.n || 0) + 1;
      if (I.n === 2) for (const n of this.novas) this.nebulaSprite(n);
      if (I.n < 4 || ((this.lastCost || 0) > 30 && I.n < 90)) { this.zoom = Z0; this.pitch = BELOW; return 1; }
      I.t0 = t;
    }
    const e = t - I.t0, ss = (a, b, v) => { const k = Math.max(0, Math.min(1, (v - a) / (b - a))); return k * k * k * (k * (k * 6 - 15) + 10); };
    const Z1 = this.zoomLand || this.zoomMin || INTRO_ZOOM;
    if (e >= INTRO_MS) { this.intro = null; this.pitch = REST_PITCH; this.zoom = Z1; return 0; }
    const u = e / INTRO_MS, k = u * u * (6 - 8 * u + 3 * u * u), yd = 0.6 * k;
    this.zoom = Math.exp(Math.log(Z0) * (1 - k) + Math.log(Z1) * k);
    this.pitch = BELOW + (REST_PITCH - BELOW) * k;
    this.yaw += yd - (I.yd || 0); I.yd = yd;
    return 1 - ss(0, 900, e);
  }
  endIntro() { if (this.intro) { this.intro = null; this.zoomTo = this.zoomLand || this.zoomMin || INTRO_ZOOM; } }

  stepNodes(foc, WV, Cy, Sy, Cp, Sp, KZ, DD, RMX, ccx, ccy) {
    const nodes = this.nodes, rings = this.rings, RC = this.rcs, RS = this.rss, hubNode = this.hubNode;
    const big = this.big, Q = this.quota, QF = Math.max(Q, PLANET_FOCUS), mxs = this.mouse.x, mys = this.mouse.y, inView = mxs >= 0;
    const PL = this.plist || (this.plist = []);
    PL.length = 0;
    let hover = null, hd = 144 * Math.max(1, this.planetScale()) ** 2;
    const L0 = this.morph ? this.morph.L0 : null, ME = this.morphE, TL = this.tmpL || (this.tmpL = { x: 0, y: 0, z: 0 });
    for (let k = 0, M = nodes.length; k < M; k++) {
      const n = nodes[k];
      let l = n.l;
      if (L0 !== null && l) { const a = L0[3 * k]; if (a === a) { const b = L0[3 * k + 1], c = L0[3 * k + 2]; TL.x = a + (l.x - a) * ME; TL.y = b + (l.y - b) * ME; TL.z = c + (l.z - c) * ME; l = TL; } }
      if (l) {
        const ri = n.ring, ring = rings[ri];
        if (ring !== undefined && ring.w) {
          const c = RC[ri], s = RS[ri], x0 = l.x * c - l.z * s, z0 = l.x * s + l.z * c, y1 = l.y * ring.ci - z0 * ring.si, z1 = l.y * ring.si + z0 * ring.ci;
          n.x = x0 * ring.ca + z1 * ring.sa; n.y = y1; n.z = -x0 * ring.sa + z1 * ring.ca;
        }
      }
      const x = n.x, y = n.y, z = n.z, x1 = x * Cy + z * Sy, z1 = -x * Sy + z * Cy, y2 = y * Cp - z1 * Sp, z2 = y * Sp + z1 * Cp, s = (DD / (DD + z2)) * KZ;
      let px = ccx + x1 * s, py = ccy + y2 * s;
      if (WV) { const o = this.waveAt(px, py); px += o.x; py += o.y; }
      const nr = 1 - (z2 + RMX) / (2 * RMX);
      n.px = px; n.py = py; n.ps = s; n.pn = nr < 0 ? 0 : nr > 1 ? 1 : nr;
      const pl = !big || n.promo === 1 || n.rank < (n.ring === foc ? QF : Q);
      n.pl = pl;
      if (pl && n !== hubNode && n.v >= 0.02) PL.push(n);
      if (inView && n.v >= 0.4 && n !== hubNode) {
        const dx = px - mxs, dy = py - mys, d = (dx * dx + dy * dy) * (pl ? 1 : 4);
        if (d < hd) { hd = d; hover = n; }
      }
    }
    return hover;
  }
  drawSpecks(W, H, query, foc) {
    const ctx = this.ctx, nodes = this.nodes, hubNode = this.hubNode, DK = this.dK, DO = this.dOrd, DC = this.dCnt;
    const pal = this.theme().ink ? this.palette.map(inkOf) : this.palette, NB = pal.length * 8, M = nodes.length, kk = this.k;
    const ds = Math.sqrt(this.planetScale());
    const cap = Math.min(4, (3 - 1.4 * Math.max(0, Math.min(1, Math.log(this.zoom || 1) / Math.log(16)))) * ds);
    DC.fill(0);
    for (let k = 0; k < M; k++) {
      const n = nodes[k], px = n.px, py = n.py;
      if (n.pl || n.v < 0.02 || n === hubNode || px < -4 || py < -4 || px > W + 4 || py > H + 4) { DK[k] = -1; continue; }
      let a = (0.28 + 0.56 * n.pn) * n.v;
      const r0 = (SPECK * n.ps * ds) / kk;
      if (r0 < 1) a *= 0.45 + 0.55 * r0;
      if (query && !n.m) a *= 0.3;
      if (foc !== -2 && n.ring !== foc) a *= 0.25;
      const lv = Math.floor(a * 8), key = n.ci * 8 + (lv > 7 ? 7 : lv); DK[k] = key; DC[key + 1]++;
    }
    for (let k = 1; k <= NB; k++) DC[k] += DC[k - 1];
    for (let k = 0; k < M; k++) if (DK[k] >= 0) DO[DC[DK[k]]++] = k;
    for (let key = 0, s = 0; key < NB; key++) {
      const e = DC[key];
      if (e === s) continue;
      ctx.fillStyle = pal[key >> 3]; ctx.globalAlpha = ((key & 7) + 0.5) / 8; ctx.beginPath();
      for (let j = s; j < e; j++) { const n = nodes[DO[j]], r = Math.min(cap, Math.max(1, (SPECK * n.ps * ds) / kk)); ctx.rect(n.px - r / 2, n.py - r / 2, r, r); }
      ctx.fill(); s = e;
    }
    ctx.globalAlpha = 1;
  }
  drawPlanets(t, now, foc, hover, shown, hideMoons, moonP, prox) {
    const ctx = this.ctx, W = this.W, H = this.H, q = this.query, big = this.big, HB = this.plugin.hub;
    const feat = HB.allFeatured(), halos = HB.allHalos(), top = this.topNames(), PL = this.plist;
    const cl = (x) => (x < 0 ? 0 : x > 1 ? 1 : x), inFocus = (n) => foc === null || n.ring === foc;
    const TH = this.theme(), ink = TH.ink, gk = ink ? PAPER.glow : 1, dk = ink ? PAPER.dot : 1;
    PL.sort(byNear);
    const MO = moonP.length > 1 ? moonP.slice().sort((a, b) => a.p.near - b.p.near) : moonP;
    let mi = 0, font = '';
    const setFont = (f) => { if (f !== font) { ctx.font = f; font = f; } };
    const moonAt = (o) => { if (!hideMoons) { this.drawMoon(o.m, o.p, t, now, prox(o.p.x, o.p.y, 200, 30)); font = ''; } };
    const big60 = big ? 60 : Infinity;
    const zm = this.zoom || 1, zg = zm > 3.2 ? (3.2 * Math.pow(zm / 3.2, 0.4)) / zm : 1;
    const zo = Math.max(0, Math.min(1, Math.log(zm / 0.15) / Math.log(4)));
    const sz = this.planetScale();
    const sv = this.sparse || 1, zs = (zm < 1 ? Math.pow(zm, -0.85 * (sv - 1)) : 1) * (1 + 0.35 * (sv - 1)) * sz, rmin = Math.max(0.7, 1.1 * (1 + 0.8 * (sv - 1)) * sz);
    let near = null;
    if (this.mouse.x >= 0 && !this.look && settingOf(this.plugin.settings, 'nearNames')) {
      const mx = this.mouse.x, my = this.mouse.y, cand = [];
      for (const n of PL) { const d = (n.px - mx) ** 2 + (n.py - my) ** 2; if (d < 25600 && n.v >= 1) cand.push({ d, n }); }
      cand.sort((a, b) => a.d - b.d); near = new Set(cand.slice(0, 12).map((o) => o.n));
    }
    for (let pi = 0; pi <= PL.length; pi++) {
      const n = PL[pi];
      while (mi < MO.length && (!n || MO[mi].p.near < n.pn)) moonAt(MO[mi++]);
      if (!n) break;
      const v = n.v, px = n.px, py = n.py, pn = n.pn;
      let r = Math.max(rmin, (1.4 + Math.min(3.2, Math.sqrt(n.deg) * 0.5)) * (n.ps / this.k) * 1.1 * 1.12 * zg * zs);
      n.star = feat.get(n.path) || 0;
      if (n.star) r *= 1.35;
      if (this.intro) r = Math.min(r, 7 * Math.max(1, sz));
      const hv = n === hover, sh = n === shown, edge = r * 14 + 40;
      if (!sh && (px < -edge || py < -edge || px > W + edge || py > H + edge)) continue;
      let a = n.star ? 0.8 + 0.2 * pn : 0.44 + 0.56 * pn;
      if (q && !n.m) a *= 0.18;
      if (!inFocus(n)) a *= 0.15;
      if (v < 1) {
        a *= v; r *= 0.5 + 0.5 * v;
        const fr = r * (3 + 10 * (1 - v)) * 1.3;
        ctx.globalAlpha = cl(1 - v); ctx.drawImage(this.dotGlow('#fffaf0'), px - fr, py - fr, fr * 2, fr * 2); ctx.globalAlpha = 1;
      }
      const col = n.star === 2 ? '#ffffff' : ink ? inkOf(n.color) : n.color;
      const fresh = n.file && now - n.file.stat.mtime < 600000;
      if (fresh) { const h = 0.5 + 0.5 * Math.sin(t / 380 + hash(n.path) * 6); ctx.fillStyle = ink ? inkOf(C.mint) : C.mint; ctx.globalAlpha = cl(0.17 * h * a); ctx.beginPath(); ctx.arc(px, py, r * 3.4, 0, TAU); ctx.fill(); }
      const gs = this.dotGlow(col), gr = r * (n.star ? 5.6 : 4.4);
      ctx.globalAlpha = cl((n.star ? 1 : 0.62) * a * gk); ctx.drawImage(gs, px - gr, py - gr, gr * 2, gr * 2);
      ctx.fillStyle = hv || sh ? '#ffffff' : col; ctx.globalAlpha = sh ? 1 : cl(a * dk);
      ctx.beginPath(); ctx.arc(px, py, hv ? r + 1.5 : r, 0, TAU); ctx.fill();
      if (ink && r > 2.6 && !hv && !sh && PAPER.shine) { const hr = r * 0.95; ctx.globalAlpha = cl(PAPER.shine * a); ctx.drawImage(this.dotGlow(TH.bg), px - 0.3 * r - hr, py - 0.32 * r - hr, hr * 2, hr * 2); }
      if (r > 1.8 && !hv && !sh && !ink) { ctx.fillStyle = '#fffaf0'; ctx.globalAlpha = cl((n.star ? 0.85 : 0.48) * a); ctx.beginPath(); ctx.arc(px, py, r * (n.star ? 0.55 : 0.45), 0, TAU); ctx.fill(); }
      ctx.globalAlpha = 1;
      const p = this.pp || (this.pp = { x: 0, y: 0, near: 0 }); p.x = px; p.y = py; p.near = pn;
      if (!this.look && (top.has(n.path) || (near && near.has(n))) && n !== shown && !(q && n.m) && !(foc !== null && n.ring === foc)) {
        const k = prox(p.x, p.y, 220, 30);
        if (k > 0.01) { const sp = this.labelSprite(n.name, C.text2); ctx.globalAlpha = 0.9 * k * (0.5 + 0.5 * p.near) * (inFocus(n) ? 1 : 0.3); ctx.drawImage(sp, p.x + r + 5, p.y + 3 - sp.base, sp.width / sp.dpr, sp.height / sp.dpr); ctx.globalAlpha = 1; }
      }
      const hl = halos.get(n.path);
      if (hl && hl.ping) {
        const pc = typeof hl.ping === 'string' ? hl.ping : n.color, halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 4);
        halo.addColorStop(0, rgba(pc, 0.3 * a)); halo.addColorStop(1, rgba(pc, 0));
        ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(p.x, p.y, r * 4, 0, TAU); ctx.fill();
        for (const [lag, k] of [[0, 1], [500, 0.45]]) {
          const e = ((t - lag) % 2400) / 2400;
          if (e < 0) continue;
          ctx.strokeStyle = rgba(pc, 0.7 * k * a * (1 - e) ** 1.5); ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(p.x, p.y, r + 2 + 26 * e, 0, TAU); ctx.stroke();
        }
      }
      if (hl && hl.glow) {
        const h = 0.6 + 0.4 * Math.sin(t / 900), halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 5);
        halo.addColorStop(0, rgba(hl.glow, 0.4 * h * a)); halo.addColorStop(1, rgba(hl.glow, 0));
        ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(p.x, p.y, r * 5, 0, TAU); ctx.fill();
      }
      if (hl && hl.fill) {
        const h = 0.6 + 0.4 * Math.sin(t / 500), halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 5);
        halo.addColorStop(0, rgba(hl.fill, 0.45 * h)); halo.addColorStop(1, rgba(hl.fill, 0));
        ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(p.x, p.y, r * 5, 0, TAU); ctx.fill();
        ctx.fillStyle = hl.fill; ctx.beginPath(); ctx.arc(p.x, p.y, r + 1, 0, TAU); ctx.fill();
      }
      if (n.deg >= 14 && zo > 0.02) { ctx.strokeStyle = col; ctx.globalAlpha = cl(a * 0.55 * zo * (ink ? PAPER.ring : 1)); ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(px, py, r + 3.5 * zo, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1; }
      if (sh) {
        const pulse = 0.5 + 0.5 * Math.sin(t / 420);
        ctx.strokeStyle = rgba(C.sand, 0.55 + 0.3 * pulse); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(px, py, r + 6 + 2 * pulse, 0, TAU); ctx.stroke();
        ctx.fillStyle = C.sand; ctx.globalAlpha = 0.95; setFont(`10.5px ${this.mono()}`);
        const lw = ctx.measureText(n.name).width;
        ctx.fillText(n.name, px + r + 12 + lw > W - 8 ? px - r - 12 - lw : px + r + 12, py + 3.5);
      } else if (q && n.m && n.qr < big60) { ctx.fillStyle = C.sand; ctx.globalAlpha = 0.95; setFont(`10.5px ${this.mono()}`); ctx.fillText(n.name, px + r + 5, py + 3); }
      else if (foc !== null && n.ring === foc && n.rank < big60) { ctx.fillStyle = C.text2; ctx.globalAlpha = cl(0.55 + 0.4 * pn); setFont(`10px ${this.mono()}`); ctx.fillText(n.name, px + r + 5, py + 3); }
      ctx.globalAlpha = 1;
    }
  }
  beltGL() {
    if (this.glOff) return null;
    if (this.bgl) return this.bgl;
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, failIfMajorPerformanceCaveat: true });
      if (!gl) throw 0;
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (gl.getShaderParameter(s, gl.COMPILE_STATUS) !== true) throw 0; return s; };
      const pg = gl.createProgram();
      gl.attachShader(pg, sh(gl.VERTEX_SHADER, BELT_VS)); gl.attachShader(pg, sh(gl.FRAGMENT_SHADER, BELT_FS)); gl.linkProgram(pg);
      if (gl.getProgramParameter(pg, gl.LINK_STATUS) !== true) throw 0;
      gl.useProgram(pg); gl.bindVertexArray(gl.createVertexArray());
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
      const lq = gl.getAttribLocation(pg, 'q'), la = gl.getAttribLocation(pg, 'a'), lk = gl.getAttribLocation(pg, 'k'), ib = gl.createBuffer();
      gl.enableVertexAttribArray(lq); gl.vertexAttribPointer(lq, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, ib);
      gl.enableVertexAttribArray(la); gl.vertexAttribPointer(la, 4, gl.FLOAT, false, 20, 0); gl.vertexAttribDivisor(la, 1);
      gl.enableVertexAttribArray(lk); gl.vertexAttribPointer(lk, 1, gl.FLOAT, false, 20, 16); gl.vertexAttribDivisor(lk, 1);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.DITHER); gl.enable(gl.SCISSOR_TEST);
      c.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.glOff = true; this.bgl = null; });
      this.bgl = { c, gl, ib, uS: gl.getUniformLocation(pg, 'S'), uP: gl.getUniformLocation(pg, 'P'), F: new Float32Array(5 * 16384), pal: '' };
    } catch { this.glOff = true; return null; }
    return this.bgl;
  }
  drawBelts(t, W, H) {
    const ctx = this.ctx;
    const tr = this.beltTry || (this.beltTry = { f: 0, gl: [], cv: [] }), a0 = performance.now();
    let G = tr.pick === 'cv' || (!tr.pick && tr.f >= 70 && tr.f < 110) ? null : this.beltGL();
    const T = G && ctx.getTransform ? ctx.getTransform() : null, dp = T ? T.a : 1;
    if (G && (!T || T.b || T.c || T.e || T.f || Math.abs(T.a - T.d) > 1e-9)) G = null;
    const pal = G ? [C.text2, C.muted, C.sand, '#c4bdb0'] : null, pk = pal && pal.join();
    if (G && pk !== G.pal) {
      const v = pal.map(hex3);
      if (v.every(Boolean)) { G.gl.uniform3fv(G.uP, v.flat()); G.pal = pk; } else G = null;
    }
    if (G) { const need = 5 * (this.dust.length + (this.belt ? this.belt.rocks.length : 0) + (this.belt2 ? this.belt2.rocks.length : 0)); if (G.F.length < need) G.F = new Float32Array(need); }
    const F = G ? G.F : null;
    let o = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const R = this.rmax || 400, ct = Math.cos(0.07), st = Math.sin(0.07), cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const cpi = Math.cos(this.pitch), spi = Math.sin(this.pitch), kz = this.k * this.zoom, FP = this.fp || (this.fp = { x: 0, y: 0, near: 0 });
    const PD = this.D || 3400, wv = this.waves && this.waves.length;
    let nr = R;
    const fast = (x, y0, z0) => {
      const y = y0 * ct - z0 * st, z = y0 * st + z0 * ct, x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
      const y2 = y * cpi - z1 * spi, z2 = y * spi + z1 * cpi, s = (PD / (PD + z2)) * kz;
      FP.x = this.cx + x1 * s; FP.y = this.cy + y2 * s; FP.near = Math.max(0, Math.min(1, 1 - (z2 + nr) / (2 * nr)));
      if (wv) { const o = this.waveAt(FP.x, FP.y); FP.x += o.x; FP.y += o.y; }
      return FP;
    };
    for (const d of this.dust) {
      const th = d.a0 + d.w * t, p = fast(Math.cos(th) * d.r * R, d.y * R, Math.sin(th) * d.r * R);
      if (p.x < -4 || p.y < -4 || p.x > W + 4 || p.y > H + 4) continue;
      const al = Math.min(1, d.al * (0.5 + 0.5 * p.near));
      if (F) {
        F[o] = p.x * dp; F[o + 1] = p.y * dp; F[o + 2] = (d.big ? 1.25 : 1.3) * dp; F[o + 3] = al; F[o + 4] = d.big ? 3 : 0; o += 5;
        if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
        continue;
      }
      ctx.globalAlpha = al;
      if (d.big) { ctx.fillStyle = C.muted; ctx.beginPath(); ctx.arc(p.x, p.y, 1.25, 0, TAU); ctx.fill(); }
      else { ctx.fillStyle = C.text2; ctx.fillRect(p.x, p.y, 1.3, 1.3); }
    }
    for (const belt of [this.belt, this.belt2]) {
      if (!belt) continue;
      const bl = belt.rocks, n = bl.length, BX = belt.X, BY = belt.Y, BK = belt.K, cnt = belt.cnt, ord = belt.ord, dc = belt.dc || 0;
      cnt.fill(0); nr = (R * belt.c) / 1.45;
      const rz = Math.max(0.55, Math.min(1, (R * kz) / 330)), sq = 1.7 * rz, rb = 1.8 * rz, zz = (rz - 0.55) / 0.45;
      const sz = (R * kz * belt.c) / 1.45, thin = sz >= 110 ? 1 : Math.pow(sz / 110, 1.5);
      const frac = (0.75 + 0.25 * zz) * thin, af = 1 + 0.33 * zz, BD = belt.D, wm = belt.wm, DI = 1024 / TAU;
      for (let i = 0; i < n; i++) {
        const b = bl[i], D = BD[((b.a0 + (b.w - wm) * t + b.sk) * DI) & 1023], vis = (frac * D - b.u) / 0.08;
        if (vis <= 0) { BK[i] = 255; continue; }
        const th = b.a0 + b.w * t, ca = Math.cos(th), sa = Math.sin(th);
        const rr = (b.r + dc) * (1 + b.e * (ca * b.pc - sa * b.ps)) * R, p = fast(ca * rr, (b.y + b.yi * (sa * b.pc - ca * b.ps)) * R, sa * rr);
        if (p.x < -4 || p.y < -4 || p.x > W + 4 || p.y > H + 4) { BK[i] = 255; continue; }
        const lv = Math.min(9, Math.floor(10 * Math.min(1, b.al * af * (0.7 + 0.4 * D) * Math.min(1, vis) * (0.45 + 0.55 * p.near))));
        BX[i] = p.x; BY[i] = p.y; BK[i] = b.tone * 20 + (b.big ? 10 : 0) + lv; cnt[BK[i] + 1]++;
        if (F) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
      }
      for (let k = 1; k <= 40; k++) cnt[k] += cnt[k - 1];
      for (let i = 0; i < n; i++) if (BK[i] !== 255) ord[cnt[BK[i]]++] = i;
      for (let k = 0, s = 0; k < 40; k++) {
        const e = cnt[k];
        if (e === s) continue;
        const big = k % 20 >= 10, al = ((k % 10) + 0.5) / 10;
        if (F) {
          const kk = (k >= 20 ? 6 : 4) + (big ? 1 : 0), sz = (big ? rb : sq) * dp;
          for (let j = s; j < e; j++) { const i = ord[j]; F[o] = BX[i] * dp; F[o + 1] = BY[i] * dp; F[o + 2] = sz; F[o + 3] = al; F[o + 4] = kk; o += 5; }
          s = e; continue;
        }
        ctx.fillStyle = k >= 20 ? '#c4bdb0' : C.sand; ctx.globalAlpha = al;
        if (big) for (let j = s; j < e; j++) { const i = ord[j]; ctx.beginPath(); ctx.arc(BX[i], BY[i], rb, 0, TAU); ctx.fill(); }
        else for (let j = s; j < e; j++) { const i = ord[j]; ctx.fillRect(BX[i], BY[i], sq, sq); }
        s = e;
      }
      ctx.globalAlpha = 1; nr = R;
    }
    if (G && o) {
      const gl = G.gl, cw = this.canvas.width, ch = this.canvas.height;
      if (G.c.width !== cw || G.c.height !== ch) { G.c.width = cw; G.c.height = ch; }
      const bx = Math.max(0, Math.floor((x0 - 4) * dp)), by = Math.max(0, Math.floor((y0 - 4) * dp));
      const bw = Math.min(cw, Math.ceil((x1 + 6) * dp)) - bx, bh = Math.min(ch, Math.ceil((y1 + 6) * dp)) - by;
      if (bw > 0 && bh > 0) {
        gl.viewport(0, 0, cw, ch); gl.scissor(bx, ch - by - bh, bw, bh); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform2f(G.uS, cw, ch);
        gl.bindBuffer(gl.ARRAY_BUFFER, G.ib); gl.bufferData(gl.ARRAY_BUFFER, F.subarray(0, o), gl.STREAM_DRAW);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, o / 5);
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(G.c, bx, by, bw, bh, bx, by, bw, bh); ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    if (!tr.pick) {
      if (++tr.f > 30 && tr.f <= 110) (tr.f > 70 ? tr.cv : tr.gl).push(performance.now() - a0);
      if (tr.f >= 110 || (tr.f > 30 && !this.bgl)) {
        const med = (L) => (L.length ? L.sort((a, b) => a - b)[L.length >> 1] : Infinity);
        const had = !!this.bgl, g = med(tr.gl), v = med(tr.cv);
        tr.pick = had && g <= v ? 'gl' : 'cv';
        if (tr.pick === 'cv' && had) { this.dropGL(); this.glOff = true; }
        this.note(had ? `belts drawn ${tr.pick === 'gl' ? 'on the graphics card' : 'the canvas way'} (${g.toFixed(2)} vs ${v.toFixed(2)} ms a frame)` : 'belts drawn the canvas way (no WebGL 2 here)');
      }
    }
  }
  dropGL() {
    const G = this.bgl; this.bgl = null;
    if (G) try { const x = G.gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); } catch {   }
  }
  drawSky(t, W, H) {
    const ctx = this.ctx;
    const F = this.sky, ox = -((((-this.yaw * SKY_PX) % F.width) + F.width) % F.width), oy = (H - F.height) / 2 + this.pitch * 110;
    const ink = this.theme().ink, sk = ink ? PAPER.stars : 1;
    const Fi = ink ? this.inkSky(F) : F;
    ctx.globalAlpha = sk;
    ctx.drawImage(Fi, ox, oy);
    if (F.width + ox < W) ctx.drawImage(Fi, F.width + ox, oy);
    ctx.fillStyle = C.text;
    for (const s of this.twinkle) {
      let sx = s.x + ox; if (sx < 0) sx += F.width;
      if (sx > W) continue;
      ctx.globalAlpha = sk * s.a * (0.4 + 0.6 * Math.sin(t / 700 + s.ph) ** 2);
      ctx.fillRect(sx, s.y + oy, s.big ? 2 : 1, s.big ? 2 : 1);
    }
    ctx.globalAlpha = 1;
    if (this.bandImg && this.bandAt) {
      const Bi = ink ? this.inkBand(this.bandImg) : this.bandImg, L = Bi.width, th = -0.49, ax = Math.cos(th), ay = Math.sin(th), mx = W / 2, my = H / 2;
      let q = null;
      for (const kk of [-1, 0, 1]) {
        const qx = this.bandAt.x + ox + kk * F.width, qy = this.bandAt.y + oy, d = Math.abs((mx - qx) * ay - (my - qy) * ax);
        if (!q || d < q.d) q = { d, qx, qy };
      }
      const along = (mx - q.qx) * ax + (my - q.qy) * ay, s = ((along % L) + L) % L;
      const sx = q.qx + ax * (along - s), sy = q.qy + ay * (along - s);
      for (const j of [-1, 0, 1]) { ctx.save(); ctx.translate(sx + ax * L * j, sy + ay * L * j); ctx.rotate(th); ctx.drawImage(Bi, 0, -Bi.height / 2); ctx.restore(); }
    }
    ctx.globalAlpha = 1;
    if (ink && this.cx !== undefined) {
      const R = (this.outerMax || 1.8 * (this.rmax || 400)) * (this.k || 1) * (this.zoom || 1) * 1.15, q = Math.max(0.08, Math.abs(Math.sin(this.pitch || 0)));
      const ck = PAPER.clear * Math.max(0, Math.min(1, (W - R) / (0.5 * W)));
      if (R > 4 && ck > 0.01) {
        const bg = this.theme().bg;
        ctx.save(); ctx.translate(this.cx, this.cy); ctx.scale(1, q);
        const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
        gr.addColorStop(0, rgba(bg, ck)); gr.addColorStop(0.7, rgba(bg, ck)); gr.addColorStop(1, rgba(bg, 0));
        ctx.fillStyle = gr; ctx.fillRect(-R, -R, 2 * R, 2 * R); ctx.restore();
      }
    }
    this.skyOx = ox; this.skyOy = oy;
    this.drawSkyEggs(ox, oy);
  }
  frame(t) {
    const ctx = this.ctx, W = this.W, H = this.H;
    this.wnow = performance.now();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const hair = 0.99 / this.dpr, thin = (w) => Math.min(w, hair), thinA = (w) => Math.max(1, Math.min(1.6, (w * this.dpr) / 0.99));
    const S = this.plugin.settings, TH = this.theme();
    ctx.fillStyle = TH.bg; ctx.fillRect(0, 0, W, H);
    const lcx = this.cx || W * 0.5, dk = settingOf(S, 'darkness'), lkey = `${lcx.toFixed(1)}|${W}|${H}|${S.theme}|${dk}`;
    const LB = this.liftBake(W, H, TH, dk, settingOf(S, 'theme'));
    if (!LB && this.liftKey !== lkey) {
      const lift = ctx.createRadialGradient(lcx, H * 0.47, 0, lcx, H * 0.47, Math.max(W, H) * LIFT_R);
      for (let i = 0; i <= 10; i++) { const [r, g, b, a] = liftAt(i / 10, TH, 2 * (1 - dk / 100)); lift.addColorStop(i / 10, `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a.toFixed(3)})`); }
      this.lift = lift; this.liftKey = lkey;
    }
    this.back = { LB, lcx }; this.paintBack(true);
    const dtMs = Math.min(100, Math.max(0, t - (this.lastT || t))); this.lastT = t;
    const black = this.introCam(t, dtMs);
    const pointing = performance.now() - (this.lastMove || 0) < 2500 && (this.hover || this.hoverMoon || this.overLabel);
    const spinK = settingOf(S, 'spin') / 100;
    this.mt = this.mt === undefined ? t : this.mt + dtMs * spinK;
    const tm = this.mt;
    const want = this.canvas.classList.contains('dragging') || this.shown ? 0 : (pointing ? SPIN * 0.2 : SPIN) * spinK;
    this.spinV = this.spinV === undefined ? SPIN * spinK : this.spinV + (want - this.spinV) * Math.min(1, dtMs / 450);
    if (Math.abs(this.spinV - want) < 1e-7) this.spinV = want;
    if (this.fly) {
      const k = Math.min(1, (performance.now() - this.fly.t0) / this.fly.dur), e = 1 - Math.pow(1 - k, 3);
      this.yaw = this.fly.from + (this.fly.to - this.fly.from) * e;
      if (k >= 1) this.fly = null;
    } else this.yaw += this.spinV * dtMs;
    if (this.zoomTo !== null && !this.intro) {
      const lz = Math.log(this.zoomTo / this.zoom);
      if (Math.abs(lz) < 2e-4) { this.zoom = this.zoomTo; this.zoomTo = null; } else this.zoom *= Math.exp(lz * (1 - Math.exp(-dtMs / 130)));
    }
    this.spin += 0.000144 * dtMs * spinK;
    const narrow = W < 980;
    this.shift += ((this.shown && !narrow ? SHIFT : 0) - this.shift) * 0.08;
    const cyRest = H * 0.62;
    this.cx = W / 2 + this.shift;
    const HB = this.plugin.hub, G = HB.globe() || {};
    this.tickMorph();
    const R0 = this.rmax || 400, om = this.outerMax || 0, E = this.ext || { x: 1.22 * R0, up: 0.6 * R0, down: 0.8 * R0 };
    const BIG = 1.885;
    this.k = BIG * Math.min((W * 0.9) / E.x, (cyRest - 12) / E.up) * (this.grow || 1);
    const EA = this.extAll || E, fit = (X) => Math.max(ZOOM_MIN, Math.min(1, (W * 0.148) / (X.x * this.k), (H * 0.304) / ((X.up + X.down) * this.k)));
    this.zoomMin = fit(EA);
    if (this.keepK) {
      const f = this.keepK / (this.k * this.zoom), lim = (z) => Math.max(this.zoomMin, Math.min(this.zoomMax || 14, z * f));
      this.keepK = 0; this.zoom = lim(this.zoom); if (this.zoomTo !== null) this.zoomTo = lim(this.zoomTo);
    }
    const capW = this.extCore ? (W * 0.49) / (this.extCore.x * this.k) : Infinity;
    this.zoomLand = Math.max(this.zoomMin, Math.min(capW, LAND_OUT * 2.25 * Math.min(1, fit(this.extLand || EA) * 1.7 * (this.spr || 1))));
    if (this.openOut) { this.openOut = false; this.zoom = this.zoomLand; }
    const zm = this.zoomMin, lo = this.zoom < 1 && zm < 1 ? Math.min(1, Math.log(this.zoom) / Math.log(zm)) : 0;
    const cyC = H / 2 + ((EA.up - EA.down) * this.k * zm) / 2;
    this.cy = H / 2 + (cyC - H / 2) * lo * lo * (3 - 2 * lo);
    this.zoomMax = Math.max((3.2 * 1.45) / BIG, Math.min(14, (0.45 * H) / (GLOBE_R * this.k)));
    const Lz = this.zoom < 1 ? -Math.log(this.zoom) : 0;
    this.D = Math.max(3400, 1.7 * Math.max(1.8 * R0, om)) * Math.exp((Lz * Lz) / (Lz + 0.5));
    const globeColor = G.color || C.text, GB = G.breathe;
    const breathe = GB ? GB.base + GB.amp * Math.sin(t / (GB.per || 500)) : 1;
    const mp = typeof G.beat === 'number' ? Math.min(1, G.beat) : -1;
    let beat = 0;
    if (mp >= 0) {
      const per = 1600 - 700 * mp, bn = Math.floor(t / per), ph = (t % per) / per, k = 0.35 + 0.65 * mp;
      beat = k * Math.min(1, ph / 0.06) * Math.exp(-ph * 5);
      if (bn !== this.beatN) { this.beatN = bn; (this.beats || (this.beats = [])).push({ t0: t, k }); }
    }

    const I = this.intro;
    if (!this.sky || this.skyRedo || this.starsDirty || ((W > this.skyW || H > this.skyH) && (I ? !I.t0 : performance.now() - this.skyAt > 400))) this.skyStep(Math.round(W), Math.round(H));
    if (this.sky) {
      const fk = this.skyFade ? (performance.now() - this.skyFade) / SKY_FADE_MS : 1;
      if (fk >= 1) { this.skyFade = 0; this.fadeCv = null; this.drawSky(t, W, H); }
      else {
        const cv = this.canvas, Lc = this.fadeCv || (this.fadeCv = document.createElement('canvas'));
        if (Lc.width !== cv.width || Lc.height !== cv.height) { Lc.width = cv.width; Lc.height = cv.height; }
        const lg = Lc.getContext('2d');
        lg.setTransform(1, 0, 0, 1, 0, 0); lg.clearRect(0, 0, Lc.width, Lc.height); lg.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        this.ctx = lg;
        try { this.drawSky(t, W, H); } finally { this.ctx = ctx; }
        const k = Math.max(0, fk);
        ctx.globalAlpha = k * k * (3 - 2 * k); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(Lc, 0, 0);
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.globalAlpha = 1;
      }
    }
    {
      const SR = Math.max(1.8 * (this.rmax || 400), this.outerMax || 0), cyw = Math.cos(this.yaw), syw = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch), kz = this.k * this.zoom, D = this.D;
      for (const s of this.deep) {
        const x0 = s.x * SR, y0 = s.y * SR, z0 = s.z * SR, x1 = x0 * cyw + z0 * syw, z1 = -x0 * syw + z0 * cyw, y2 = y0 * cp - z1 * sp, z2 = y0 * sp + z1 * cp;
        if (D + z2 < 0.4 * D) continue;
        const sc = (D / (D + z2)) * kz, px = this.cx + x1 * sc, py = this.cy + y2 * sc;
        if (px < 0 || py < 0 || px > W || py > H) continue;
        ctx.fillStyle = s.warm ? C.sand : C.text2; ctx.globalAlpha = s.al * 0.55;
        ctx.fillRect(px, py, 1.1, 1.1);
      }
      ctx.globalAlpha = 1;
    }
    const pnow = performance.now();
    if (this.moons.length && pnow > (this.nextMeteor || 0)) {
      const vis = this.moons.filter((m) => m.sx > 0 && m.sx < W && m.sy > 0 && m.sy < H);
      if (vis.length && this.nextMeteor) {
        const m = vis[Math.floor(Math.random() * vis.length)], at = Math.random() * TAU, d = 25 + Math.random() * 90;
        this.meteor(m.sx + Math.cos(at) * d, m.sy + Math.sin(at) * d, Math.random() * TAU, { speed: 0.16 + Math.random() * 0.08, dur: 1500 + Math.random() * 600, w: 1.2, a: 0.6 + Math.random() * 0.25, trail: 600, sparks: 0.4 });
      }
      this.nextMeteor = pnow + 20000 + Math.random() * 40000;
    }
    this.drawMeteors(pnow);
    const foc = this.focus;
    this.labelHits = [];
    let lp = this.lapse, cut = Infinity, fadeW = 1, rv = null, hideMoons = false;
    if (lp) {
      const e = (performance.now() - lp.t0) / LAPSE_MS;
      if (e >= 1.08) { this.lapse = lp = null; }
      else { const k = Math.min(1, e); cut = lp.from + (lp.to - lp.from) * k * k * (3 - 2 * k) * 0.5 + (lp.to - lp.from) * k * 0.5; fadeW = (lp.to - lp.from) * 0.025; hideMoons = cut < lp.to - fadeW; }
    }
    if (lp) {
      for (const n of this.nodes) {
        const c = n.file && n.file.stat && n.file.stat.ctime;
        if (!c) { n.v = 1; continue; }
        const k = Math.max(0, Math.min(1, (cut - c) / fadeW)); n.v = k * k * (3 - 2 * k);
      }
      rv = this.rings.map(() => 0); for (const n of this.nodes) if (n.ring !== undefined && rv[n.ring] !== undefined) rv[n.ring] = Math.max(rv[n.ring], n.v);
      this.lapsed = true;
    } else if (this.lapsed) { for (const n of this.nodes) n.v = 1; this.lapsed = false; }
    const prox = (px, py, far, close) => { if (this.mouse.x < 0) return 0; const k = Math.max(0, Math.min(1, (far - Math.hypot(px - this.mouse.x, py - this.mouse.y)) / (far - close))); return k * k * (3 - 2 * k); };
    const Cy = Math.cos(this.yaw), Sy = Math.sin(this.yaw), Cp = Math.cos(this.pitch), Sp = Math.sin(this.pitch);
    const KZ = this.k * this.zoom, DD = this.D || 3400, RMX = this.rmax || 400, WV = !!(this.waves && this.waves.length), ccx = this.cx, ccy = this.cy;
    const PJ = this.pj || (this.pj = { x: 0, y: 0, s: 0, near: 0 });
    const pj = (x, y, z) => {
      const x1 = x * Cy + z * Sy, z1 = -x * Sy + z * Cy, y2 = y * Cp - z1 * Sp, z2 = y * Sp + z1 * Cp, s = (DD / (DD + z2)) * KZ;
      PJ.x = ccx + x1 * s; PJ.y = ccy + y2 * s; PJ.s = s; PJ.near = Math.max(0, Math.min(1, 1 - (z2 + RMX) / (2 * RMX)));
      if (WV) { const o = this.waveAt(PJ.x, PJ.y); PJ.x += o.x; PJ.y += o.y; }
      return PJ;
    };
    const nodes = this.nodes, rings = this.rings, NR = rings.length, RC = this.rcs, RS = this.rss;
    for (let i = 0; i < NR; i++) { const a = -(rings[i].w || 0) * tm; RC[i] = Math.cos(a); RS[i] = Math.sin(a); }
    const q = this.query, HBk = this.plugin.hub, top = this.topNames(), feat = HBk.allFeatured(), halos = HBk.allHalos();
    if (this.qNodes !== nodes || this.qKey !== q) {
      this.qNodes = nodes; this.qKey = q; this.pNodes = null;
      const hits = [];
      for (const n of nodes) { n.m = q && n.lname.includes(q) ? 1 : 0; if (n.m) hits.push(n); }
      hits.sort((a, b) => b.gdeg - a.gdeg || (a.path < b.path ? -1 : 1));
      for (let i = 0; i < hits.length; i++) hits[i].qr = i;
    }
    if (this.pNodes !== nodes || this.pF !== feat || this.pH !== halos || this.pT !== top) {
      this.pNodes = nodes; this.pF = feat; this.pH = halos; this.pT = top;
      for (const n of nodes) n.promo = 0;
      if (this.big) {
        const lift = (p) => { const n = this.byPath.get(p); if (n) n.promo = 1; }, now0 = Date.now();
        for (const p of feat.keys()) lift(p);
        for (const p of halos.keys()) lift(p);
        for (const p of top) lift(p);
        for (const n of nodes) if ((n.m && n.qr < 200) || (n.file && n.file.stat && now0 - n.file.stat.mtime < 600000)) n.promo = 1;
      }
    }
    const big = this.big;
    let hover = this.stepNodes(foc, WV, Cy, Sy, Cp, Sp, KZ, DD, RMX, ccx, ccy);
    this.ringBuf = this.ringBuf || []; this.ringXY = [];
    for (let i = 1; i < NR; i++) {
      const ring = rings[i];
      if (ring.fresh || !ring.line) continue;
      const rvk = rv ? rv[i] : 1;
      if (rvk < 0.02) continue;
      let L = ring.line;
      const LX = this.rlx || (this.rlx = new Float32Array(121)), LY = this.rly || (this.rly = new Float32Array(121)), LN = this.rln || (this.rln = new Float32Array(121));
      if (ring.m0 && ring.m0.line) {
        const A = ring.m0.line, B = L, ME = this.morphE, ML = this.rlm || (this.rlm = new Float32Array(363));
        for (let j = 0; j < 363; j++) ML[j] = A[j] + (B[j] - A[j]) * ME;
        L = ML;
      }
      for (let a = 0; a <= 120; a++) { const p = pj(L[3 * a], L[3 * a + 1], L[3 * a + 2]); LX[a] = p.x; LY[a] = p.y; LN[a] = p.near; }
      const RB = this.ringBuf[i] || (this.ringBuf[i] = new Float32Array(242));
      for (let a = 0; a <= 120; a++) { RB[2 * a] = LX[a]; RB[2 * a + 1] = LY[a]; }
      this.ringXY[i] = RB;
      const base = (foc === null ? 0.11 : foc === i ? 0.32 : 0.045) * rvk * (TH.ink ? PAPER.orbit : 1) * (ring.tone ? 1.6 : 1);
      ctx.strokeStyle = foc === i ? C.sand : ring.tone ? (TH.ink ? inkOf(ring.tone) : ring.tone) : C.text; ctx.lineWidth = thin(1);
      for (let b = 0; b < 3; b++) {
        ctx.globalAlpha = base * (0.45 + 0.35 * b) * thinA(1); ctx.beginPath();
        for (let a = 1; a <= 120; a++) if (Math.min(2, Math.floor(((LN[a - 1] + LN[a]) / 2) * 3)) === b) { ctx.moveTo(LX[a - 1], LY[a - 1]); ctx.lineTo(LX[a], LY[a]); }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      if ((ring.count || 0) < 3) continue;
      if (foc !== i && !settingOf(S, 'ringNames')) continue;
      if (this.look) continue;
      const rr = ring.m0 ? ring.rr : ring.radius;
      const th = i * 2.39 + 0.6 - ring.w * tm, lx0 = Math.cos(th) * rr, lz0 = Math.sin(th) * rr, lz1 = lz0 * ring.ci;
      const p = pj(lx0 * ring.ca + lz1 * ring.sa, -lz0 * ring.si, -lx0 * ring.sa + lz1 * ring.ca);
      const label = `${String(i).padStart(2, '0')} ${ring.name.toUpperCase()}`, sp0 = this.labelSprite(label, C.muted), lw = sp0.width / sp0.dpr - 4;
      const lx = Math.max(8, Math.min(p.x + 6, W - lw - 10)), ly = p.y - 6;
      const over = this.mouse.x >= lx - 4 && this.mouse.x <= lx + lw + 4 && this.mouse.y >= ly - 14 && this.mouse.y <= ly + 4;
      const depth = 0.45 + 0.55 * p.near;
      let al = foc === i ? 0.95 : (foc === null ? 0.5 : 0.25) * depth;
      if (foc !== i) al += (0.92 - al) * (over ? 1 : prox(lx + lw / 2, ly - 4, 200, 40));
      al *= rvk;
      const sp = foc === i ? this.labelSprite(label, C.sand) : over ? this.labelSprite(label, C.text) : sp0;
      ctx.globalAlpha = al; ctx.drawImage(sp, lx - 1, ly - sp.base, sp.width / sp.dpr, sp.height / sp.dpr); ctx.globalAlpha = 1;
      this.labelHits.push({ i, x: lx, y: ly - 10, w: lw, h: 13 });
    }
    const R = this.rmax || 400;
    this.drawBelts(tm, W, H);
    if (this.rippleQ.length && t - this.lastRipple > this.rippleGap) { const s = this.rippleQ.shift(); this.ripples.push({ t0: t, s, dur: 3000 * (0.8 + 0.25 * s) }); this.lastRipple = t; }
    this.ripples = this.ripples.filter((r) => t - r.t0 < r.dur);
    const GR = GLOBE_R;
    for (const rp of this.ripples) {
      const age = (t - rp.t0) / rp.dur, rr = GR * (1.08 + 2.6 * (0.55 + 0.45 * rp.s) * age);
      ctx.strokeStyle = rgba(globeColor, 0.22 * (0.4 + 0.6 * rp.s) * Math.pow(1 - age, 1.6) * thinA(1)); ctx.lineWidth = thin(1); ctx.beginPath();
      for (let a = 0; a <= 64; a++) { const th = (a / 64) * TAU, p = this.project({ x: Math.cos(th) * rr, y: 0, z: Math.sin(th) * rr }); if (a) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }
      ctx.stroke();
    }
    let hoverMoon = null, md = 11;
    const moonP = this.moons.map((m) => {
      const th = m.a0 + m.w * tm, p = this.project(rotY(rotX({ x: Math.cos(th) * m.r * R, y: 0, z: Math.sin(th) * m.r * R }, m.incl), m.asc), m);
      m.sx = p.x; m.sy = p.y;
      const d = Math.hypot(p.x - this.mouse.x, p.y - this.mouse.y); if (d < md && !hideMoons) { md = d; hoverMoon = m; }
      return { m, p };
    });
    if (hoverMoon) hover = null;
    this.hover = hover; this.hoverMoon = hoverMoon;
    const inFocus = (n) => foc === null || n.ring === foc;
    const shown = (this.shown && this.byPath.get(this.shown)) || null, hubNode = this.hubNode;
    if (hover && !hover.pl) { hover.pl = true; this.plist.push(hover); }
    if (shown && !shown.pl && shown !== hubNode && shown.v >= 0.02) { shown.pl = true; this.plist.push(shown); }
    const EB = this.eb || (this.eb = [[], [], [], [], [], [], [], []]);
    const LK = settingOf(S, 'links') / 5, LINES = 0.09 * LK * LK, LBU = 0.09 * LK ** 1.24;
    for (const L of EB) L.length = 0;
    const seg4 = (L, a, b) => { L.push(a.px, a.py, b.px, b.py); };
    if (!big) {
      for (const [a, b] of this.edges) {
        if (lp && (a.v < 0.03 || b.v < 0.03)) continue;
        const lit = hover && (a === hover || b === hover);
        const sel = !lit && shown && shown !== hubNode && (a === shown || b === shown);
        if (lit) { seg4(EB[7], a, b); continue; }
        if (sel) { seg4(EB[6], a, b); continue; }
        if (a === hubNode || b === hubNode) continue;
        let alpha = 0.018 + 0.045 * ((a.pn + b.pn) / 2);
        if (lp) alpha *= Math.min(a.v, b.v);
        if (q && !(a.m || b.m)) alpha *= 0.25;
        if (!inFocus(a) && !inFocus(b)) alpha *= 0.2;
        seg4(EB[Math.max(0, Math.min(5, Math.round(alpha / 0.0125)))], a, b);
      }
    } else {
      if (hover) for (const b of hover.adj) if (!lp || b.v >= 0.03) seg4(EB[7], hover, b);
      if (shown && shown !== hubNode) for (const b of shown.adj) if (b !== hover && (!lp || b.v >= 0.03)) seg4(EB[6], shown, b);
      const S = this.sec, BU = this.bundles;
      if (S && BU && BU.length && !lp && LINES > 0) {
        const g0 = pj(0, 0, 0), gx = g0.x, gy = g0.y, SX = S.px, SY = S.py;
        for (let s = 0; s < S.n; s++) {
          if (!S.c[s]) continue;
          const ri = (s / 12) | 0, ring = rings[ri]; if (!ring) continue;
          const lx = S.x[s], ly = S.y[s], lz = S.z[s], c = RC[ri], sn = RS[ri], x0 = lx * c - lz * sn, z0 = lx * sn + lz * c;
          const y1 = ly * ring.ci - z0 * ring.si, z1 = ly * ring.si + z0 * ring.ci, p = pj(x0 * ring.ca + z1 * ring.sa, y1, -x0 * ring.sa + z1 * ring.ca);
          SX[s] = p.x; SY[s] = p.y;
        }
        const dimQ = (q ? 0.4 : 1) * LBU;
        for (let key = 0; key < 8; key++) {
          const band = key >> 1, dim = key & 1;
          let any = false;
          for (const u of BU) {
            if (u.band !== band) continue;
            const off = foc !== null && ((u.a / 12) | 0) !== foc && ((u.b / 12) | 0) !== foc;
            if ((off ? 1 : 0) !== dim) continue;
            if (!any) { any = true; ctx.strokeStyle = C.text; ctx.lineWidth = thin(0.6 + 0.45 * band); ctx.globalAlpha = Math.min(1, (0.03 + 0.035 * band) * dimQ * (dim ? 0.25 : 1) * thinA(0.6 + 0.45 * band)); ctx.beginPath(); }
            const ax = SX[u.a], ay = SY[u.a], bx = SX[u.b], by = SY[u.b], mx = (ax + bx) / 2, my = (ay + by) / 2;
            ctx.moveTo(ax, ay); ctx.quadraticCurveTo(mx + (gx - mx) * 0.45, my + (gy - my) * 0.45, bx, by);
          }
          if (any) ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }
    const strokeN = (L, col, alpha, wdt) => {
      if (!L.length) return;
      ctx.strokeStyle = col; ctx.globalAlpha = Math.min(1, alpha * thinA(wdt)); ctx.lineWidth = thin(wdt); ctx.beginPath();
      for (let i = 0; i < L.length; i += 4) { ctx.moveTo(L[i], L[i + 1]); ctx.lineTo(L[i + 2], L[i + 3]); }
      ctx.stroke();
    };
    if (LINES > 0) for (let i = 0; i < 6; i++) strokeN(EB[i], C.text, LINES * 0.22 * Math.max(0.004, i * 0.0125), 0.7);
    strokeN(EB[6], C.sand, big ? 0.2 : 0.11, 0.9);
    strokeN(EB[7], C.sand, 0.6, 1.1);
    ctx.globalAlpha = 1;
    const strokeAll = (list, col, alpha, wdt) => {
      if (!list.length) return;
      ctx.strokeStyle = col; ctx.globalAlpha = Math.min(1, alpha * thinA(wdt)); ctx.lineWidth = thin(wdt); ctx.beginPath();
      for (let i = 0; i < list.length; i += 2) { ctx.moveTo(list[i].x, list[i].y); ctx.lineTo(list[i + 1].x, list[i + 1].y); }
      ctx.stroke();
    };
    const gp = this.project({ x: 0, y: 0, z: 0 });
    this.globePx = GR * gp.s;
    { const ge = this.gEnd; ge.px = gp.x; ge.py = gp.y; ge.r = GR * gp.s; ge.capY = G.caption ? 69 : 53; }
    const gR = GR * gp.s * 1.7 * (1 + 0.3 * beat), glow = ctx.createRadialGradient(gp.x, gp.y, 0, gp.x, gp.y, gR);
    glow.addColorStop(0, rgba(globeColor, Math.min(0.5, 0.095 * breathe * (1 + 2.4 * beat)))); glow.addColorStop(1, rgba(globeColor, 0));
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(gp.x, gp.y, gR, 0, Math.PI * 2); ctx.fill();
    if (this.beats && this.beats.length) {
      this.beats = this.beats.filter((b) => t - b.t0 < 1500);
      ctx.strokeStyle = C.sand; ctx.lineWidth = 1;
      for (const b of this.beats) { const e = (t - b.t0) / 1500; ctx.globalAlpha = 0.3 * b.k * (1 - e) ** 2; ctx.beginPath(); ctx.arc(gp.x, gp.y, GR * gp.s * (1.02 + 0.55 * (1 - (1 - e) ** 2)), 0, TAU); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
    const alarm = Math.max(0, Math.min(1, +G.alarm || 0)), alarmCol = G.alarmColor || '#ff3b30';
    const glitch = alarm > 0 ? this.glitchAt(t, alarm) : null;
    if (alarm > 0) this.drawAlarm(gp.x, gp.y, GR * gp.s, t, alarm, alarmCol);
    const sphere = (lat, lon) => this.project(rotY({ x: GR * Math.cos(lat) * Math.cos(lon), y: GR * Math.sin(lat), z: GR * Math.cos(lat) * Math.sin(lon) }, this.spin));
    const gBands = Array.from({ length: 10 }, () => []), gb = breathe * (1 + 0.9 * beat);
    const seg = (a, b) => { const al = (0.12 + 0.6 * ((a.near + b.near) / 2 - 0.3)) * gb; gBands[Math.max(0, Math.min(9, Math.round(al * 12)))].push(a, b); };
    for (let li = -4; li <= 4; li++) { const lat = li * (Math.PI / 10); let prev = null; for (let s = 0; s <= 56; s++) { const p = sphere(lat, (s / 56) * Math.PI * 2); if (prev) seg(prev, p); prev = p; } }
    for (let lo = 0; lo < 18; lo++) { const lon = (lo / 18) * Math.PI * 2; let prev = null; for (let s = 0; s <= 36; s++) { const p = sphere(-Math.PI / 2 + (s / 36) * Math.PI, lon); if (prev) seg(prev, p); prev = p; } }
    if (glitch) { ctx.save(); ctx.translate(glitch.dx, glitch.dy); gBands.forEach((list, i) => strokeAll(list, alarmCol, Math.max(0.01, i / 9), 0.9)); ctx.restore(); }
    gBands.forEach((list, i) => strokeAll(list, globeColor, Math.max(0.01, i / 12), 0.75));
    ctx.globalAlpha = 1;
    this.updateNova();
    this.drawNova(gp.x, gp.y, GR * gp.s, t);
    ctx.textAlign = 'center';
    const tags = this.plugin.hub.tags(), nm = this.scopeName(this.scope).toUpperCase(), ny = gp.y + GR * gp.s + 22;
    ctx.font = `11px ${this.mono()}`; ctx.fillStyle = rgba(C.text, 0.55);
    ctx.fillText(nm, gp.x, ny);
    if (tags.length) {
      const m = ctx.measureText(nm), w = (m && m.width) || nm.length * 6.6;
      ctx.textAlign = 'left'; ctx.font = `8.5px ${this.mono()}`; ctx.fillStyle = rgba(C.faint, 0.45);
      ctx.fillText(`${this.plugin.manifest.version} · ${tags.join(' · ')}`.toUpperCase(), gp.x + w / 2 + 8, ny);
      ctx.textAlign = 'center';
    }
    ctx.font = `9.5px ${this.mono()}`; ctx.fillStyle = rgba(C.faint, 0.6);
    ctx.fillText(`${this.nodes.length} NOTES · ${this.orbits === undefined ? this.rings.length - 1 : this.orbits} ORBITS`, gp.x, gp.y + GR * gp.s + 37);
    if (G.caption) {
      const cc = G.captionColor || C.salmon, gl = G.captionGlow === undefined ? 0.3 : G.captionGlow, br = 0.5 + 0.5 * Math.sin(t / 900);
      const txt = glitch ? this.scramble(String(G.caption).toUpperCase(), glitch.seed) : String(G.caption).toUpperCase(), cy = gp.y + GR * gp.s + 53;
      ctx.font = `10px ${this.mono()}`;
      if (gl > 0) {
        ctx.save(); ctx.shadowColor = rgba(cc, Math.min(1, gl * (0.65 + 0.35 * br))); ctx.shadowBlur = 5 + 11 * gl * (0.5 + 0.5 * br);
        ctx.fillStyle = rgba(cc, 0.6); ctx.fillText(txt, gp.x, cy);
        if (gl > 0.6) ctx.fillText(txt, gp.x, cy);
        ctx.restore();
      }
      ctx.fillStyle = rgba(cc, 0.75 + 0.2 * br); ctx.fillText(txt, gp.x, cy);
    }
    ctx.textAlign = 'left';
    const onGlobe = this.mouse.x >= 0 && Math.hypot(this.mouse.x - gp.x, this.mouse.y - gp.y) < GR * gp.s;
    const now = Date.now(), cl = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
    if (big) this.drawSpecks(W, H, q ? 1 : 0, foc === null ? -2 : foc);
    this.drawPlanets(t, now, foc, hover, shown, hideMoons, moonP, prox);
    if (lp) {
      const have = this.nodes.reduce((s, n) => s + (n.path !== this.hub && n.v >= 0.999 ? 1 : 0), 0);
      ctx.textAlign = 'center';
      ctx.fillStyle = rgba(C.text, 0.85); ctx.font = `13px ${this.mono()}`;
      ctx.fillText(`${new Date(cut).toLocaleDateString('en-CA')} · ${have} NOTES`, W / 2, H - 92);
      ctx.fillStyle = rgba(C.faint, 0.9); ctx.font = `9px ${this.mono()}`;
      ctx.fillText('T OR ESC · STOP', W / 2, H - 76);
      ctx.textAlign = 'left';
    }
    const enow = performance.now();
    this.drawActivity(enow);
    this.drawBlasts(enow);
    if (this.press && !this.press.done) {
      const held = enow - this.press.t0, prog = Math.min(1, (held - 250) / 850);
      if (prog > 0) {
        ctx.strokeStyle = rgba(C.sand, 0.65 * prog); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(this.press.x, this.press.y, 4 + 10 * prog, -Math.PI / 2, -Math.PI / 2 + TAU * prog); ctx.stroke();
        ctx.fillStyle = rgba('#fffaf0', 0.5 * prog); ctx.beginPath(); ctx.arc(this.press.x, this.press.y, 1.2, 0, TAU); ctx.fill();
      }
      if (held >= 1100) { this.press.done = true; this.placeStar(this.press.x, this.press.y); }
    }
    if (hover !== this.dwellOn) { this.dwellOn = hover; this.dwellT = enow; }
    const tip = (x, y, title, line, text) => {
      const key = `${title}\n${line}\n${text || ''}`;
      this.tip.classList.add('show');
      if (this.tipKey !== key) {
        this.tipKey = key; this.tip.textContent = '';
        this.tip.appendChild(document.createElement('b')).textContent = title;
        this.tip.appendChild(document.createElement('div')).textContent = line;
        if (text) { const d = this.tip.appendChild(document.createElement('div')); d.className = 'rn-tip-text'; d.textContent = text; }
        this.tipH = this.tip.offsetHeight;
      }
      this.tip.style.left = `${Math.min(W - 260, x + 14)}px`; this.tip.style.top = `${Math.max(48, Math.min(y - 14, H - (this.tipH || 0) - 8))}px`;
    };
    if (hoverMoon) {
      const m = hoverMoon;
      tip(m.sx, m.sy, m.name, `${m.tip || 'A MOON'}${m.copy ? ' · CLICK TO COPY' : ''}`);
    } else if (hover) {
      const folder = hover.path.includes('/') ? hover.path.slice(0, hover.path.lastIndexOf('/')) : 'vault';
      const f = hover.file, card = f && enow - this.dwellT > 1000 && this.shown !== hover.path ? this.firstLine(f) : null;
      tip(hover.px, hover.py, hover.name, `${folder.toUpperCase()} · ${hover.gdeg} LINKS${f ? ' · EDITED ' + ago(f.stat.mtime) : ''}`, card);
    } else if (this.overHole) {
      const n = this.graveyard.length;
      tip(this.mouse.x, this.mouse.y, 'THE BLACK HOLE', `OUT IN THE DARK · ${n} SWALLOWED · CLICK FOR THE GRAVEYARD`);
    } else if (onGlobe) {
      const sc = this.scope, what = sc.kind === 'root' ? 'THE WHOLE VAULT' : sc.kind === 'folder' ? 'A FOLDER' : sc.kind === 'tag' ? 'A TAG' : 'A CLUSTER';
      tip(this.mouse.x, this.mouse.y, this.scopeName(sc), `${what} · ${this.nodes.length} NOTES${this.hub ? ' · CLICK TO READ ' + baseName(this.hub).toUpperCase() : ''}${sc.kind === 'root' ? '' : ' · ESC · BACK'}`);
    } else this.tip.classList.remove('show');
    const vlook = `${S.theme}|${dk}|`, vkey = `${vlook}${W}|${H}`;
    if (!this.vig || (this.vig.key !== vkey && (!this.vig.key.startsWith(vlook) || this.steady()))) this.vigStep(W, H, TH, dk, vkey);
    const VG = this.vig;
    if (VG && VG.screen) { ctx.globalCompositeOperation = 'screen'; ctx.drawImage(VG.c, 0, 0, W, H); ctx.globalCompositeOperation = 'source-over'; }
    else if (VG) ctx.drawImage(VG.c, 0, 0, W, H);
    if (black > 0) { const V = TH.vig; ctx.fillStyle = `rgba(${V[0]}, ${V[1]}, ${V[2]}, ${black.toFixed(3)})`; ctx.fillRect(0, 0, W, H); }
    if (!this.lastClock || t - this.lastClock > 1000) { this.lastClock = t; this.clock.textContent = `● LIVE  ${new Date().toLocaleTimeString('en-GB')}`; }
    const bk = this.focus !== null || this.scopes.length > 1;
    if (this.backEl && bk !== this.backOn) { this.backOn = bk; this.backEl.classList.toggle('rn-hidden', !bk); }
  }
  newLiving(now, initial) {
    const S = this.sky, TW = S ? S.width : 3000, TH = S ? S.height : 1500;
    let x = 0, y = 0;
    for (let i = 0; i < 6; i++) { x = Math.random() * TW; y = Math.random() * TH; if (!this.hole || Math.random() < this.hole(x, y)) break; }
    const fin = 60000 + Math.random() * 60000, life = 180000 + Math.random() * 420000, fout = 60000 + Math.random() * 60000;
    return { x, y, a: 0.25 + Math.random() * 0.45, big: Math.random() > 0.9, fin, life, fout, t0: initial ? now - Math.random() * (fin + life + fout) : now };
  }
  loadStars() { try { const v = JSON.parse(window.localStorage.getItem(`${KEY}-stars:${this.app.vault.getName()}`)); this.userStars = Array.isArray(v) ? v.filter((s) => Date.now() - s.born < 86400000) : []; } catch { this.userStars = []; } }
  saveStars() { try { window.localStorage.setItem(`${KEY}-stars:${this.app.vault.getName()}`, JSON.stringify(this.userStars.filter((s) => !s.demo).map(({ u, v, born }) => ({ u, v, born })))); } catch {   } }
  demo() {
    if (this.demoT) this.demoT.forEach(clearTimeout);
    const W = this.W, H = this.H, say = (s) => this.toast(`demo · ${s}`);
    const step = (ms, fn) => this.demoT.push(setTimeout(() => { try { fn(); } catch (e) { this.note(`demo: ${e.message}`); } }, ms));
    const nova = (fx, fy, kind, scale) => { const n = this.newNova(W * fx, H * fy, true); n.kind = kind; n.scale = scale; this.novas.push(n); };
    this.demoT = [];
    [['crab', 'a Crab, its pulsar in the middle', 0.36, 0.3, 0.9], ['kepler', 'a Kepler shell', 0.64, 0.7, 0.7], ['veil', 'a Veil, very old, faint and far', 0.7, 0.3, 0.6],
      ['blaze', 'a Blaze', 0.56, 0.32, 1.2]]
      .forEach(([kind, text, fx, fy, sc], i) => step(i * 40000, () => { say(`${i + 1} of 4 · ${text}`); nova(fx, fy, kind, sc); }));
    step(9500, () => say('the shockwave: the system shudders as it passes, then eases back over half a minute'));
    step(160000, () => { say('a twin: now and then a second one goes off seconds later, far from the first'); nova(0.2, 0.28, 'kepler', 0.6); });
    step(163500, () => nova(0.84, 0.66, 'crab', 0.7));
    step(205000, () => { say('the spike supernova on the globe'); this.demoNovaUntil = performance.now() + 8000; });
    step(232000, () => { say('the ending, sped up: each breaks up and drifts apart (8 minutes for real)'); const end = Date.now() + 2000; for (const n of this.novas) if (n.demo) { n.endAt = end; n.endMs = 30000; } });
    step(266000, () => { say('done'); this.novas = this.novas.filter((n) => !n.demo); });
  }
  placeStar(sx, sy) {
    const F = this.sky; if (!F) return;
    const u = ((((sx - this.skyOx) % F.width) + F.width) % F.width) / F.width, v = (sy - this.skyOy) / F.height;
    this.userStars.push({ u, v, born: Date.now() });
    this.saveStars();
    this.toast('a new star · it shines for 24 hours');
  }
  drawSkyEggs(ox, oy) {
    const ctx = this.ctx, F = this.sky, TW = F.width, TH = F.height, W = this.W, H = this.H, now = Date.now(), pnow = performance.now();
    const at = (x, y) => { let sx = x + ox; if (sx < -60) sx += TW; return sx > W + 60 ? null : { x: sx, y: y + oy }; };
    this.frameNo++;
    ctx.fillStyle = C.text;
    for (let i = 0; i < this.living.length; i++) {
      const s = this.living[i], age = now - s.t0;
      if (age >= s.fin + s.life + s.fout) { this.living[i] = this.newLiving(now, false); continue; }
      for (const h of this.holes) {
        if (!h.core) continue;
        let dx = h.sx - s.x; dx -= Math.round(dx / TW) * TW; const dy = h.sy - s.y, d = Math.hypot(dx, dy);
        if (d < h.rs * 1.2) { this.living[i] = this.newLiving(now, false); break; }
        if (d < 7 * h.te) { const f = Math.min(0.04, 0.0025 * (h.te / d) ** 1.5); s.x += dx * f; s.y += dy * f; }
      }
      if (this.living[i] !== s) continue;
      const f = age < s.fin ? age / s.fin : age < s.fin + s.life ? 1 : 1 - (age - s.fin - s.life) / s.fout, p = at(s.x, s.y);
      if (!p) continue;
      ctx.globalAlpha = s.a * f; ctx.fillRect(p.x, p.y, s.big ? 2 : 1.2, s.big ? 2 : 1.2);
    }
    ctx.globalAlpha = 0.35;
    for (const r of this.remnants) { const p = at(r.u * TW, r.v * TH); if (p) ctx.fillRect(p.x - 0.6, p.y - 0.6, 1.6, 1.6); }
    ctx.globalAlpha = 1;
    this.drawHoles(at);
    const NV = settingOf(this.plugin.settings, 'novas'), nk = NV === 'rare' ? 3 : 1;
    if (!this.nextNova) this.nextNova = pnow + (300000 + Math.random() * 900000) * nk;
    if (NV === 'off') this.nextNova = Math.max(this.nextNova, pnow + 300000);
    else if (pnow > this.nextNova) {
      const x = W * (0.08 + Math.random() * 0.84), y = H * (0.08 + Math.random() * 0.84);
      this.novas.push(this.newNova(x, y, false));
      this.saveNovas();
      this.nextNova = pnow + (1200000 + Math.random() * 1500000) * nk;
      if (Math.random() < TWIN_P) this.twin = { at: pnow + 1500 + Math.random() * 3500, x, y };
    }
    if (this.twin && pnow > this.twin.at && NV !== 'off') {
      let x, y, tries = 0;
      do { x = W * (0.08 + Math.random() * 0.84); y = H * (0.08 + Math.random() * 0.84); } while (Math.hypot(x - this.twin.x, y - this.twin.y) < 0.35 * Math.hypot(W, H) && ++tries < 20);
      this.twin = null;
      this.novas.push(this.newNova(x, y, false));
      this.saveNovas();
    }
    const before = this.novas.length;
    this.novas = this.novas.filter((n) => { if (n.endAt && now - n.endAt >= n.endMs) return false; if (now - n.born < NEBULA_MS) return true; if (!n.demo) this.remnants.push({ u: n.u, v: n.v, end: n.born + NEBULA_MS, seed: n.seed, hues: n.hues, scale: n.scale || 1 }); return false; });
    if (this.novas.length !== before) { this.saveNovas(); this.saveDust(); }
    const shown = NV === 'off' ? this.novas.filter((n) => n.demo) : this.novas;
    if (NV !== 'off') this.drawDust(ox, oy, TW, TH, now);
    for (const n of shown) { const p = at(n.u * TW, n.v * TH), age = now - n.born; this.drawNebula(p, n, age); this.drawFlare(p, age, n.hue, n); }
    this.waves = [];
    const far = Math.hypot(W, H) + 80;
    for (const n of shown) {
      const r = (now - n.born - WAVE_DELAY) * WAVE_SPEED;
      if (r <= 0 || r > far + SETTLE_MS * WAVE_SPEED) continue;
      let sx = n.u * TW + ox; sx -= Math.round((sx - W / 2) / TW) * TW;
      const p = { x: sx, y: n.v * TH + oy };
      const ph = ((n.seed || 0) % 997) / 997 * TAU;
      const ws = this.novaVar(n).wave;
      this.waves.push({ x: p.x, y: p.y, r, amp: WAVE_AMP * ws, far, ph, tab: this.swellTable(ph) });
      if (r > far) continue;
      const k = (1 - r / far) * (0.55 + 0.45 * ws);
      ctx.strokeStyle = rgba(n.hue, 0.1 * k); ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.stroke();
      ctx.strokeStyle = rgba('#ffffff', 0.05 * k); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0, r - 3), 0, TAU); ctx.stroke();
    }
    this.userStars = this.userStars.filter((s) => now - s.born < 86400000);
    for (const s of this.userStars) {
      const p = at(s.u * TW, s.v * TH); if (!p) continue;
      const age = now - s.born, fade = age > 82800000 ? (86400000 - age) / 3600000 : 1;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 8);
      g.addColorStop(0, rgba(C.sand, 0.4 * fade)); g.addColorStop(1, rgba(C.sand, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, TAU); ctx.fill();
      ctx.fillStyle = rgba('#fffaf0', 0.95 * fade); ctx.beginPath(); ctx.arc(p.x, p.y, 1.4, 0, TAU); ctx.fill();
      if (age < 3000) { const e = age / 3000; ctx.strokeStyle = rgba(C.sand, 0.7 * (1 - e)); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(p.x, p.y, 4 + 46 * e, 0, TAU); ctx.stroke(); }
    }
    this.drawVisitor();
  }
  holeAt() { const s = this.holeSpot; return s ? { x: s.x, y: s.y } : null; }
  coreHoleAt() {
    const a = this.bandAt, TW = this.sky.width, ax = Math.cos(BAND_TILT), ay = Math.sin(BAND_TILT);
    const x = a.x + ax * this.coreAlong - ay * this.coreAcross, y = a.y + ay * this.coreAlong + ax * this.coreAcross;
    return { x: ((x % TW) + TW) % TW, y };
  }
  lensSprite(sx, sy, rs, teK = LENS_TE, reach = LENS_R, back = null) {
    const te = teK * rs, R = Math.ceil(reach * te), S = 2 * R, F = this.sky, TW = F.width, s0 = 1.06 * rs, s1 = 0.8 * rs;
    const comp = document.createElement('canvas'); comp.width = comp.height = S;
    const g = comp.getContext('2d');
    for (const dx of [0, -TW, TW]) g.drawImage(F, -(sx - R) + dx, -(sy - R));
    if (this.bandImg) {
      const ax = Math.cos(BAND_TILT), ay = Math.sin(BAND_TILT), L = this.bandL, bh = this.bandH;
      let best = null;
      for (const k of [-1, 0, 1]) {
        const qx = this.bandAt.x + k * TW, qy = this.bandAt.y, along = (sx - qx) * ax + (sy - qy) * ay, across = -(sx - qx) * ay + (sy - qy) * ax;
        if (!best || Math.abs(across) < Math.abs(best.across)) best = { along, across };
      }
      const s = ((best.along % L) + L) % L;
      g.save(); g.translate(R, R); g.rotate(BAND_TILT);
      for (const j of [-1, 0, 1]) g.drawImage(this.bandImg, -s + j * L, -(bh / 2 + best.across));
      g.restore();
    }
    if (back) g.drawImage(back.c, R - back.D, R - back.D);
    const src = g.getImageData(0, 0, S, S).data, out = g.createImageData(S, S), px = out.data, te2 = te * te;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = x + 0.5 - R, dy = y + 0.5 - R, r = Math.hypot(dx, dy), i = (y * S + x) * 4;
      if (r > R) continue;
      const wk = r > 0.55 * R ? 1 - smooth01((r - 0.55 * R) / (0.45 * R)) : 1;
      const sh = r < s0 ? smooth01((s0 - r) / (s0 - s1)) : 0;
      if (sh >= 1) { px[i] = 2; px[i + 1] = 2; px[i + 2] = 3; px[i + 3] = 255; continue; }
      const b = r - (te2 / r) * wk, fx = R - 0.5 + (dx / r) * b, fy = R - 0.5 + (dy / r) * b, x0 = Math.floor(fx), y0 = Math.floor(fy);
      if (x0 >= 0 && y0 >= 0 && x0 < S - 1 && y0 < S - 1) {
        const tx = fx - x0, ty = fy - y0, j = (y0 * S + x0) * 4, w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
        for (let ch = 0; ch < 4; ch++) px[i + ch] = src[j + ch] * w00 + src[j + 4 + ch] * w10 + src[j + S * 4 + ch] * w01 + src[j + S * 4 + 4 + ch] * w11;
      }
      if (sh > 0) {
        const la = px[i + 3] / 255, A = sh + (1 - sh) * la;
        for (let ch = 0; ch < 3; ch++) px[i + ch] = ((1 - sh) * la * px[i + ch] + sh * (ch === 2 ? 3 : 2)) / A;
        px[i + 3] = 255 * A;
      }
    }
    g.putImageData(out, 0, 0);
    return { c: comp, R };
  }
  paintBack(first) {
    const ctx = this.ctx, W = this.W, H = this.H, B = this.back || {}, LB = B.LB, a0 = ctx.globalAlpha;
    ctx.fillStyle = this.theme().bg; ctx.fillRect(0, 0, W, H);
    if (LB) {
      const fade = LB.from ? Math.max(0, Math.min(1, (this.wnow - LB.at) / 300)) : 1;
      if (fade < 1) this.drawBake(LB.from, W, H, B.lcx); else if (first) LB.from = null;
      ctx.globalAlpha = a0 * fade; this.drawBake(LB, W, H, B.lcx); ctx.globalAlpha = a0;
    } else if (this.lift) { ctx.fillStyle = this.lift; ctx.fillRect(0, 0, W, H); }
  }
  drawHole(sp, p) {
    const ctx = this.ctx, W = this.W, H = this.H, R = sp.R;
    if (p.x < -R || p.y < -R || p.x > W + R || p.y > H + R) return;
    ctx.save(); ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, TAU); ctx.clip(); this.paintBack(); ctx.restore();
    if (!sp.baked) {
      const cv = (sp.baked = document.createElement('canvas')), g = cv.getContext('2d');
      cv.width = cv.height = 2 * R;
      if (sp.backF) g.drawImage(sp.backF, R - sp.D, R - sp.D);
      g.drawImage(sp.c, 0, 0);
      if (sp.front) g.drawImage(sp.front, R - sp.D, R - sp.D);
    }
    ctx.drawImage(sp.baked, p.x - R, p.y - R);
    this.drawSpots(p, sp.rs, sp.te);
  }
  drawSpots(p, rs, te) {
    const ctx = this.ctx, t = performance.now(), sq = 0.22, tilt = -0.22, ct = Math.cos(tilt), st = Math.sin(tilt);
    if (!this.spots || this.spots.rs !== rs) {
      const rnd = rng(9173 + rs), list = [];
      for (let i = 0; i < 9; i++) { const rr = rs * (1.3 + 1.4 * rnd() ** 1.3); list.push({ rr, th: rnd() * TAU, w: (0.0011 * (1.3 * rs / rr) ** 1.5), a: 0.18 + 0.3 * rnd(), s: 0.5 + 0.5 * rnd() }); }
      this.spots = { rs, list, glow: this.dotGlow('#ffe6b8') };
    }
    const glow = this.spots.glow;
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.spots.list) {
      const th = s.th - s.w * t, lx = Math.cos(th) * s.rr, ly = Math.sin(th) * s.rr * sq;
      const x = p.x + lx * ct - ly * st, y = p.y + lx * st + ly * ct, dop = 0.55 + 0.45 * (-Math.cos(th));
      const sz = Math.max(2, 0.55 * rs * s.s) * (ly > 0 ? 1 : 0.8), al = s.a * dop * (0.8 + 0.2 * Math.sin(t / 900 + s.th * 7));
      const tk = te && ly < 0 ? te * smooth01(-Math.sin(th) / 0.6) : 0;
      if (tk < 0.02 * rs) {
        if (!te && ly < 0 && Math.abs(lx) < rs * 1.05) continue;
        ctx.globalAlpha = al; ctx.drawImage(glow, x - sz, y - sz, sz * 2, sz * 2);
        continue;
      }
      const ox = x - p.x, oy = y - p.y, b = Math.max(0.05 * rs, Math.hypot(ox, oy)), ang = Math.atan2(oy, ox), q = Math.sqrt(b * b + 4 * tk * tk);
      for (const sg of [1, -1]) {
        const r = (b + sg * q) / 2, ar = Math.abs(r);
        if (ar < 0.8 * rs) continue;
        const shade = ar < 1.06 * rs ? smooth01((ar - 0.8 * rs) / (0.26 * rs)) : 1;
        const tan = Math.min(6, ar / b), rad = Math.max(0.15, (1 + (sg * b) / q) / 2), n = Math.max(1, Math.ceil(tan / 1.5));
        const base = r < 0 ? ang + Math.PI : ang, half = (sz * tan) / ar, seg = ((sz * tan) / n) * 1.35;
        ctx.globalAlpha = al * shade * (n > 1 ? 0.8 : 1);
        for (let k = 0; k < n; k++) {
          const a2 = base + (n === 1 ? 0 : (-1 + (2 * k) / (n - 1)) * half * 0.75);
          ctx.translate(p.x + Math.cos(a2) * ar, p.y + Math.sin(a2) * ar); ctx.rotate(a2);
          ctx.drawImage(glow, -sz * rad, -seg, 2 * sz * rad, 2 * seg);
          ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        }
      }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  discSprites(rs) {
    const ro = 3.2 * rs, sq = 0.22, D = Math.ceil(ro + 10), S = 2 * D, tilt = -0.22, warm = '226,196,150';
    const make = (top) => {
      const cv = document.createElement('canvas'); cv.width = cv.height = S;
      const g = cv.getContext('2d'); g.filter = `blur(${Math.max(0.7, rs / 10).toFixed(1)}px)`; g.translate(D, D); g.rotate(tilt);
      g.save(); g.beginPath(); g.rect(-D, top ? -D : 0, 2 * D, D); g.clip(); g.scale(1, sq);
      const rg = g.createRadialGradient(0, 0, 1.2 * rs, 0, 0, ro);
      rg.addColorStop(0, `rgba(${warm},0)`); rg.addColorStop(0.08, `rgba(${warm},0.55)`); rg.addColorStop(0.35, `rgba(${warm},0.2)`); rg.addColorStop(1, `rgba(${warm},0)`);
      g.fillStyle = rg; g.beginPath(); g.arc(0, 0, ro, 0, TAU); g.fill(); g.restore();
      g.globalCompositeOperation = 'destination-in';
      const lg = g.createLinearGradient(-ro, 0, ro, 0); lg.addColorStop(0, 'rgba(0,0,0,1)'); lg.addColorStop(0.5, 'rgba(0,0,0,0.7)'); lg.addColorStop(1, 'rgba(0,0,0,0.3)');
      g.fillStyle = lg; g.fillRect(-D, -D, 2 * D, 2 * D);
      g.globalCompositeOperation = 'source-over';
      return cv;
    };
    const back = make(true), part = (lensed) => {
      const cv = document.createElement('canvas'); cv.width = cv.height = S;
      const g = cv.getContext('2d'); g.drawImage(back, 0, 0);
      g.globalCompositeOperation = 'destination-in'; g.translate(D, D); g.rotate(tilt);
      const lg = g.createLinearGradient(-ro, 0, ro, 0);
      for (let i = 0; i <= 16; i++) { const w = Math.exp(-((((i / 8 - 1) * ro) / (1.9 * rs)) ** 2)); lg.addColorStop(i / 16, `rgba(0,0,0,${(lensed ? w : 1 - w).toFixed(3)})`); }
      g.fillStyle = lg; g.fillRect(-2 * D, -2 * D, 4 * D, 4 * D);
      return cv;
    };
    return { back, backL: part(true), backF: part(false), front: make(false), D };
  }
  drawHoles(at) {
    const W = this.W, H = this.H, pnow = performance.now(), ctx = this.ctx;
    this.holes = [];
    if (!settingOf(this.plugin.settings, 'blackHole')) { this.visitor = null; return; }
    const c = this.holeAt();
    if (c) {
      const rs = holeSize(this.graveyard.length), p = at(c.x, c.y);
      if (!this.holeSprite || this.holeSprite.rs !== rs || this.holeSprite.sky !== this.sky) {
        const ds = this.discSprites(rs);
        this.holeSprite = { ...this.lensSprite(c.x, c.y, rs, GRAVE_TE, GRAVE_R, { c: ds.backL, D: ds.D }), front: ds.front, backF: ds.backF, D: ds.D, rs, te: GRAVE_TE * rs, sky: this.sky };
      }
      if (p) this.drawHole(this.holeSprite, p);
      this.holes.push({ x: p ? p.x : -9999, y: p ? p.y : -9999, sx: c.x, sy: c.y, rs, te: LENS_TE * rs, core: true });
    }
    const wall = Date.now(), visitKey = `${KEY}-visitor:${this.app.vault.getName()}`;
    const nextVisit = () => wall + VISIT_GAP + Math.random() * VISIT_SPREAD;
    if (!this.nextVisitor) {
      let due = 0; try { due = +window.localStorage.getItem(visitKey) || 0; } catch {   }
      if (!due) { due = nextVisit(); try { window.localStorage.setItem(visitKey, String(due)); } catch {   } }
      this.nextVisitor = due > wall ? due : wall + 300000 + Math.random() * 3300000;
    }
    if (!this.visitor && wall > this.nextVisitor) {
      this.visitor = this.newVisitor(80000); this.nextVisitor = nextVisit();
      try { window.localStorage.setItem(visitKey, String(this.nextVisitor)); } catch {   }
    }
    const v = this.visitor;
    if (v) {
      const k = (pnow - v.t0) / v.dur;
      if (k >= 1) this.visitor = null;
      else {
        const F = this.sky, sx = (((v.x0 + (v.x1 - v.x0) * k) % F.width) + F.width) % F.width, sy = v.y0 + (v.y1 - v.y0) * k;
        const p = at(sx, sy), alpha = Math.min(1, k / 0.1, (1 - k) / 0.1);
        if (p) { this.visitorAt = { x: p.x, y: p.y, rs: v.rs, te: LENS_TE * v.rs, alpha }; this.holes.push({ x: p.x, y: p.y, sx, sy, rs: v.rs, te: LENS_TE * v.rs * alpha }); }
      }
    }
  }
  drawVisitor() {
    const L = this.visitorAt; this.visitorAt = null;
    if (!L || L.alpha <= 0) return;
    const d = this.dpr || 1, cw = this.canvas.width, ch = this.canvas.height, cx = L.x * d, cy = L.y * d;
    const R = LENS_R * L.te * d, te2 = (L.te * d) ** 2, rs = L.rs * d, a = L.alpha;
    const x0 = Math.max(0, Math.floor(cx - R)), y0 = Math.max(0, Math.floor(cy - R)), w = Math.min(cw, Math.ceil(cx + R)) - x0, h = Math.min(ch, Math.ceil(cy + R)) - y0;
    if (w < 2 || h < 2) return;
    const sc = this.lensCv || (this.lensCv = document.createElement('canvas')), sg = this.lensG || (this.lensG = sc.getContext('2d', { willReadFrequently: true }));
    if (sc.width < w || sc.height < h) { sc.width = Math.max(sc.width, w); sc.height = Math.max(sc.height, h); }
    sg.clearRect(0, 0, w, h); sg.drawImage(this.canvas, x0, y0, w, h, 0, 0, w, h);
    const img = sg.getImageData(0, 0, w, h), px = img.data, src = new Uint8ClampedArray(px);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = x0 + x + 0.5 - cx, dy = y0 + y + 0.5 - cy, r = Math.hypot(dx, dy), i = (y * w + x) * 4;
      if (r > R) continue;
      if (r < 0.8 * rs) { const s = 1 - a; px[i] *= s; px[i + 1] *= s; px[i + 2] *= s; continue; }
      const wk = r > 0.55 * R ? 1 - smooth01((r - 0.55 * R) / (0.45 * R)) : 1;
      const b = r - (te2 / r) * wk, fx = cx + (dx / r) * b - x0 - 0.5, fy = cy + (dy / r) * b - y0 - 0.5, xi = Math.floor(fx), yi = Math.floor(fy);
      if (xi < 0 || yi < 0 || xi >= w - 1 || yi >= h - 1) continue;
      const tx = fx - xi, ty = fy - yi, j = (yi * w + xi) * 4, k = a;
      const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
      const s = r < 1.06 * rs ? 1 - a * smooth01((1.06 * rs - r) / (0.26 * rs)) : 1;
      for (let c = 0; c < 3; c++) px[i + c] = (src[i + c] * (1 - k) + (src[j + c] * w00 + src[j + 4 + c] * w10 + src[j + w * 4 + c] * w01 + src[j + w * 4 + 4 + c] * w11) * k) * s;
    }
    sg.putImageData(img, 0, 0);
    const vc = this.ctx; vc.save(); vc.setTransform(1, 0, 0, 1, 0, 0); vc.globalAlpha = 1; vc.globalCompositeOperation = 'source-over';
    vc.drawImage(sc, 0, 0, w, h, x0, y0, w, h); vc.restore();
  }
  newVisitor(dur) {
    const W = this.W, H = this.H, F = this.sky, left = Math.random() < 0.5;
    const toSky = (x, y) => ({ x: x - (this.skyOx || 0), y: y - (this.skyOy || 0) });
    const a = toSky(left ? -80 : W + 80, H * (0.15 + Math.random() * 0.7)), b = toSky(left ? W + 80 : -80, H * (0.15 + Math.random() * 0.7));
    return { t0: performance.now(), dur, x0: a.x, y0: a.y, x1: b.x, y1: b.y, rs: 4 + Math.random() * 2.5, sprite: null, F };
  }
  newNova(sx, sy, demo) {
    const F = this.sky, cols = [C.salmon, C.sky, C.lilac, C.mint, C.sand], i = Math.floor(Math.random() * cols.length), j = (i + 1 + Math.floor(Math.random() * (cols.length - 1))) % cols.length;
    const KINDS = ['crab', 'kepler', 'veil', 'blaze'], bagKey = `${KEY}-novabag:${this.app.vault.getName()}`;
    let kind;
    if (demo) kind = KINDS[Math.floor(Math.random() * KINDS.length)];
    else {
      let bag = this.novaBag;
      if (!Array.isArray(bag)) try { bag = JSON.parse(window.localStorage.getItem(bagKey)); } catch {   }
      if (!Array.isArray(bag) || !bag.length || !bag.every((k) => KINDS.includes(k))) { bag = KINDS.slice(); for (let i = KINDS.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; } }
      kind = bag.pop(); this.novaBag = bag;
      try { window.localStorage.setItem(bagKey, JSON.stringify(bag)); } catch {   }
    }
    const scale = kind === 'veil' ? 0.55 + 0.15 * Math.random() : kind === 'blaze' ? 0.55 + 0.2 * Math.random() : Math.random() < 0.35 ? 0.85 + 0.15 * Math.random() : 0.4 + 0.3 * Math.random();
    return { u: ((((sx - this.skyOx) % F.width) + F.width) % F.width) / F.width, v: (sy - this.skyOy) / F.height, born: Date.now(), seed: Math.floor(Math.random() * 1e9), hue: Math.random() < 0.5 ? C.sky : C.sand, hues: [cols[i], cols[j]], rot: Math.random() * TAU, kind, scale, demo };
  }
  loadNovas() {
    try {
      const v = JSON.parse(window.localStorage.getItem(`${KEY}-novas:${this.app.vault.getName()}`));
      this.novas = Array.isArray(v) ? v.filter((n) => Date.now() - n.born < NEBULA_MS && Number.isFinite(n.u) && Number.isFinite(n.v) && n.kind !== 'ring') : [];
      for (const n of this.novas) if (n.kind === 'veil' && n.scale > 1) n.scale *= 0.45;
      for (const n of this.novas) if (n.kind === 'blaze' && n.scale > 0.8) n.scale *= 0.58;
    } catch { this.novas = []; }
    try {
      const now = Date.now(), d = JSON.parse(window.localStorage.getItem(`${KEY}-dust:${this.app.vault.getName()}`)), v = JSON.parse(window.localStorage.getItem(`${KEY}-novas:${this.app.vault.getName()}`));
      this.remnants = Array.isArray(d) ? d.filter((r) => Number.isFinite(r.u) && Number.isFinite(r.v) && now - r.end < DUST_MS) : [];
      if (Array.isArray(v)) for (const n of v) {
        const end = n.born + NEBULA_MS;
        if (now >= end && now - end < DUST_MS && Number.isFinite(n.u) && Number.isFinite(n.v) && !this.remnants.some((r) => r.seed === n.seed)) this.remnants.push({ u: n.u, v: n.v, end, seed: n.seed, hues: n.hues, scale: n.scale || 1 });
      }
    } catch { this.remnants = []; }
  }
  saveNovas() {
    const keep = this.novas.filter((n) => !n.demo).map(({ u, v, born, seed, hue, hues, rot, kind, scale }) => ({ u, v, born, seed, hue, hues, rot, kind, scale }));
    try { window.localStorage.setItem(`${KEY}-novas:${this.app.vault.getName()}`, JSON.stringify(keep)); } catch {   }
  }
  saveDust() {
    const now = Date.now();
    this.remnants = this.remnants.filter((r) => r.end && now - r.end < DUST_MS);
    try { window.localStorage.setItem(`${KEY}-dust:${this.app.vault.getName()}`, JSON.stringify(this.remnants)); } catch {   }
  }
  drawDust(ox, oy, TW, TH, now) {
    const list = [], half = NEBULA_MS / 2, W = this.W;
    for (const n of this.novas) if (!n.demo && now - n.born > half) list.push({ r: n, end: n.born + NEBULA_MS });
    for (const r of this.remnants) if (r.seed && now - r.end < DUST_MS) list.push({ r, end: r.end });
    if (!list.length) return;
    list.sort((a, b) => b.end - a.end);
    const ctx = this.ctx;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < list.length; i++) {
      const { r, end } = list[i], t = now - end;
      let a = DUST_A * (t < 0 ? smooth01(1 + t / half) : (1 - t / DUST_MS) ** 2);
      if (i >= DUST_MAX) a *= 1 - smooth01((now - (list[i - DUST_MAX].end - half)) / half);
      if (a < 0.002) continue;
      const size = 180 * (r.scale || 1) * (1 + (0.3 * Math.max(0, t)) / DUST_MS);
      let x = r.u * TW + ox; x -= Math.round((x - W / 2) / TW) * TW;
      const y = r.v * TH + oy;
      if (x + size < 0 || x - size > W) continue;
      ctx.globalAlpha = a; ctx.drawImage(this.dustSprite(r), x - size, y - size, size * 2, size * 2);
    }
    ctx.restore();
  }
  dustSprite(r) {
    const cache = this.dustImgs || (this.dustImgs = new Map());
    let c = cache.get(r.seed);
    if (c) return c;
    if (cache.size > 12) cache.clear();
    c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), R = rng((r.seed || 1) + 404), hues = r.hues || [C.sand, C.sky];
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) {
      const ang = R() * TAU, d = 10 * Math.sqrt(R()), x = 32 + Math.cos(ang) * d, y = 32 + Math.sin(ang) * d, rr = 9 + 11 * R();
      const col = mixHex(hues[i % 2] || C.sand, '#a89f8f', 0.45), gr = g.createRadialGradient(x, y, 0, x, y, rr);
      gr.addColorStop(0, rgba(col, 0.35)); gr.addColorStop(0.5, rgba(col, 0.15)); gr.addColorStop(1, rgba(col, 0));
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    }
    cache.set(r.seed, c);
    return c;
  }
  firstLine(f) {
    const c = this.lines || (this.lines = new Map()), e = c.get(f.path), m = f.stat.mtime;
    if (!e || e.mtime !== m) {
      c.set(f.path, { mtime: m, text: e ? e.text : null });
      const name = f.basename || f.path.replace(/^.*\//, '').replace(/\.md$/i, '');
      this.app.vault.cachedRead(f).then((s) => c.set(f.path, { mtime: m, text: firstLineOf(s, name) }), () => {});
    }
    return c.get(f.path).text;
  }
  nebulaSprite(n) {
    if (n.sprite) return n.sprite;
    const veil = n.kind === 'veil', blaze = n.kind === 'blaze', S = veil || blaze ? 320 : 220, m = S / 2, c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d'), im = g.createImageData(S, S), px = im.data, sd = n.seed % 997, face = rng(n.seed)() * TAU;
    const SV = rng(n.seed + 131), squash = SV();
    const smooth = (e0, e1, v) => { const k = Math.max(0, Math.min(1, (v - e0) / (e1 - e0))); return k * k * (3 - 2 * k); };
    const ridge = (v, p) => Math.pow(1 - Math.min(1, Math.abs(2 * v - 1) * 1.3), p);
    const put = (i, r, gg, b, a) => { px[i] = r; px[i + 1] = gg; px[i + 2] = b; px[i + 3] = Math.min(255, a); };
    const kepler = n.kind === 'kepler';
    const arcs = [];
    if (veil) {
      const Rv = rng(n.seed + 7);
      for (const [ctr, cnt] of [[face, 3], [face + Math.PI, 2], [face + Math.PI / 2 + Rv(), 1]]) for (let k = 0; k < cnt; k++) {
        const j = arcs.length, c0 = ctr + (Rv() - 0.5) * 0.9, half = (0.45 + Rv() * 0.5) * (cnt === 1 ? 0.6 : 1), r0 = 0.6 + Rv() * 0.25;
        const wander = new Float32Array(720), bright = new Float32Array(720), offs = [0, 1, 2].map(() => new Float32Array(720));
        for (let b = 0; b < 720; b++) {
          const th = (b / 720) * TAU, ca = Math.cos(th), sa = Math.sin(th);
          wander[b] = r0 + 0.07 * (fbm(ca * 2.2 + j * 7, sa * 2.2 + j * 7, sd + 60 + j * 3) - 0.5) * 2;
          bright[b] = (cnt === 1 ? 0.5 : 1) * (0.25 + 0.75 * smooth(0.35, 0.68, fbm(ca * 3.5 + j * 5, sa * 3.5 + j * 5, sd + 90 + j * 3)));
          for (let s = 0; s < 3; s++) offs[s][b] = (s - 1) * 0.016 + 0.014 * (fbm(ca * 6 + s * 3 + j, sa * 6 + j, sd + 120 + j * 9 + s * 3) - 0.5) * 2;
        }
        arcs.push({ c0, half, wander, bright, offs, red: Rv() < 0.5 });
      }
    }
    const jet = face + 1.75, jc = Math.cos(jet), js = Math.sin(jet);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      if (veil) {
        const dx = (x - m) / m, dy = (y - m) / m, r = Math.hypot(dx, dy);
        if (r > 1) continue;
        if (r < 0.35) continue;
        const th = Math.atan2(dy, dx), b = Math.floor((((th + TAU) % TAU) / TAU) * 720) % 720;
        let tB = 0, tR = 0;
        for (const A of arcs) {
          const dl = Math.abs(((((th - A.c0) % TAU) + TAU + Math.PI) % TAU) - Math.PI), base = A.wander[b];
          if (dl > A.half || Math.abs(r - base) > 0.12) continue;
          const win = smooth(A.half, A.half * 0.55, dl) * A.bright[b];
          for (let s = 0; s < 3; s++) {
            const d = r - base - A.offs[s][b], v = win * (Math.exp(-((d / 0.009) ** 2)) + 0.12 * Math.exp(-((d / 0.04) ** 2)));
            if ((s === 1) !== A.red) tR += v; else tB += v;
          }
        }
        const a = tB + tR; if (a < 0.01) continue;
        const knot = 0.7 + 0.6 * fbm(x / 5 + sd, y / 5, sd + 140);
        put(i, (126 * tB + 232 * tR) / a, (206 * tB + 122 * tR) / a, (222 * tB + 112 * tR) / a, a * knot * 150 * smooth(1, 0.92, r));
      } else if (blaze) {
        const dx = (x - m) / m, dy = (y - m) / m, r = Math.hypot(dx, dy);
        if (r > 1) continue;
        const tb = fbm(x / 16 + sd, y / 16, sd + 40), da = Math.abs(((((Math.atan2(dy, dx) - face) % TAU) + TAU + Math.PI) % TAU) - Math.PI);
        const fan = 0.4 * Math.exp(-((da / 0.45) ** 2)) * Math.exp(-r / 0.45) * smooth(0.08, 0.3, r) * (0.2 + 1.1 * smooth(0.35, 0.75, fbm(x / 12 + 7, y / 12, sd + 47)));
        const haze = 0.34 * Math.exp(-((r / 0.5) ** 2)) * (0.5 + 0.9 * tb);
        const cloud = 0.4 * Math.pow(Math.max(0, 1 - r / 0.92), 1.1) * smooth(0.4, 0.78, tb);
        const wisp = 0.35 * ridge(fbm(x / 22 + 1.3 * tb, y / 22, sd + 44), 6) * smooth(0.95, 0.35, r) * smooth(0.06, 0.25, r);
        const al = Math.abs(dx * jc + dy * js), ac = -dx * js + dy * jc, rc = Math.hypot(al / 1.25, ac);
        const core = 0.85 * Math.exp(-((rc / 0.06) ** 2)) + 0.38 * Math.exp(-((rc / 0.16) ** 2)) + 0.14 * Math.exp(-((rc / 0.32) ** 2));
        const a = core + haze + fan + cloud + wisp;
        if (a < 0.012) continue;
        const red = smooth(0.3, 0.9, r), pink = fan + wisp;
        put(i, (250 * core + 52 * haze + 118 * cloud + (240 - 30 * red) * pink) / a, (250 * core + 70 * haze + 120 * cloud + (78 - 40 * red) * pink) / a, (255 * core + 235 * haze + 240 * cloud + (165 - 70 * red) * pink) / a, a * 160 * smooth(1, 0.7, r));
      } else if (!kepler) {
        const dx = (x - m) / m, dy = ((y - m) / m) * (1.15 + 0.5 * squash), r = Math.hypot(dx, dy);
        if (r > 1) continue;
        const ca = dx / (r || 1), sa = dy / (r || 1);
        const q = r / (0.68 + 0.1 * (fbm(ca * 1.4 + 3, sa * 1.4 + 3, sd) - 0.5) * 2);
        if (q > 1.2) continue;
        const body = 1 - smooth(0.85, 1.15, q);
        const glow = 0.5 * Math.pow(Math.max(0, 1 - q * q), 0.8) * (0.55 + 0.6 * fbm(x / 18 + sd, y / 18, sd + 3)) * body;
        const wx = x / 24 + 1.3 * fbm(x / 38 + 9, y / 38, sd + 6), wy = y / 24 + 1.3 * fbm(x / 38, y / 38 + 9, sd + 9);
        const fil = (0.85 * ridge(fbm(wx, wy, sd + 12), 6) + 0.5 * ridge(fbm(wx * 2.1 + 5, wy * 2.1, sd + 15), 8)) * (0.35 + 0.8 * smooth(0.2, 0.95, q)) * body;
        const a = glow + fil; if (a < 0.012) continue;
        const yl = smooth(0.45, 0.7, fbm(x / 26 + 50, y / 26 + 50, sd + 18));
        put(i, (150 * glow + 238 * fil) / a, (182 * glow + (112 + 90 * yl) * fil) / a, (250 * glow + (82 + 40 * yl) * fil) / a, (0.85 * glow + 1.25 * fil) * 165);
      } else {
        const dx = (x - m) / m, dy = (y - m) / m, r = Math.hypot(dx, dy);
        if (r > 1) continue;
        const ang = Math.atan2(dy, dx), ca = Math.cos(ang), sa = Math.sin(ang);
        const edge = 0.64 + 0.12 * (fbm(ca * 1.6 + 3, sa * 1.6 + 3, sd) - 0.5) * 2;
        const side = 0.1 + 0.9 * smooth(-0.25, 1, Math.cos(ang - face)) * (0.5 + fbm(ca * 2.4 + 7, sa * 2.4 + 7, sd + 1));
        const gaps = smooth(0.3, 0.5, fbm(ca * 3 + 13, sa * 3 + 13, sd + 2));
        const turb = fbm(x / 15 + sd, y / 15, sd + 3), knots = smooth(0.52, 0.72, fbm(x / 7 + sd, y / 7, sd + 4));
        const rim = 0.8 * Math.exp(-(((r - edge) / 0.035) ** 2)) * (0.25 + 0.75 * side) * gaps * (0.5 + 0.7 * turb);
        const inner = Math.exp(-(((r - edge + 0.09) / 0.1) ** 2)) * side * (0.25 + 0.9 * turb) * (0.4 + 1.4 * knots);
        const fill = 0.13 * smooth(edge, 0, r) * turb * turb * 2, warmA = inner + fill;
        const a = rim + warmA; if (a < 0.012) continue;
        const w = smooth(0.35, 0.65, fbm(x / 30 + 70, y / 30 + 70, sd + 6));
        put(i, (140 * rim + (226 + 14 * w) * warmA) / a, (196 * rim + (110 + 104 * w) * warmA) / a, (240 * rim + (92 + 58 * w) * warmA) / a, a * 185 * smooth(1, 0.88, r));
      }
    }
    g.putImageData(im, 0, 0);
    return (n.sprite = c);
  }
  nebulaLife(n, age) {
    const v = this.novaVar(n), g = age - (v.rise + 0.4 * v.hold), main = NEBULA_MS - DISPERSE_MS;
    const d = Math.max(0, Math.min(1, n.endAt ? (Date.now() - n.endAt) / n.endMs : (age - main) / DISPERSE_MS));
    const pre = n.endAt ? true : age > main - 40000;
    if (g <= 0) return { size: 0, a: 0, d, pre };
    const size = 140 * (n.scale || 1) * (0.35 * (1 - Math.exp(-g / 18000)) + 0.65 * (1 - Math.exp(-g / 240000)));
    return { size, a: smooth01(g / 20000) * (1 - 0.3 * smooth01(age / main)), d, pre };
  }
  nebulaPieces(n) {
    let P = n.pieces;
    if (P && P.done) return P;
    const sp = this.nebulaSprite(n), S = sp.width, m = S / 2;
    if (!P) {
      const R = rng((n.seed || 1) + 717), K = 6 + Math.floor(R() * 3), G = 4, gw = Math.ceil(S / G) + 2, cs = [];
      for (let k = 0; k < K; k++) {
        const ang = (k / K) * TAU + (R() - 0.5) * 0.8, rr = m * (0.22 + 0.4 * R());
        const from = 0.25 + 0.3 * R();
        cs.push({ x: Math.cos(ang) * rr, y: Math.sin(ang) * rr, ang, sp: 0.45 + 1.1 * R(), grow: 0.2 + 0.35 * R(), spin: (R() - 0.5) * 0.5, from, end: Math.min(1, from + 0.42 + 0.25 * R()), side: (R() - 0.5) * 0.7 });
      }
      const Wt = new Float32Array(K * gw * gw), sd = ((n.seed || 1) % 991) + 3, sig2 = (m * 0.28) ** 2;
      for (let gy = 0; gy < gw; gy++) for (let gx = 0; gx < gw; gx++) {
        const wx = gx * G - m + m * 0.55 * (fbm(gx / 9, gy / 9, sd) - 0.5), wy = gy * G - m + m * 0.55 * (fbm(gx / 9 + 31, gy / 9 + 17, sd + 5) - 0.5);
        const o = (gy * gw + gx) * K; let sum = 0;
        for (let k = 0; k < K; k++) { const dx = wx - cs[k].x, dy = wy - cs[k].y, w = Math.exp(-(dx * dx + dy * dy) / sig2); Wt[o + k] = w; sum += w; }
        for (let k = 0; k < K; k++) Wt[o + k] = sum > 0 ? Wt[o + k] / sum : 1 / K;
      }
      let src = null; try { src = sp.getContext('2d').getImageData(0, 0, S, S).data; } catch {   }
      P = n.pieces = { K, cs, Wt, gw, G, src, list: [], done: !src };
      if (!src) { P.list = null; return P; }
    }
    const k = P.list.length, c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d'), im = g.createImageData(S, S), px = im.data, { src, Wt, gw, G, K } = P;
    for (let y = 0; y < S; y++) {
      const fy = y / G, y0 = fy | 0, ty = fy - y0;
      for (let x = 0; x < S; x++) {
        const i = (y * S + x) * 4, a = src[i + 3]; if (!a) continue;
        const fx = x / G, x0 = fx | 0, tx = fx - x0, o = (y0 * gw + x0) * K + k, o2 = o + gw * K;
        const w = (Wt[o] * (1 - tx) + Wt[o + K] * tx) * (1 - ty) + (Wt[o2] * (1 - tx) + Wt[o2 + K] * tx) * ty;
        px[i] = src[i]; px[i + 1] = src[i + 1]; px[i + 2] = src[i + 2]; px[i + 3] = a * w;
      }
    }
    g.putImageData(im, 0, 0);
    P.list.push(c);
    if (P.list.length === K) { P.done = true; P.src = null; P.Wt = null; }
    return P;
  }
  drawNebula(p, n, age) {
    const L = this.nebulaLife(n, age);
    let P = null;
    if (L.pre || L.d > 0) { P = this.nebulaPieces(n); if (L.d > 0) while (!P.done) P = this.nebulaPieces(n); }
    if (!p || L.a <= 0.003) return;
    const ctx = this.ctx, size = L.size;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.translate(p.x, p.y);
    const h = this.holes.find((o) => o.core && Math.hypot(o.x - p.x, o.y - p.y) < 9 * o.te + size);
    if (h) {
      const d = Math.hypot(h.x - p.x, h.y - p.y), ang = Math.atan2(h.y - p.y, h.x - p.x), f = Math.max(0, 1 - d / (9 * h.te + size));
      ctx.rotate(ang); ctx.scale(1 + 0.7 * f, 1 / (1 + 0.25 * f)); ctx.rotate(-ang);
    }
    ctx.rotate(n.rot || 0);
    if (L.d <= 0 || !P || !P.done || !P.list) { ctx.globalAlpha = L.a * (1 - smooth01(L.d)); ctx.drawImage(this.nebulaSprite(n), -size, -size, size * 2, size * 2); }
    else {
      const e = L.d ** 1.3, q = size / (P.list[0].width / 2);
      for (let k = 0; k < P.K; k++) {
        const c = P.cs[k], fade = 1 - smooth01((L.d - c.from) / (c.end - c.from));
        if (fade <= 0) continue;
        const s = 1 + c.grow * L.d, r = Math.hypot(c.x, c.y) || 1, ux = c.x / r, uy = c.y / r, out = 1.2 * e * c.sp * size, cx = c.x * q, cy = c.y * q;
        ctx.globalAlpha = (L.a * fade) / s ** 0.7;
        ctx.save(); ctx.translate(cx + out * (ux - c.side * uy), cy + out * (uy + c.side * ux)); ctx.rotate(c.spin * L.d); ctx.scale(s, s); ctx.translate(-cx, -cy);
        ctx.drawImage(P.list[k], -size, -size, size * 2, size * 2); ctx.restore();
      }
    }
    ctx.restore();
  }
  novaVar(n) {
    if (n._v) return n._v;
    const R = rng((n.seed || 1) + 101), pick = R();
    const v = { rise: 3000 + 2500 * R(), hold: 2000 + 2500 * R(), spikes: pick < 0.25 ? 0 : pick < 0.75 ? 4 : 6, srot: R() * TAU, ang: R() * TAU, lean: 1 + 0.35 * R(), flash: 0.6 + 0.4 * R(), slen: [] };
    for (let i = 0; i < 6; i++) v.slen.push(0.5 + 0.9 * R());
    v.wave = 0.4 + 1.4 * R() ** 1.6;
    return (n._v = v);
  }
  flareLevel(n, age) { const v = this.novaVar(n); return age < v.rise ? (age / v.rise) ** 2 : age < v.rise + v.hold ? 1 : Math.max(0, 1 - (age - v.rise - v.hold) / 53000); }
  drawFlare(p, age, hue, n) {
    if (!p) return;
    if (n.kind === 'blaze') return this.drawBlaze(p, age, n);
    const ctx = this.ctx, v = this.novaVar(n), f = this.flareLevel(n, age), sc = Math.max(0.6, n.scale || 1);
    if (f > 0.01) {
      const gr = (4 + 30 * f) * sc;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(v.ang); ctx.scale(v.lean, 1);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, gr);
      g.addColorStop(0, rgba(hue, 0.5 * f)); g.addColorStop(0.4, rgba(hue, 0.16 * f)); g.addColorStop(1, rgba(hue, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, gr, 0, TAU); ctx.fill(); ctx.restore();
      this.drawRays(p, v, 0.85 * f, (10 + 52 * f) * sc, 0.8 + 0.9 * f);
      ctx.fillStyle = rgba('#ffffff', Math.min(0.85, 0.25 + 0.6 * f)); ctx.beginPath(); ctx.arc(p.x, p.y, (0.8 + 1.6 * f) * Math.min(1.2, sc), 0, TAU); ctx.fill();
    }
    const done = v.rise + v.hold;
    if (age > done && !(n.kind === 'kepler' || n.kind === 'veil')) {
      const on = Math.min(1, (age - done) / 12000, (NEBULA_MS - age) / 60000, n.endAt ? 1 - (Date.now() - n.endAt) / n.endMs : 1), ph = (age % 1100) / 1100, pulse = Math.exp(-((Math.min(ph, 1 - ph) / 0.06) ** 2));
      if (on <= 0) return;
      const hr = 4 + 1.5 * pulse, halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, hr);
      halo.addColorStop(0, rgba('#dcecff', on * (0.06 + 0.08 * pulse))); halo.addColorStop(1, rgba('#dcecff', 0));
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(p.x, p.y, hr, 0, TAU); ctx.fill();
      ctx.fillStyle = rgba('#f6faff', on * (0.18 + 0.1 * pulse)); ctx.beginPath(); ctx.arc(p.x, p.y, 0.9 + 0.4 * pulse, 0, TAU); ctx.fill();
      const ba = age * 0.00025, bl = 6 + 4 * pulse;
      ctx.strokeStyle = rgba('#cfe6ff', on * (0.04 + 0.08 * pulse)); ctx.lineWidth = 1; ctx.beginPath();
      ctx.moveTo(p.x - Math.cos(ba) * bl, p.y - Math.sin(ba) * bl); ctx.lineTo(p.x + Math.cos(ba) * bl, p.y + Math.sin(ba) * bl); ctx.stroke();
    }
  }
  drawBlaze(p, age, n) {
    const v = this.novaVar(n), f = this.flareLevel(n, age), sc = n.scale || 1;
    const ctx = this.ctx;
    if (f > 0.01) {
      const fan = rng(n.seed)() * TAU + (n.rot || 0);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const gr = (12 + 60 * f) * sc, g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, gr);
      g.addColorStop(0, `rgba(255,255,255,${0.3 * f})`); g.addColorStop(0.15, `rgba(205,222,255,${0.2 * f})`); g.addColorStop(0.45, `rgba(70,100,250,${0.09 * f})`); g.addColorStop(1, 'rgba(50,70,240,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, gr, 0, TAU); ctx.fill();
      const fr = (18 + 40 * f) * sc, fx = p.x + Math.cos(fan) * fr * 0.8, fy = p.y + Math.sin(fan) * fr * 0.8;
      const fg = ctx.createRadialGradient(fx, fy, 0, fx, fy, fr);
      fg.addColorStop(0, `rgba(235,80,160,${0.11 * f})`); fg.addColorStop(1, 'rgba(200,40,90,0)');
      ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(fx, fy, fr, 0, TAU); ctx.fill();
      ctx.restore();
    }
    const L = this.nebulaLife(n, age), na = L.a * (1 - smooth01(L.d)), lv = Math.max(f, 0.35 * na);
    if (lv <= 0.01) return;
    this.drawRays(p, v, lv, (14 + 80 * lv) * sc, 1 + 1.1 * lv);
    if (f > 0.01) { ctx.fillStyle = `rgba(255,255,255,${Math.min(0.75, 0.25 + 0.5 * f)})`; ctx.beginPath(); ctx.arc(p.x, p.y, (1 + 1.8 * f) * sc, 0, TAU); ctx.fill(); }
  }
  drawRays(p, v, lv, L, th) {
    const ctx = this.ctx, sp = this.spikeSprite();
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 8; i++) {
      const main = i % 2 === 0, len = L * (main ? 0.8 + (0.28 * (v.slen[i % 6] - 0.5)) / 0.9 : 0.36 + (0.12 * (v.slen[(i + 3) % 6] - 0.5)) / 0.9);
      ctx.globalAlpha = (main ? 0.75 : 0.4) * lv;
      ctx.translate(p.x, p.y); ctx.rotate(v.srot + (i * Math.PI) / 4);
      ctx.drawImage(sp, sp.width / 2, 0, sp.width / 2, sp.height, 0, -th * (main ? 1 : 0.7), len, 2 * th * (main ? 1 : 0.7));
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
    ctx.restore();
  }
  spikeSprite() {
    if (this.spikeImg) return this.spikeImg;
    const c = document.createElement('canvas'); c.width = 256; c.height = 10;
    const g = c.getContext('2d'); g.translate(128, 5); g.scale(1, 5 / 128);
    const rg = g.createRadialGradient(0, 0, 0, 0, 0, 128);
    rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.05, 'rgba(236,243,255,0.6)'); rg.addColorStop(0.3, 'rgba(210,225,255,0.18)'); rg.addColorStop(1, 'rgba(190,210,255,0)');
    g.fillStyle = rg; g.beginPath(); g.arc(0, 0, 128, 0, TAU); g.fill();
    return (this.spikeImg = c);
  }
  glitchAt(t, k) {
    const n = Math.floor(t / 140), h = (x) => { const s = Math.sin(x * 12.9898) * 43758.5453; return s - Math.floor(s); };
    if (h(n) > 0.03 + 0.05 * k) return null;
    return { dx: (h(n + 0.31) - 0.5) * 16 * k, dy: (h(n + 0.77) - 0.5) * 5 * k, seed: n };
  }
  scramble(s, seed) {
    const J = '#%&@!?/\\<>*$01', h = (x) => { const v = Math.sin(x * 78.233) * 43758.5453; return v - Math.floor(v); };
    return [...s].map((c, i) => (c !== ' ' && h(seed * 31 + i) < 0.35 ? J[Math.floor(h(seed * 7 + i * 13) * J.length)] : c)).join('');
  }
  drawAlarm(x, y, r, t, k, col) {
    const ctx = this.ctx, W = this.W || 1200, H = this.H || 800, siren = 0.5 + 0.5 * Math.sin(t / 380);
    ctx.save();
    const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) * 0.6);
    v.addColorStop(0, rgba(col, 0)); v.addColorStop(1, rgba(col, k * (0.1 + 0.24 * siren)));
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
    const tr = Math.max(r * 3.2, 45), th = ctx.createRadialGradient(x, y, r * 0.6, x, y, tr);
    th.addColorStop(0, rgba(col, k * (0.16 + 0.24 * siren))); th.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = th; ctx.beginPath(); ctx.arc(x, y, tr, 0, TAU); ctx.fill();
    ctx.restore();
  }
  updateNova() {
    const nv = (this.plugin.hub.globe() || {}).nova, now = performance.now(), demo = (this.demoNovaUntil || 0) > now;
    const hot = demo || nv === true, calm = !demo && !nv;
    if (!this.nova && hot) this.nova = { t0: now, end: 0 };
    else if (this.nova && !this.nova.end && calm) this.nova.end = now;
    else if (this.nova && this.nova.end && hot) this.nova.end = 0;
    if (this.nova && this.nova.end && now - this.nova.end > 5000) this.nova = null;
  }
  drawNova(gx, gy, gr, t) {
    const n = this.nova; if (!n) return;
    const ctx = this.ctx, now = performance.now(), age = now - n.t0, glow = '#dffcef';
    const level = Math.min(1, age / 1500) * (n.end ? Math.max(0, 1 - (now - n.end) / 5000) : 1);
    if (age < 2600) {
      const e = age / 2600, fl = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr * (1 + 5 * e));
      fl.addColorStop(0, rgba('#ffffff', 0.75 * (1 - e) ** 1.5)); fl.addColorStop(1, rgba(glow, 0));
      ctx.fillStyle = fl; ctx.beginPath(); ctx.arc(gx, gy, gr * (1 + 5 * e), 0, TAU); ctx.fill();
      ctx.strokeStyle = rgba(glow, 0.55 * (1 - e)); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(gx, gy, gr * (1.2 + 14 * e), 0, TAU); ctx.stroke();
    }
    if (level <= 0) return;
    const co = ctx.createRadialGradient(gx, gy, gr * 0.8, gx, gy, gr * 2.9);
    co.addColorStop(0, rgba(glow, (0.2 + 0.06 * Math.sin(t / 300)) * level)); co.addColorStop(0.45, rgba(C.mint, 0.08 * level)); co.addColorStop(1, rgba(C.mint, 0));
    ctx.fillStyle = co; ctx.beginPath(); ctx.arc(gx, gy, gr * 2.9, 0, TAU); ctx.fill();
    ctx.strokeStyle = glow; ctx.lineWidth = 1; ctx.globalAlpha = 0.12 * level; ctx.beginPath();
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * TAU + t * 0.00004, len = gr * (1.25 + 0.7 * (0.5 + 0.5 * Math.sin(t / 700 + i * 1.7)));
      ctx.moveTo(gx + Math.cos(a) * gr * 1.02, gy + Math.sin(a) * gr * 1.02); ctx.lineTo(gx + Math.cos(a) * len, gy + Math.sin(a) * len);
    }
    ctx.stroke(); ctx.globalAlpha = 1;
    for (const k of [0, 1750]) {
      const e = ((age + k) % 3500) / 3500;
      ctx.strokeStyle = rgba(glow, 0.28 * (1 - e) * level); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(gx, gy, gr * (1.05 + 3.2 * e), 0, TAU); ctx.stroke();
    }
  }
  explode(m) {
    if (!(m.sx > -50 && m.sx < this.W + 50 && m.sy > -50 && m.sy < this.H + 50)) return;
    const parts = Array.from({ length: 70 }, () => ({ a: Math.random() * TAU, v: 0.04 + Math.random() * 0.22, s: Math.random() < 0.3 ? 2 : 1.2, c: Math.random() < 0.5 ? C.sand : '#ffe7b8' }));
    this.blasts.push({ x: m.sx, y: m.sy, t0: performance.now(), parts, size: 1 });
  }
  crumble(m) {
    const parts = Array.from({ length: 16 }, () => ({ a: Math.random() * TAU, v: 0.01 + Math.random() * 0.05, s: 1.2, c: '#c4bdb0' }));
    this.blasts.push({ x: m.sx, y: m.sy, t0: performance.now(), parts, size: 0.35 });
  }
  drawBlasts(now) {
    const ctx = this.ctx;
    this.blasts = this.blasts.filter((b) => now - b.t0 < 2600);
    for (const b of this.blasts) {
      const age = now - b.t0, e = age / 2600, S = b.size;
      const fl = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, (6 + 60 * e) * S);
      fl.addColorStop(0, rgba('#ffffff', 0.8 * (1 - e) ** 2)); fl.addColorStop(1, rgba(C.sand, 0));
      ctx.fillStyle = fl; ctx.beginPath(); ctx.arc(b.x, b.y, (6 + 60 * e) * S, 0, TAU); ctx.fill();
      ctx.strokeStyle = rgba(C.sand, 0.5 * (1 - e)); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(b.x, b.y, (8 + 140 * e) * S, 0, TAU); ctx.stroke();
      for (const p of b.parts) {
        const d = p.v * age * (1 - age / 5200);
        ctx.globalAlpha = 1 - e; ctx.fillStyle = p.c;
        ctx.fillRect(b.x + Math.cos(p.a) * d, b.y + Math.sin(p.a) * d + 0.00002 * age * age, p.s, p.s);
      }
      ctx.globalAlpha = 1;
    }
  }
  fxOn() { return !this.intro && !this.lapse; }
  activity(kind, path, old) {
    const A = this.act, now = performance.now();
    if (kind === 'modify' && ((this.edit && this.edit.path === path) || (A.typed && A.typed.path === path && now - A.typed.at < TYPED_MS))) return;
    const B = A.burst || (A.burst = { t0: now, last: now, paths: new Set() });
    B.last = now; B.paths.add(path);
    if (kind === 'delete') { this.gone(path, now); return; }
    if (kind === 'modify') { const n = this.byPath.get(path); if (n && this.big) n.promo = 1; }
    let from = null, moved = false;
    if (kind === 'create') { const nm = baseName(path), i = A.held.findIndex((h) => h.name === nm); if (i >= 0) { from = A.held[i].node; moved = true; A.held.splice(i, 1); } }
    A.win.push({ at: now, path });
    while (A.wh < A.win.length && now - A.win[A.wh].at > FLOOD_MS) A.wh++;
    if (A.wh > 512) { A.win.splice(0, A.wh); A.wh = 0; }
    if (!A.flood && A.win.length - A.wh >= FLOOD_N) {
      const paths = new Set();
      for (let i = A.wh; i < A.win.length; i++) paths.add(A.win[i].path);
      for (const p of A.pend.keys()) paths.add(p);
      A.pend.clear();
      A.queue = A.queue.filter((e) => { if (e.kind === 'burst' || e.kind === 'delete') return true; if (e.n.v < 1) e.n.v = 1; paths.add(e.n.path); return false; });
      A.flood = { t0: now, last: now, paths };
      A.cap = { f: A.flood, t0: now, out: Infinity };
    }
    if (A.flood) { A.flood.paths.add(path); if (A.win.length - A.wh >= FLOOD_N / 2) A.flood.last = now; return; }
    if (kind === 'create') { A.pend.set(path, moved ? { kind: 'move', from } : { kind: 'create', at: now }); return; }
    if (kind === 'rename') {
      const o = this.byPath.get(old) || null, dir = (p) => p.slice(0, p.lastIndexOf('/') + 1);
      A.pend.set(path, !o ? { kind: 'create', at: now } : dir(old) !== dir(path) ? { kind: 'move', from: o } : { kind: 'touch' });
      if (o && A.last === o) A.last = null;
      return;
    }
    const n = this.byPath.get(path);
    if (n) A.queue.push({ n, kind: 'edit', from: null, due: now, per: 0 });
  }
  gone(path, now) {
    const A = this.act, nm = baseName(path), n = this.byPath.get(path) || null;
    if (A.last && A.last.path === path) A.last = null;
    for (const [p, e] of A.pend) if (e.kind === 'create' && now - e.at < MOVE_MS && baseName(p) === nm) { A.pend.set(p, { kind: 'move', from: n }); return; }
    if (A.flood) for (const p of A.flood.paths) if (p !== path && baseName(p) === nm) return;
    A.held.push({ path, name: nm, node: n, at: now, wall: Date.now() });
    clearTimeout(A.delT);
    if (now - A.held[0].at > 2000) this.settleDeletes(); else A.delT = setTimeout(() => this.settleDeletes(), HOLD_MS);
  }
  settleDeletes() {
    const A = this.act, H = A.held;
    clearTimeout(A.delT);
    if (!H.length) return;
    A.held = [];
    if (this.plugin.views.values().next().value === this) {
      const when = (t) => new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      this.plugin.hub.buryAs('note', H.map((h) => { const i = h.path.lastIndexOf('/'), w = when(h.wall); return { id: `${h.path}@${h.wall}`, name: h.name, line: i > 0 ? `${h.path.slice(0, i)} · ${w}` : w, copy: h.path, at: h.wall }; }));
    }
    if (!this.fxOn()) return;
    const list = H.filter((h) => h.node && h.node.px > -5000), M = list.length, now = performance.now();
    if (!M) return;
    if (M < MASS_N && !A.flood) { for (const h of list) A.queue.push({ n: h.node, kind: 'delete', from: null, due: now, per: 0 }); return; }
    A.heat = Math.min(1.6, A.heat + Math.min(0.9, 0.12 * M));
    const S = Math.min(M, 400), per = Math.max(3, Math.min(9, Math.floor(700 / M)));
    for (let j = 0; j < M; j++) {
      const n = list[j].node, k = Math.floor((j * S) / M);
      if (Math.floor(((j + 1) * S) / M) > k) A.queue.push({ n, kind: 'burst', from: null, due: now + (900 * k) / S, per });
      else n.v = 0;
    }
  }
  noteSig(p) {
    const MC = this.app.metadataCache, L = MC.resolvedLinks && MC.resolvedLinks[p], f = this.app.vault.getAbstractFileByPath(p);
    const c = f && MC.getFileCache ? MC.getFileCache(f) : null, fm = c && c.frontmatter, ft = fm ? (fm.tags !== undefined ? fm.tags : fm.tag) : undefined;
    return `${L ? Object.keys(L).sort().join('|') : ''}\t${c && c.tags ? c.tags.map((t) => t.tag).join('|') : ''}\t${ft === undefined ? '' : JSON.stringify(ft)}`;
  }
  sameLinks() {
    const M = this.act.mod;
    if (!M.size || this.rebuildDue) { M.clear(); return false; }
    let same = true;
    for (const [p, s] of M) if (this.noteSig(p) !== s) { same = false; break; }
    M.clear();
    return same;
  }
  landed() {
    const A = this.act, on = this.fxOn();
    if (A.scope !== this.scope) {
      const first = A.scope === null; A.scope = this.scope;
      if (!first) { this.rockets.length = 0; this.flashes.length = 0; this.rocks.length = 0; A.fade.clear(); A.queue.length = 0; A.pend.clear(); A.last = null; return; }
    }
    if (on) {
      for (const r of this.rockets) if (!r.hit && (r.kind === 'create' || r.kind === 'move')) r.b.v = 0;
      for (const e of A.queue) if (e.kind === 'create' || e.kind === 'move') e.n.v = 0;
    }
    if (!A.pend.size) return;
    const now = performance.now();
    for (const [p, e] of A.pend) {
      const n = this.byPath.get(p); if (!n) continue;
      const kind = e.kind === 'touch' ? 'edit' : e.kind === 'move' && !e.from ? 'create' : e.kind;
      if (kind !== 'edit' && on) n.v = 0;
      A.queue.push({ n, kind, from: kind === 'move' ? e.from : null, due: now, per: 0 });
    }
    A.pend.clear();
  }
  change(n, kind, from, now) {
    const A = this.act, del = kind === 'delete';
    if (!this.fxOn()) { if (!del) { A.last = n; if (n.v < 1) n.v = 1; } return; }
    const src = from || (A.last && this.byPath.get(A.last.path) === A.last ? A.last : this.gEnd);
    if (!del) { A.last = n; if (this.big) n.promo = 1; }
    const every = A.load < 14 ? 1 : A.load < 22 ? 2 : 3, go = ++A.seq >= every;
    if (go) A.seq = 0;
    if (go && src !== n && n.px > -5000 && src.px > -5000) { this.launch(src, n, kind, now); return; }
    if (del) { this.burst(n, now, 14); return; }
    if (n.v < 1) A.fade.set(n, now);
    this.flash(n, now, kind === 'edit' ? 0.7 : 1);
  }
  launch(a, b, kind, t0) {
    const dx = b.px - a.px, dy = b.py - a.py, d = Math.hypot(dx, dy), aa = a.adj, ba = b.adj;
    const lin = !!(aa && ba) && (aa.length < ba.length ? aa.includes(b) : ba.includes(a));
    const ge = this.gEnd, mx = (a.px + b.px) / 2 - ge.px, my = (a.py + b.py) / 2 - ge.py;
    const bow = lin ? 0 : (-dy * mx + dx * my >= 0 ? 1 : -1) * (0.22 + 0.14 * Math.random());
    this.rockets.push({ a, b, kind, t0, dur: Math.max(ROCKET_MIN, Math.min(ROCKET_MAX, ROCKET_MIN + 1.5 * d)), bow, hit: false });
  }
  drawActivity(now) {
    const A = this.act;
    A.load += ((this.lastCost || 0) - A.load) * 0.05;
    if (A.heat) { A.heat *= Math.exp(-Math.max(0, now - A.heatAt) / 1100); if (A.heat < 0.004) A.heat = 0; }
    A.heatAt = now;
    if (this.lapse) { this.rockets.length = 0; this.flashes.length = 0; this.rocks.length = 0; A.queue.length = 0; A.fade.clear(); A.burst = null; return; }
    const Q = A.queue;
    if (Q.length) {
      let keep = 0;
      for (let i = 0; i < Q.length; i++) {
        const e = Q[i];
        if (e.due > now) { Q[keep++] = e; continue; }
        if (now - e.due > 4000) { if ((e.kind === 'create' || e.kind === 'move') && e.n.v < 1) e.n.v = 1; continue; }
        if (e.kind === 'burst') this.burst(e.n, now, e.per); else this.change(e.n, e.kind, e.from, now);
      }
      Q.length = keep;
    }
    const F = A.flood;
    if (F && !this.rebuildDue && (now - F.last > FLOOD_QUIET || now - F.t0 > 20000)) this.syncWave(now);
    const B = A.burst;
    if (B && !A.flood && !this.intro && !this.rebuildDue && (now - B.last > FLOOD_QUIET || now - B.t0 > 20000)) { A.burst = null; this.lightWave(now, B.paths); }
    if (A.fade.size) for (const [n, t] of A.fade) { const k = (now - t) / 600; if (k >= 1) { n.v = 1; A.fade.delete(n); } else n.v = Math.max(0.02, smooth01(k)); }
    if (A.heat) this.drawHoleHeat(Math.min(1, A.heat));
    if (this.rocks.length) this.drawRocks(now);
    if (this.rockets.length) this.drawRockets(now);
    if (this.flashes.length) this.drawFlashes(now);
    if (A.cap) this.drawSyncCap(now);
  }
  drawRockets(now) {
    const ctx = this.ctx, R = this.rockets, B = this.rb || (this.rb = [[], [], [], [], [], [], [], []]), HR = this.rhr || (this.rhr = []), HP = this.rhp || (this.rhp = []);
    for (const L of B) L.length = 0;
    HR.length = 0; HP.length = 0;
    const ease = (s) => (s <= 0 ? 0 : s >= 1 ? 1 : s < 0.5 ? 4 * s * s * s : 1 - ((2 - 2 * s) ** 3) / 2);
    let keep = 0;
    for (let i = 0; i < R.length; i++) {
      const r = R[i], u = (now - r.t0) / r.dur;
      if (u < 0) { R[keep++] = r; continue; }
      if (u >= 1 && !r.hit) { r.hit = true; this.landRocket(r, now); }
      if (u >= 1 + ROCKET_LAG) continue;
      R[keep++] = r;
      const a = r.a, b = r.b, ax = a.px, ay = a.py, bx = b.px, by = b.py;
      const kx = (ax + bx) / 2 - r.bow * (by - ay), ky = (ay + by) / 2 + r.bow * (bx - ax), h = ease(u), tl = ease(u - ROCKET_LAG);
      let px = ax, py = ay;
      for (let j = 0; j <= 8; j++) {
        const s = tl + ((h - tl) * j) / 8, w = 1 - s, x = w * w * ax + 2 * w * s * kx + s * s * bx, y = w * w * ay + 2 * w * s * ky + s * s * by;
        if (j) B[j - 1].push(px, py, x, y);
        px = x; py = y;
      }
      if (u < 1) { HR.push(r); HP.push(px, py); }
    }
    R.length = keep;
    ctx.lineCap = 'round';
    for (let j = 0; j < 8; j++) {
      const L = B[j]; if (!L.length) continue;
      const k = (j + 1) / 8;
      ctx.beginPath();
      for (let m = 0; m < L.length; m += 4) { ctx.moveTo(L[m], L[m + 1]); ctx.lineTo(L[m + 2], L[m + 3]); }
      ctx.strokeStyle = C.sand; ctx.globalAlpha = 0.16 * k; ctx.lineWidth = 3; ctx.stroke();
      ctx.strokeStyle = '#fffaf0'; ctx.globalAlpha = 0.55 * k * k; ctx.lineWidth = 0.9; ctx.stroke();
    }
    ctx.lineCap = 'butt';
    if (HR.length) {
      const g = this.dotGlow(C.sand);
      ctx.globalAlpha = 0.9;
      for (let m = 0; m < HR.length; m++) ctx.drawImage(g, HP[2 * m] - 9, HP[2 * m + 1] - 9, 18, 18);
      for (let m = 0; m < HR.length; m++) {
        const r = HR[m], x = HP[2 * m], y = HP[2 * m + 1];
        if (r.kind === 'create' || r.kind === 'move') { ctx.fillStyle = this.theme().ink ? inkOf(r.b.color) : r.b.color; ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.arc(x, y, 2.4, 0, TAU); ctx.fill(); }
        else if (r.kind === 'delete' && this.byPath.get(r.b.path) !== r.b) { ctx.fillStyle = '#a8a196'; ctx.globalAlpha = 0.7; ctx.beginPath(); ctx.arc(r.b.px, r.b.py, 2, 0, TAU); ctx.fill(); }
      }
      ctx.fillStyle = '#ffffff'; ctx.globalAlpha = 0.95; ctx.beginPath();
      for (let m = 0; m < HR.length; m++) { const x = HP[2 * m], y = HP[2 * m + 1]; ctx.moveTo(x + 1.6, y); ctx.arc(x, y, 1.6, 0, TAU); }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  landRocket(r, now) {
    const b = r.b;
    if (r.kind === 'delete') { this.burst(b, now, 14); return; }
    if (b.v < 1) this.act.fade.set(b, now);
    if (this.big) b.promo = 1;
    this.flash(b, now, 1);
  }
  flash(n, t0, k, col = '#fffaf0', dur = 700, a = 1) { this.flashes.push({ n, x: 0, y: 0, t0, k, col, dur, a }); }
  flashAt(x, y, t0, k, col = '#fffaf0', dur = 700, a = 1) { this.flashes.push({ n: null, x, y, t0, k, col, dur, a }); }
  drawFlashes(now) {
    const ctx = this.ctx, F = this.flashes, W = this.W, H = this.H, TH = this.theme(), pc = TH.ink ? TH.flash : null;
    let keep = 0;
    for (let i = 0; i < F.length; i++) {
      const f = F[i], e = (now - f.t0) / f.dur;
      if (e >= 1) continue;
      F[keep++] = f;
      if (e < 0) continue;
      const x = f.n ? f.n.px : f.x, y = f.n ? f.n.py : f.y;
      if (x < -60 || y < -60 || x > W + 60 || y > H + 60) continue;
      const q = 1 - e, Rr = (5 + 20 * (1 - q * q)) * f.k;
      ctx.globalAlpha = Math.min(1, 0.9 * q * q) * f.a; ctx.drawImage(this.dotGlow(pc && f.col === '#fffaf0' ? pc : f.col), x - Rr, y - Rr, Rr * 2, Rr * 2);
      if (f.k >= 1) { const R2 = Rr * 2; ctx.globalAlpha = 0.35 * q * f.a; ctx.drawImage(this.dotGlow(pc || C.sand), x - R2, y - R2, R2 * 2, R2 * 2); }
    }
    F.length = keep; ctx.globalAlpha = 1;
  }
  burst(n, now, count) {
    n.v = 0;
    const x = n.px, y = n.py;
    if (!(x > -80 && y > -80 && x < this.W + 80 && y < this.H + 80)) return;
    this.flashAt(x, y, now, 0.9, '#d8d1c4', 650);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU, sp = 0.02 + Math.random() * 0.075;
      this.rocks.push({ x0: x, y0: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t0: now, x, y, s: Math.random() < 0.3 ? 1.8 : 1.1, g: Math.random() < 0.5 ? 0 : 1, f0: 0, ox: 0, oy: 0, fd: 1300 + Math.random() * 1200, sw: (Math.random() < 0.5 ? -1 : 1) * (1.6 + Math.random() * 2.2), fade: 0 });
    }
  }
  drawRocks(now) {
    const ctx = this.ctx, K = this.rocks, A = this.act, hole = this.holes.find((o) => o.core && o.x > -5000) || null;
    const RB = this.rkb || (this.rkb = [[], [], [], [], [], [], [], []]);
    for (const L of RB) L.length = 0;
    let keep = 0;
    for (let i = 0; i < K.length; i++) {
      const r = K[i], age = now - r.t0;
      let a = 1, sz = r.s;
      if (age < 650) { const k = 220 * (1 - Math.exp(-age / 220)); r.x = r.x0 + r.vx * k; r.y = r.y0 + r.vy * k; }
      else {
        if (!r.f0) { r.f0 = now; if (hole) { r.ox = r.x - hole.x; r.oy = r.y - hole.y; r.fd += Math.min(2000, 1.5 * Math.hypot(r.ox, r.oy)); } else { r.fade = 1; r.fd = 700; } }
        if (!r.fade && !hole) { r.fade = 1; r.f0 = now; r.fd = 700; }
        const s = (now - r.f0) / r.fd;
        if (s >= 1) { if (!r.fade) A.heat = Math.min(1.6, A.heat + 0.035); continue; }
        if (r.fade) a = 1 - s;
        else {
          const e = s * s, sc = (1 - e) ** 1.2, an = r.sw * e, c = Math.cos(an), sn = Math.sin(an);
          r.x = hole.x + (r.ox * c - r.oy * sn) * sc; r.y = hole.y + (r.ox * sn + r.oy * c) * sc;
          sz *= 0.45 + 0.55 * sc;
          if (s > 0.8) a = (1 - s) / 0.2;
        }
      }
      K[keep++] = r;
      const lv = Math.min(3, Math.floor(a * 4));
      RB[r.g * 4 + lv].push(r.x, r.y, sz);
    }
    K.length = keep;
    for (let key = 0; key < 8; key++) {
      const L = RB[key]; if (!L.length) continue;
      ctx.fillStyle = key < 4 ? '#a8a196' : '#76716a'; ctx.globalAlpha = ((key & 3) + 0.5) / 4; ctx.beginPath();
      for (let m = 0; m < L.length; m += 3) { const z = L[m + 2]; ctx.rect(L[m] - z / 2, L[m + 1] - z / 2, z, z); }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  drawHoleHeat(k) {
    const h = this.holes.find((o) => o.core && o.x > -5000);
    if (!h) return;
    if (!this.heatRing) {
      const c = document.createElement('canvas'); c.width = c.height = 96;
      const g = c.getContext('2d'), gr = g.createRadialGradient(48, 48, 0, 48, 48, 48);
      gr.addColorStop(0, rgba(C.sand, 0)); gr.addColorStop(0.28, rgba(C.sand, 0)); gr.addColorStop(0.4, rgba('#fff4d6', 0.5)); gr.addColorStop(0.55, rgba(C.sand, 0.22)); gr.addColorStop(0.8, rgba(C.sand, 0.05)); gr.addColorStop(1, rgba(C.sand, 0));
      g.fillStyle = gr; g.fillRect(0, 0, 96, 96);
      this.heatRing = c;
    }
    const ctx = this.ctx, R = h.rs * 3.4 * (1 + 0.25 * k) + 6;
    ctx.globalAlpha = Math.min(1, 0.85 * k); ctx.drawImage(this.heatRing, h.x - R, h.y - R, R * 2, R * 2); ctx.globalAlpha = 1;
  }
  lightWave(now, touched) {
    const W = this.W, H = this.H, hot = [], soft = [];
    let dmax = 1;
    for (const n of this.nodes) {
      if (!(n.px > -5000) || n.v === 0) continue;
      const t = touched.has(n.path);
      if (!t && !(n.px > 0 && n.py > 0 && n.px < W && n.py < H)) continue;
      n.wd = Math.hypot(n.x, n.y, n.z); if (n.wd > dmax) dmax = n.wd;
      (t ? hot : soft).push(n);
    }
    const S = Math.min(soft.length, WAVE_N);
    for (let i = 0; i < S; i++) { const n = soft[Math.floor((i * soft.length) / S)]; this.flash(n, now + (WAVE_MS * n.wd) / dmax, 0.4, '#fffaf0', 1200, 0.5); }
    hot.sort((a, b) => a.wd - b.wd);
    const HS = Math.min(hot.length, 1200);
    for (let i = 0; i < HS; i++) { const n = hot[Math.floor((i * hot.length) / HS)]; this.flash(n, now + (WAVE_MS * n.wd) / dmax, 0.75, '#fffaf0', 1300); }
    return hot;
  }
  syncWave(now) {
    const A = this.act, F = A.flood, B = A.burst;
    A.flood = null; A.burst = null;
    if (A.cap && A.cap.f === F) A.cap.out = now + WAVE_MS + 3000;
    const list = this.lightWave(now, B ? new Set([...F.paths, ...B.paths]) : F.paths);
    if (!list.length) return;
    const W = this.W, H = this.H, vis = list.filter((n) => n.px > 0 && n.py > 0 && n.px < W && n.py < H), RN = Math.min(5, vis.length);
    let prev = A.last && this.byPath.get(A.last.path) === A.last ? A.last : this.gEnd;
    for (let i = 0; i < RN; i++) {
      const n = vis[Math.floor(((i + 0.5) * vis.length) / RN)];
      if (n === prev) continue;
      this.launch(prev, n, 'edit', now + 200 + 300 * i); prev = n;
    }
    if (prev !== this.gEnd) A.last = prev;
  }
  drawSyncCap(now) {
    const A = this.act, cp = A.cap, ge = this.gEnd, ctx = this.ctx;
    if (now - cp.out >= 900) { A.cap = null; return; }
    if (ge.px < -5000) return;
    const k = smooth01((now - cp.t0) / 500) * (cp.out === Infinity ? 1 : 1 - smooth01((now - cp.out) / 900));
    if (k < 0.01) return;
    ctx.font = `9.5px ${this.mono()}`; ctx.textAlign = 'center'; ctx.fillStyle = C.sand; ctx.globalAlpha = 0.55 * k;
    ctx.fillText(`SYNC · ${cp.f.paths.size} NOTES`, ge.px, ge.py + ge.r + ge.capY);
    ctx.textAlign = 'left'; ctx.globalAlpha = 1;
  }
  inkSky(F) {
    if (this.inkS && this.inkS.src === F) return this.inkS.c;
    const c = document.createElement('canvas'); c.width = F.width; c.height = F.height;
    const g = c.getContext('2d'); g.drawImage(F, 0, 0);
    const D = c.width && c.height && g.getImageData ? g.getImageData(0, 0, c.width, c.height) : null;
    if (D && D.data) {
      const d = D.data, W = c.width, H = c.height, R = rng(9311), dens = this.starDens, hole = this.hole;
      for (let i = 3; i < d.length; i += 4) if (d[i]) d[i] = Math.min(255, PAPER.inkA + d[i] * PAPER.inkK);
      const put = (x, y, a) => { if (x >= W || y >= H) return; const i = (y * W + x) * 4; d[i] = d[i + 1] = d[i + 2] = 232; if (a > d[i + 3]) d[i + 3] = a; };
      for (let k = 0, n = Math.round((W * H) / PAPER.extra); k < n; k++) {
        const x = Math.floor(R() * W), y = Math.floor(R() * H), br = R();
        if (R() > (dens ? dens(x, y) : 1) * (hole ? hole(x, y) : 1)) continue;
        const a = 60 + 195 * br * br;
        put(x, y, a);
        if (br > 0.93) { put(x + 1, y, a); put(x, y + 1, a); put(x + 1, y + 1, a); }
      }
      g.putImageData(D, 0, 0);
    }
    this.inkS = { src: F, c };
    return c;
  }
  inkBand(img) {
    if (this.inkB && this.inkB.src === img) return this.inkB.c;
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    for (let i = 0; i < PAPER.bandK; i++) g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'source-in'; g.fillStyle = PAPER.band; g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'source-over';
    const u = document.createElement('canvas'); u.width = c.width; u.height = c.height;
    const ug = u.getContext('2d'), blur = 'filter' in ug;
    if (blur) ug.filter = `blur(${PAPER.soft}px)`;
    ug.drawImage(c, 0, 0);
    if (blur) ug.filter = 'none';
    const D = c.width && c.height && g.getImageData ? g.getImageData(0, 0, c.width, c.height) : null;
    const U = D && ug.getImageData ? ug.getImageData(0, 0, u.width, u.height) : null;
    if (D && D.data && U && U.data && PAPER.grain) {
      const d = D.data, s = U.data, W = c.width, H = c.height, R = rng(7177), b = parseInt(PAPER.band.slice(1, 3), 16);
      const lo = parseInt(PAPER.speckLo.slice(1, 3), 16), hi = parseInt(PAPER.speck.slice(1, 3), 16);
      let top = 1;
      for (let i = 3; i < s.length; i += 4) if (s[i] > top) top = s[i];
      for (let i = 0; i < d.length; i += 4) {
        const v = s[i + 3] / top;
        if (R() < PAPER.grain * Math.pow(v, PAPER.curve)) {
          d[i] = d[i + 1] = d[i + 2] = Math.round(lo + (hi - lo) * Math.min(1, 1.4 * v)); d[i + 3] = 140 + R() * 115;
        } else { d[i] = d[i + 1] = d[i + 2] = b; d[i + 3] = 255 * PAPER.wash * v; }
      }
      for (let k = 0, n = Math.round((W * H) / PAPER.bandStars); k < n; k++) {
        const x = Math.floor(R() * (W - 1)), y = Math.floor(R() * (H - 1)), v = s[(y * W + x) * 4 + 3] / top;
        if (R() > v * v) continue;
        for (const j of [0, 4, 4 * W, 4 * W + 4]) { const i = (y * W + x) * 4 + j; d[i] = d[i + 1] = d[i + 2] = hi; d[i + 3] = 255; }
      }
      g.putImageData(D, 0, 0);
    }
    this.inkB = { src: img, c };
    return c;
  }
  dotGlow(col) {
    const cache = this.glows || (this.glows = new Map());
    let c = cache.get(col);
    if (c) return c;
    c = document.createElement('canvas'); c.width = c.height = 48;
    const g = c.getContext('2d'), gr = g.createRadialGradient(24, 24, 0, 24, 24, 24), gk = settingOf(this.plugin.settings, 'glow') / 100;
    gr.addColorStop(0, rgba(col, 0.55 * gk)); gr.addColorStop(0.25, rgba(col, 0.22 * gk)); gr.addColorStop(0.6, rgba(col, 0.05 * gk)); gr.addColorStop(1, rgba(col, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 48, 48);
    cache.set(col, c);
    return c;
  }
  drawMoon(m, p, t, now, near = 0) {
    const ctx = this.ctx, a = 0.45 + 0.55 * p.near, isNew = (m.newUntil || 0) > now, col = m.dim ? C.muted : C.sand;
    const r = (m === this.hoverMoon ? 3.6 : 2.7) * Math.max(0.8, p.s / this.k);
    const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * (isNew ? 7 : 4.5)), gk = settingOf(this.plugin.settings, 'glow') / 100;
    glow.addColorStop(0, rgba(col, (isNew ? 0.4 + 0.2 * Math.sin(t / 200) : 0.2) * a * gk)); glow.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(p.x, p.y, r * (isNew ? 7 : 4.5), 0, TAU); ctx.fill();
    ctx.fillStyle = rgba(m === this.hoverMoon ? '#ffffff' : col, m.dim ? a * 0.7 : a); ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
    if (m.ring) {
      const dash = !!m.ring.dashed;
      ctx.strokeStyle = rgba(m.ring.color || C.sand, (dash ? 0.6 : 0.85) * a); ctx.lineWidth = 1;
      if (dash) ctx.setLineDash([2, 2.5]);
      ctx.beginPath(); ctx.arc(p.x, p.y, r + 3.4, 0, TAU); ctx.stroke();
      if (dash) ctx.setLineDash([]);
    }
    const sp = this.labelSprite(m.name, col), base = m.dim ? 0.35 : 0.55;
    ctx.globalAlpha = (base + (0.95 - base) * near) * a;
    ctx.drawImage(sp, p.x + r + 5, p.y + 3 - sp.base, sp.width / sp.dpr, sp.height / sp.dpr);
    ctx.globalAlpha = 1;
  }
  labelSprite(text, col) {
    const key = text + '|' + col, cache = this.labelSprites || (this.labelSprites = new Map());
    let c = cache.get(key);
    if (c) return c;
    if (cache.size > 400) cache.clear();
    const dpr = Math.max(2, this.dpr || 1), font = `9.5px ${this.mono()}`, m = document.createElement('canvas').getContext('2d');
    m.font = font;
    c = document.createElement('canvas'); c.width = Math.ceil((m.measureText(text).width + 4) * dpr); c.height = Math.ceil(16 * dpr);
    c.dpr = dpr; c.base = 11;
    const g = c.getContext('2d'); g.scale(dpr, dpr); g.font = font; g.fillStyle = col; g.fillText(text, 1, c.base);
    cache.set(key, c);
    return c;
  }
  reuseSky(W, H) {
    const K = this.plugin.skyKeep;
    if (!K || W > K.skyW || H > K.skyH || K.sky === this.sky) return false;
    Object.assign(this, K); this.skyAt = performance.now(); this.holeSprite = null;
    this.living = Array.from({ length: this.livingN() }, () => this.newLiving(Date.now(), true));
    return true;
  }
  livingN() { return Math.round(140 * settingOf(this.plugin.settings, 'stars') / 100); }
  skyStep(W, H) {
    if (this.starsDirty && this.sky && this.starSrc && (!this.skyJob || this.skyJob.re)) { this.starsDirty = false; this.skyRedo = true; this.skyJob = { W: this.skyW, H: this.skyH, re: true, it: this.restarGen() }; }
    if (!(this.skyJob && this.skyJob.re) && this.reuseSky(W, H)) { this.skyJob = null; return; }
    if (!this.skyJob || W > this.skyJob.W || H > this.skyJob.H) {
      if (this.sky && !this.steady()) return;
      this.skyJob = { W, H, it: this.skyGen(W, H) };
    }
    const t0 = performance.now(), re = !!this.skyJob.re;
    for (let i = 0; i < (re ? 64 : SKY_STEPS) && performance.now() - t0 < (re ? 14 : SKY_MS); i++) if (this.skyJob.it.next().done) { this.skyJob = null; return; }
  }
  *starsTo(S, want) {
    const { R, TW, TH, dens, hole } = S;
    for (; S.x.length < want && S.tries < want * 4; S.tries++) {
      if (S.tries && S.tries % SKY_SLICE === 0) yield;
      const x = Math.floor(R() * TW), y = Math.floor(R() * TH);
      if (R() > dens(x, y) * hole(x, y)) continue;
      const br = R();
      S.x.push(x); S.y.push(y); S.b.push(br);
      if (br > 0.9 && R() < 0.3) { S.k.push(2); S.ph.push(R() * 6.3); } else { S.k.push(br > 0.97 && R() < 0.4 ? 1 : 0); S.ph.push(0); }
    }
  }
  paintStars(img, S, n) {
    const g = img.getContext('2d'), TW = img.width, twinkle = [];
    n = Math.min(n, S.x.length);
    g.clearRect(0, 0, TW, img.height);
    const key = new Int16Array(n), cnt = new Uint32Array(512);
    for (let i = 0; i < n; i++) {
      const br = S.b[i], a = 0.07 + Math.pow(br, 2.4) * 0.72;
      if (S.k[i] === 2) { twinkle.push({ x: S.x[i], y: S.y[i], a: a + 0.15, big: br > 0.988, ph: S.ph[i] }); key[i] = -1; continue; }
      key[i] = S.k[i] * 256 + Math.round(a * 255); cnt[key[i]]++;
    }
    const off = new Uint32Array(513);
    for (let j = 0; j < 512; j++) off[j + 1] = off[j] + cnt[j];
    const at = off.slice(0, 512), ord = new Uint32Array(off[512]);
    for (let i = 0; i < n; i++) if (key[i] >= 0) ord[at[key[i]]++] = i;
    for (let j = 0; j < 512; j++) {
      if (!cnt[j]) continue;
      g.fillStyle = rgba(j >= 256 ? C.sky : C.text, (j & 255) / 255);
      for (let m = off[j]; m < off[j + 1]; m++) {
        const i = ord[m], x = S.x[i], y = S.y[i], sz = S.b[i] > 0.988 ? 2 : 1;
        g.fillRect(x, y, sz, sz); if (x > TW - 2) g.fillRect(x - TW, y, sz, sz);
      }
    }
    return twinkle;
  }
  *restarGen() {
    const S = this.starSrc, want = Math.round(((S.TW * S.TH) / 250) * (settingOf(this.plugin.settings, 'stars') / 100));
    yield* this.starsTo(S, want);
    const tw = this.paintStars(this.sky, S, want), K = this.plugin.skyKeep;
    this.twinkle = tw; if (K && K.sky === this.sky) K.twinkle = tw;
    this.inkS = null;
    this.holeSprite = null;
    this.living = Array.from({ length: this.livingN() }, () => this.newLiving(Date.now(), true));
    this.skyRedo = false;
  }
  liftBake(W, H, TH, dk, theme) {
    const dpr = this.dpr || 1, look = `${theme}|${dk}`, key = `${W}|${H}|${dpr}|${look}`;
    let B = this.bake;
    if (!B || B.key !== key) {
      const keep = B && B.done && B.look === look ? B : this.bakeKeep && this.bakeKeep.look === look ? this.bakeKeep : null;
      this.bakeKeep = keep;
      if (keep && !this.steady()) { this.bake = keep; return keep; }
      const c = document.createElement('canvas'), cw = Math.max(1, Math.round((W + 2 * SHIFT) * dpr)), ch = Math.max(1, Math.round(H * dpr));
      c.width = cw; c.height = ch;
      const g = c.getContext('2d'), D = g && g.createImageData && g.putImageData ? g.createImageData(cw, ch) : null;
      if (!D || !D.data || !/^#[0-9a-f]{6}$/i.test(TH.bg)) { this.bake = { key, look, c: null }; this.bakeKeep = null; return null; }
      const bg = [1, 3, 5].map((i) => parseInt(TH.bg.slice(i, i + 2), 16)), N = 1024, lut = new Float32Array(3 * (N + 1)), k = 2 * (1 - dk / 100);
      for (let i = 0; i <= N; i++) { const L = liftAt(i / N, TH, k); for (let j = 0; j < 3; j++) lut[3 * i + j] = bg[j] + (L[j] - bg[j]) * L[3]; }
      B = this.bake = { key, look, W, H, dpr, c, g, D, lut, N, row: 0, s: 0x2545f491, cx: (W / 2 + SHIFT) * dpr, cy: H * 0.47 * dpr, R: Math.max(W, H) * LIFT_R * dpr, done: false };
    }
    if (!B.c) return null;
    if (!B.done) {
      const { D, lut, N, cx, cy, R } = B, d = D.data, cw = B.c.width, ch = B.c.height, t0 = performance.now();
      let s = B.s;
      for (let r0 = B.row; B.row < ch && B.row - r0 < 96 && performance.now() - t0 < 5;) {
        for (let m = 0; m < 16 && B.row < ch; m++, B.row++) {
          const dy = (B.row + 0.5 - cy) / R, dy2 = dy * dy;
          for (let x = 0, i = B.row * cw * 4; x < cw; x++, i += 4) {
            const dx = (x + 0.5 - cx) / R, q = Math.sqrt(dx * dx + dy2) * N, j = 3 * (q < N ? q | 0 : N);
            s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
            const u = (s & 0xffff) / 65536 + ((s >>> 16) & 0xffff) / 65536 - 1;
            d[i] = lut[j] + u; d[i + 1] = lut[j + 1] + u; d[i + 2] = lut[j + 2] + u; d[i + 3] = 255;
          }
        }
      }
      B.s = s;
      if (B.row >= ch) {
        B.g.putImageData(D, 0, 0); B.D = null; B.done = true;
        if (this.bakeKeep && this.bakeKeep !== B) { B.from = this.bakeKeep; B.at = performance.now(); }
        this.bakeKeep = null;
      }
    }
    return B.done ? B : this.bakeKeep;
  }
  drawBake(B, W, H, lcx) {
    const ctx = this.ctx, bw = B.c.width / B.dpr, bh = B.c.height / B.dpr;
    if (B.W === W && B.H === H) { ctx.drawImage(B.c, Math.round((lcx - W / 2 - SHIFT) * this.dpr) / this.dpr, 0, bw, bh); return; }
    const s = Math.max(W / B.W, H / B.H);
    ctx.drawImage(B.c, lcx - (B.W / 2 + SHIFT) * s, H * 0.47 - B.H * 0.47 * s, bw * s, bh * s);
  }
  vigStep(W, H, TH, dk, key) {
    let J = this.vigJob;
    if (!J || J.key !== key) {
      const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(W / 2)); c.height = Math.max(1, Math.round(H / 2));
      const g = c.getContext('2d'), E = TH.edge, V = TH.vig, deep = 0.5 + dk / 100, EC = TH.edgeCol || [255, 255, 255];
      const cw = c.width, ch = c.height, r0 = E ? 0 : Math.min(cw, ch) * 0.3, r1 = Math.hypot(cw, ch) * (E ? 0.55 : 0.62);
      const alpha = (u) => { const s = smooth01(u); return Math.min(1, E ? (E[0] + (E[1] - E[0]) * s) * deep : 0.4 * s * deep); };
      const D = g && g.createImageData && g.putImageData ? g.createImageData(cw, ch) : null;
      if (!D || !D.data) {
        if (g) {
          const gr = g.createRadialGradient(cw / 2, ch / 2, r0, cw / 2, ch / 2, r1);
          for (let i = 0; i <= 8; i++) gr.addColorStop(i / 8, E ? `rgba(${EC[0]}, ${EC[1]}, ${EC[2]}, ${alpha(i / 8).toFixed(3)})` : `rgba(${V[0]}, ${V[1]}, ${V[2]}, ${alpha(i / 8).toFixed(3)})`);
          g.fillStyle = gr; g.fillRect(0, 0, cw, ch);
        }
        this.vig = { c, key, screen: !!E }; this.vigJob = null; return;
      }
      J = this.vigJob = { key, c, g, D, alpha, col: E ? EC : V, r0, span: r1 - r0, row: 0, s: 0x9e3779b9, screen: !!E };
    }
    const { D, alpha, col, r0, span } = J, d = D.data, cw = J.c.width, ch = J.c.height, mx = cw / 2, my = ch / 2, t0 = performance.now();
    let s = J.s;
    for (let y0 = J.row; J.row < ch && J.row - y0 < 64 && performance.now() - t0 < 4;) {
      for (let m = 0; m < 8 && J.row < ch; m++, J.row++) {
        const dy2 = (J.row + 0.5 - my) ** 2;
        for (let x = 0, i = J.row * cw * 4; x < cw; x++, i += 4) {
          const u = (Math.sqrt((x + 0.5 - mx) ** 2 + dy2) - r0) / span;
          s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
          const a = alpha(u) * 255;
          d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = a > 0 ? a + (s & 0xffff) / 65536 + ((s >>> 16) & 0xffff) / 65536 - 1 : 0;
        }
      }
    }
    J.s = s;
    if (J.row >= ch) { J.g.putImageData(D, 0, 0); this.vig = { c: J.c, key, screen: J.screen }; this.vigJob = null; }
  }
  *skyGen(W, H) {
    const Wp = Math.ceil((W * 1.15) / 32) * 32, Hp = Math.ceil((H * 1.15) / 32) * 32;
    const TW = Math.ceil(Math.max(Wp * 2.5, 2600)), TH = Math.ceil(Hp * 1.5);
    const img = document.createElement('canvas'); img.width = TW; img.height = TH;
    const R = rng(20261009), B = () => (R() + R() + R() - 1.5) / 1.5;
    const smooth = (e0, e1, v) => { const k = Math.max(0, Math.min(1, (v - e0) / (e1 - e0))); return k * k * (3 - 2 * k); };
    const PY = (TH - H) / 2 - REST_PITCH * 110, P = (sx, sy) => ({ x: (((sx - 0.7 * SKY_PX) % TW) + TW) % TW, y: sy + PY });
    const clumpy = (x, y) => { const w = x / TW; return fbm(x / 260, y / 260, 11) * (1 - w) + fbm((x - TW) / 260, y / 260, 11) * w; };
    const dens = (x, y) => Math.max(0.12, Math.min(1, 0.35 + 0.9 * (clumpy(x, y) - 0.25)));
    const bandAt = P(W / 2, H / 2);
    const bax = Math.cos(-0.49), bay = Math.sin(-0.49);
    const fromBand = (x, y) => Math.min(...[-TW, 0, TW].map((k) => Math.abs((x - bandAt.x - k) * bay - (y - bandAt.y) * bax)));
    const V1 = P(0.8 * W, 0.76 * H);
    const V2 = [[0.5, 0.24], [0.42, 0.78], [0.62, 0.22], [0.33, 0.25], [0.58, 0.8]]
      .map(([fx, fy]) => ({ x: (V1.x + fx * TW) % TW, y: fy * H + PY }))
      .find((p) => fromBand(p.x, p.y) > 0.45 * H) || { x: (V1.x + 0.5 * TW) % TW, y: 0.24 * H + PY };
    const voids = [{ ...V1, R: 0.17 * H, sq: 1.15, seed: 99 }, { ...V2, R: 0.13 * H, sq: 1.5, seed: 57 }];
    let spot = null;
    for (let i = 0; i < 96; i++) for (const fy of [0.22, 0.32, 0.68, 0.78]) {
      const p = { x: (i / 96) * TW, y: fy * H + PY };
      if (voids.some((v) => { let dx = Math.abs(p.x - v.x); dx = Math.min(dx, TW - dx); return Math.hypot(dx, p.y - v.y) < 2.2 * v.R; })) continue;
      const d = fromBand(p.x, p.y);
      if (!spot || d > spot.d) spot = { x: p.x, y: p.y, d };
    }
    const hole = (x, y) => {
      let f = 1;
      for (const v of voids) {
        let dx = Math.abs(x - v.x); dx = Math.min(dx, TW - dx); const dy = y - v.y;
        if (dx > 3 * v.R || Math.abs(dy) > 3 * v.R) continue;
        const d = Math.hypot(dx, dy * v.sq) / v.R / (0.7 + 0.6 * fbm(x / (v.R * 0.55) + 3.1, y / (v.R * 0.55) + 7.7, v.seed));
        f *= Math.max(0.025, smooth(0.45, 1.25, d)) * (1 + 0.4 * Math.exp(-(((d - 1.45) / 0.3) ** 2)));
      }
      return f;
    };
    const want = Math.round(((TW * TH) / 250) * (settingOf(this.plugin.settings, 'stars') / 100));
    const S = { R, TW, TH, dens, hole, tries: 0, x: [], y: [], b: [], k: [], ph: [] };
    yield* this.starsTo(S, want);
    const twinkle = this.paintStars(img, S, want);
    const band = yield* this.bandGen(Wp, Hp);
    const K = { sky: img, skyW: Wp, skyH: Hp, twinkle, voids, hole, starDens: dens, holeSpot: spot, bandAt, starSrc: S, ...band };
    if (!this.sky) this.skyFade = performance.now();
    Object.assign(this, K); this.skyAt = performance.now(); this.holeSprite = null; this.skyRedo = false;
    const now = Date.now();
    this.living = Array.from({ length: this.livingN() }, () => this.newLiving(now, true));
    this.plugin.skyKeep = K;
  }
  *bandGen(W, H) {
    const D = Math.hypot(W, H) / 2, L = Math.ceil(Math.max(2200, 2.2 * D)), h = Math.ceil(1.5 * D);
    const img = document.createElement('canvas'); img.width = L; img.height = h;
    const g = img.getContext('2d'), R = rng(4242), per = L / (3 * D);
    const uc = 0.3, core = (u) => { let d = Math.abs(u - uc); d = Math.min(d, 1 - d); return Math.exp(-((d / 0.11) ** 2)); };
    const wide = (u) => (0.75 + 0.5 * Math.sin(TAU * u + 2.0) ** 2) * (1 + 0.5 * core(u));
    const lane = (u) => D * (0.03 * Math.sin(TAU * 2 * u + 0.4) + 0.017 * Math.sin(TAU * 4 * u + 0.7));
    const smooth = (e0, e1, v) => { const k = Math.max(0, Math.min(1, (v - e0) / (e1 - e0))); return k * k * (3 - 2 * k); };
    const T0 = 0.85 * L, nz = (x, y, s, seed) => { const f = fbm(x / s, y / s, seed); return x < T0 ? f : f + (fbm((x - L) / s, y / s, seed) - f) * smooth(T0, L, x); };
    const sc = 0.18, hw = Math.ceil(L * sc), hh = Math.ceil(h * sc), lum = new Float32Array(hw * hh), warm = new Float32Array(hw * hh);
    const cols = Array.from({ length: hw }, (_, qx) => {
      const x = qx / sc, u = x / L, c = core(u);
      return { x, c, c13: c ** 1.3, mid: h / 2 + lane(u), bw: BAND_W * D * wide(u), riftC: 0.4 * Math.sin(TAU * 3 * u + 0.8) + 0.25 * Math.sin(TAU * 7 * u + 2.1), riftW: 0.45 + 0.35 * nz(x, 0, 380, 116), riftOn: Math.max(smooth(0.38, 0.62, nz(x, 0, 520, 119)), 0.9 * c) };
    });
    let peak = 0;
    for (let qy = 0; qy < hh; qy++) {
      if (qy && qy % 4 === 0) yield;
      for (let qx = 0; qx < hw; qx++) {
        const K0 = cols[qx], x = K0.x, y = qy / sc, c = K0.c, off = y - K0.mid, a = off / K0.bw;
        if (Math.abs(a) > 7 && Math.abs(off) > 0.5 * D) continue;
        const aw = Math.abs(a + 2.2 * (nz(x, y, 210, 101) - 0.5));
        const profile = 0.72 * Math.exp(-aw * aw / 2) + 0.28 * Math.exp(-aw * aw / 9);
        const wx = x + 140 * (nz(x, y, 330, 104) - 0.5), wy = y + 90 * (nz(x + 77, y, 330, 107) - 0.5);
        const cl = smooth(0.36, 0.68, 0.62 * nz(wx, wy, 120, 110) + 0.38 * nz(wx, wy, 48, 113));
        const bulge = K0.c13 * Math.exp(-((off / (0.24 * D)) ** 2));
        let light = profile * (0.22 + cl) + 1.35 * bulge * (0.5 + 0.5 * cl);
        const rg = Math.exp(-(((a - K0.riftC) / K0.riftW) ** 2)) * K0.riftOn;
        const rift = rg > 0.001 ? rg * smooth(0.4, 0.58, nz(wx, wy * 1.6, 70, 122)) : 0;
        const blot = smooth(0.6, 0.72, nz(wx + 300, wy, 62, 125)) * Math.exp(-a * a / 8);
        light *= 1 - Math.min(0.94, 0.95 * rift + 0.8 * blot);
        const i = qy * hw + qx;
        lum[i] = light; warm[i] = Math.min(1, 0.9 * c * Math.exp(-((off / (0.3 * D)) ** 2)) + 0.25 * rift);
        if (light > peak) peak = light;
      }
    }
    const im = g.createImageData(L, h), px = im.data, K = 255 * 0.078;
    for (let y = 0; y < h; y++) {
      if (y && y % 48 === 0) yield;
      const fy = y * sc, y0 = Math.min(hh - 1, Math.floor(fy)), y1 = Math.min(hh - 1, y0 + 1), ty = fy - y0;
      for (let x = 0; x < L; x++) {
        const fx = x * sc, x0 = Math.min(hw - 1, Math.floor(fx)), x1 = x0 + 1 < hw ? x0 + 1 : 0, tx = fx - x0;
        const j00 = y0 * hw + x0, j10 = y0 * hw + x1, j01 = y1 * hw + x0, j11 = y1 * hw + x1;
        const l = (lum[j00] * (1 - tx) + lum[j10] * tx) * (1 - ty) + (lum[j01] * (1 - tx) + lum[j11] * tx) * ty;
        if (l < 0.004) continue;
        const A = Math.floor(K * l * (0.62 + 0.76 * Math.random()) + Math.random());
        if (A <= 0) continue;
        const w = (warm[j00] * (1 - tx) + warm[j10] * tx) * (1 - ty) + (warm[j01] * (1 - tx) + warm[j11] * tx) * ty, i = (y * L + x) * 4;
        px[i] = 220 + 22 * w; px[i + 1] = 216 - 14 * w; px[i + 2] = 212 - 52 * w; px[i + 3] = A;
      }
    }
    g.putImageData(im, 0, 0);
    for (const [du, da, r] of [[-0.035, 0.6, 9], [-0.05, 0.9, 6], [0.02, -0.7, 7]]) {
      const x = (uc + du) * L, y = h / 2 + lane(uc + du) + da * BAND_W * D, gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(232,140,150,0.10)'); gr.addColorStop(1, 'rgba(232,140,150,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    const at = (x, y) => { const j = Math.min(hh - 1, Math.max(0, Math.floor(y * sc))) * hw + Math.min(hw - 1, Math.floor(x * sc)); return [lum[j] / peak, warm[j]]; };
    let lastW = null;
    const star = (x, y, a, w) => {
      if (w !== lastW) { g.fillStyle = w ? 'rgb(242,220,182)' : C.text; lastW = w; }
      g.globalAlpha = Math.min(1, a);
      const bx = Math.floor(x), by = Math.floor(y);
      g.fillRect(bx, by, 1, 1); if (bx > L - 2) g.fillRect(bx - L, by, 1, 1);
    };
    yield;
    for (let made = 0, tries = 0, n = Math.round(16000 * per); made < n && tries < n * 14; tries++) {
      if (tries && tries % SKY_SLICE === 0) yield;
      const x = R() * L, y = h / 2 + lane(x / L) + (R() - 0.5) * 0.9 * D, [b, w] = at(x, y);
      if (R() > 1.6 * Math.pow(b, 0.8)) continue;
      made++;
      star(x, y, 0.035 + 0.2 * b * R() + (R() > 0.97 ? 0.3 : 0), R() < 0.7 * w);
    }
    for (let made = 0, tries = 0, n = Math.round(22000 * per); made < n && tries < n * 14; tries++) {
      if (tries && tries % SKY_SLICE === 0) yield;
      const x = R() * L, y = h / 2 + lane(x / L) + (R() - 0.5) * 0.8 * D, [b, w] = at(x, y);
      if (R() > 1.4 * b) continue;
      made++;
      star(x, y, 0.012 + 0.04 * R(), R() < 0.8 * w);
    }
    g.globalAlpha = 1;
    return { bandImg: img, bandL: L, bandH: h, coreAlong: uc * L, coreAcross: lane(uc) };
  }
  mono() { if (!this.monoFont) this.monoFont = getComputedStyle(document.body).getPropertyValue('--font-monospace').trim() || 'Consolas, monospace'; return this.monoFont; }
}

class Hub {
  constructor(plugin) {
    this.plugin = plugin; this.sources = new Map(); this.keys = new Map(); this.graves = []; this.cache = {}; this.seq = 0;
    this.api = { version: plugin.manifest.version, C, rgba, addSource: (id) => this.addSource(String(id)) };
  }
  each(fn) { for (const v of this.plugin.views) try { fn(v); } catch (e) { v.fail('a hub call', e); } }
  memo(name, make) { return name in this.cache ? this.cache[name] : (this.cache[name] = make()); }
  dirty() { this.cache = {}; }
  list() { return [...this.sources.values()]; }
  allCards() { return this.memo('cards', () => this.list().flatMap((s) => [...s.cards.values()]).sort((a, b) => a.order - b.order || a.key.localeCompare(b.key))); }
  allMoons() { return this.memo('moons', () => this.list().flatMap((s) => s.moons)); }
  allPins() { return this.memo('pins', () => [...new Set(this.list().flatMap((s) => s.pins))]); }
  tags() { return this.memo('tags', () => this.list().map((s) => s.tag).filter(Boolean)); }
  merged(field) { return this.memo(field, () => { const m = new Map(); for (const s of this.list()) if (s[field]) for (const [k, v] of s[field]) m.set(k, v); return m; }); }
  allHalos() { return this.merged('halos'); }
  allFeatured() { return this.merged('featured'); }
  globe() { return this.memo('globe', () => { let g = null, at = -1; for (const s of this.list()) if (s.globe && s.globeAt > at) { g = s.globe; at = s.globeAt; } return g; }); }
  layout() {
    return this.memo('layout', () => {
      const L = this.list().map((s) => s.layout).filter(Boolean), arr = (x) => (Array.isArray(x) ? x : []);
      return { outer: L.flatMap((l) => arr(l.outer)), freshSince: (L.find((l) => l.freshSince) || {}).freshSince || '', freshSkip: L.flatMap((l) => arr(l.freshSkip)), belt2: L.some((l) => l.belt2) };
    });
  }
  colorOf() { const fs = this.list().map((s) => s.colors).filter(Boolean); return fs.length ? fs[fs.length - 1] : null; }
  fixedOf() { const fs = this.list().map((s) => s.fixed).filter(Boolean); return fs.length ? fs[fs.length - 1] : null; }
  graveKey() { return `${KEY}-graves:${this.plugin.app.vault.getName()}`; }
  loadGraves() { try { const v = JSON.parse(window.localStorage.getItem(this.graveKey())); this.graves = Array.isArray(v) ? v : []; } catch { this.graves = []; } }
  saveGraves() { try { window.localStorage.setItem(this.graveKey(), JSON.stringify(this.graves.slice(0, 2000))); } catch {   } }
  buryAs(src, entries) {
    const have = new Set(this.graves.map((g) => g.id));
    let added = 0;
    for (const e of Array.isArray(entries) ? entries : []) {
      if (!e || e.id == null) continue;
      const gid = `${src}:${e.id}`;
      if (have.has(gid)) continue;
      this.graves.push({ id: gid, name: String(e.name || e.id), line: e.line ? String(e.line) : '', copy: e.copy ? String(e.copy) : '', at: Number(e.at) || Date.now() });
      have.add(gid); added++;
    }
    if (!added) return;
    this.graves.sort((a, b) => b.at - a.at); this.saveGraves(); this.each((v) => v.gravesChanged());
  }
  addSource(id) {
    if (this.sources.has(id)) this.sources.get(id).src.remove();
    const hub = this, S = { id, cards: new Map(), moons: [], globe: null, globeAt: 0, halos: null, featured: null, pins: [], layout: null, colors: null, fixed: null, keys: [] };
    const toMap = (m) => (m instanceof Map ? m : new Map(Object.entries(m || {})));
    const all = (fn) => hub.each(fn);
    S.src = {
      addCard(c) { S.cards.set(String(c.id), { key: `${id}:${c.id}`, order: Number.isFinite(c.order) ? c.order : 100, render: c.render }); hub.dirty(); all((v) => v.mountCards()); },
      removeCard(cid) { S.cards.delete(String(cid)); hub.dirty(); all((v) => v.mountCards()); },
      refresh(cid) { const list = cid === undefined ? [...S.cards.values()] : [S.cards.get(String(cid))].filter(Boolean); all((v) => list.forEach((c) => v.renderCard(c))); },
      setMoons(list) {
        S.moons = (Array.isArray(list) ? list : []).filter((m) => m && m.id != null).map((m) => Object.assign({}, m, { id: String(m.id), key: `${id}:${m.id}`, name: String(m.name || m.id) }));
        hub.dirty(); const moons = hub.allMoons(); all((v) => v.setMoons(moons));
      },
      blast(mid, kind) { all((v) => { const m = v.moons.find((x) => x.key === `${id}:${mid}`); if (m) { if (kind === 'crumble') v.crumble(m); else v.explode(m); } }); },
      ripples(list) {
        const s = (Array.isArray(list) ? list : [list]).map(Number).filter((x) => Number.isFinite(x) && x > 0);
        if (s.length) all((v) => { for (const x of s) if (v.rippleQ.length < 60) v.rippleQ.push(x); v.rippleGap = Math.max(300, Math.min(15000, 55000 / Math.max(1, v.rippleQ.length))); });
      },
      shootingStar() { all((v) => v.shoot()); },
      setGlobe(g) { S.globe = g || null; S.globeAt = ++hub.seq; hub.dirty(); },
      setTag(text) { S.tag = String(text || '').slice(0, 40); hub.dirty(); },
      setHalos(m) { S.halos = toMap(m); hub.dirty(); },
      setFeatured(m) { S.featured = toMap(m); hub.dirty(); },
      pinNames(list) { S.pins = (Array.isArray(list) ? list : []).map(String); hub.dirty(); all((v) => { v.top = null; }); },
      bury(entries) { hub.buryAs(id, entries); },
      addKey(k, label, fn) {
        k = String(k || '').toLowerCase();
        if (k.length !== 1 || 'otg/'.includes(k) || typeof fn !== 'function') throw new Error(`Rho Network: can't use the key "${k}"`);
        hub.keys.set(k, { label: String(label || k).toUpperCase(), fn, src: id }); S.keys.push(k); all((v) => v.hint());
      },
      setLayout(lo) { S.layout = lo || null; hub.dirty(); all((v) => v.soon()); },
      setColors(fn) { S.colors = typeof fn === 'function' ? fn : null; hub.dirty(); all((v) => v.soon()); },
      setFixedColors(fn) { S.fixed = typeof fn === 'function' ? fn : null; hub.dirty(); all((v) => v.soon()); },
      toast(text) { all((v) => v.toast(String(text))); },
      copyText(text, label) { const v = [...hub.plugin.views][0]; if (v) v.copyText(String(text), label); else try { navigator.clipboard.writeText(String(text)); } catch {   } },
      remove() {
        if (hub.sources.get(id) !== S) return;
        hub.sources.delete(id);
        for (const k of S.keys) if (hub.keys.get(k) && hub.keys.get(k).src === id) hub.keys.delete(k);
        hub.dirty(); const moons = hub.allMoons();
        all((v) => { v.mountCards(); v.setMoons(moons); v.hint(); v.top = null; v.soon(); });
      },
    };
    this.sources.set(id, S);
    return S.src;
  }
}

class RhoSettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const el = this.containerEl, P = this.plugin;
    el.empty();
    for (const o of SETTINGS) {
      if (o.hidden) continue;
      if (o.sec) { new Setting(el).setName(o.sec).setHeading(); continue; }
      const s = new Setting(el).setName(o.name).setDesc(o.desc), v = settingOf(P.settings, o.key);
      if (o.range) {
        const [lo, hi, st] = o.range, dflt = DEFAULTS[o.key];
        let sl = null, box = null, rb = null;
        const quiet = (x) => { const el = rb && (rb.extraSettingsEl || rb.buttonEl); if (el) el.classList.toggle('rn-off', x === dflt); };
        const put = (x) => { x = Math.max(lo, Math.min(hi, x)); P.setSetting(o.key, x); if (sl) sl.setValue(x); if (box) box.value = String(x); quiet(x); };
        s.addExtraButton((b) => {
          rb = b; b.setIcon('reset').setTooltip(`Back to the default, ${dflt}${o.unit || ''}`).onClick(() => put(dflt));
          const el = b.extraSettingsEl || b.buttonEl; if (el && el.classList) el.classList.add('rn-quiet-reset');
          quiet(v);
        });
        s.addSlider((c) => { sl = c; c.setLimits(lo, hi, st).setValue(v).setDynamicTooltip().onChange((x) => { P.setSetting(o.key, x); if (box) box.value = String(x); quiet(x); }); });
        s.addText((c) => {
          box = c.inputEl; box.type = 'number'; box.min = String(lo); box.max = String(hi); box.step = String(st); box.value = String(v); box.classList.add('rn-setting-num');
          box.addEventListener('change', () => { const x = parseFloat(box.value); if (Number.isFinite(x)) put(Math.round((x - lo) / st) * st + lo); else box.value = String(settingOf(P.settings, o.key)); });
        });
      }
      else if (o.choice) s.addDropdown((c) => { for (const [k, name] of o.choice) c.addOption(k, name); c.setValue(v).onChange((x) => P.setSetting(o.key, x)); });
      else if (o.toggle) s.addToggle((c) => c.setValue(v).onChange((x) => P.setSetting(o.key, x)));
      else if (o.list) s.addTextArea((c) => { c.setPlaceholder('Archive\nTemplates').setValue(v.join('\n')).onChange((x) => P.setSetting(o.key, x.split('\n'))); if (c.inputEl) c.inputEl.rows = 4; });
    }
  }
}

class RhoNetwork extends Plugin {
  diag(line) {
    if (!this.settings || !this.settings.log) return;
    const a = this.app.vault.adapter, file = `${this.manifest.dir}/status.txt`, stamp = `${new Date().toLocaleString('en-GB')}  ${line}`;
    this.logChain = (this.logChain || Promise.resolve()).then(async () => {
      let old = ''; try { if (await a.exists(file)) old = await a.read(file); } catch {   }
      await a.write(file, (old + stamp + '\n').split('\n').filter(Boolean).slice(-40).join('\n') + '\n');
    }).catch(() => {   });
  }
  async onload() {
    VIEW = KEY = this.manifest.id;
    let d = null, fixed = false;
    try { d = await this.loadData(); } catch {   }
    if (!d || typeof d !== 'object') { d = await this.readSpare(); fixed = !!d; if (d) this.diag('settings read back from the spare copy'); }
    if (d) fixed = migrateSettings(d) || fixed;
    this.settings = Object.assign({}, DEFAULTS, d || {});
    this.settings.settingsV = Math.max(SETTINGS_V, +this.settings.settingsV || 0);
    if (fixed) this.saveSettings(); else if (d) this.writeSpare();
    this.views = new Set();
    this.hub = new Hub(this); this.hub.loadGraves();
    this.api = this.hub.api;
    this.diag(`plugin loaded, version ${this.manifest.version}`);
    this.registerView(VIEW, (leaf) => { this.diag('view created'); return new NetworkView(leaf, this); });
    this.addRibbonIcon('globe', 'Open Rho Network', () => this.activate());
    this.addSettingTab(new RhoSettings(this.app, this));
    this.addCommand({ id: 'open', name: 'Open', callback: () => this.activate() });
    this.app.workspace.trigger(`${this.manifest.id}:ready`, this.api);
    this.addCommand({ id: 'demo-eggs', name: 'Show the easter eggs (demo)', callback: async () => {
      let leaf = this.app.workspace.getLeavesOfType(VIEW)[0];
      if (!leaf) { await this.activate(); leaf = this.app.workspace.getLeavesOfType(VIEW)[0]; }
      if (leaf) { this.app.workspace.revealLeaf(leaf); setTimeout(() => leaf.view && leaf.view.demo && leaf.view.demo(), 800); }
    } });
  }
  async activate() {
    this.diag('globe clicked');
    try {
      for (const old of this.app.workspace.getLeavesOfType(VIEW)) old.detach();
      const leaf = this.app.workspace.getLeaf('tab');
      await leaf.setViewState({ type: VIEW, active: true });
      await this.app.workspace.revealLeaf(leaf);
      this.diag('tab opened');
    } catch (e) { this.diag(`could not open the tab: ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`); console.error('Rho Network: could not open the tab', e); }
  }
  saveSettings() { clearTimeout(this.saveT); this.saveT = 0; try { const r = this.saveData(this.settings); if (r && r.catch) r.catch(() => {}); } catch {   } this.writeSpare(); }
  sparePath() { return `${this.app.vault.configDir}/${this.manifest.id}.json`; }
  async readSpare() {
    try {
      const a = this.app.vault.adapter, p = this.sparePath();
      if (!(await a.exists(p))) return null;
      const d = JSON.parse(await a.read(p));
      return d && typeof d === 'object' && !Array.isArray(d) ? d : null;
    } catch { return null; }
  }
  writeSpare() { try { const r = this.app.vault.adapter.write(this.sparePath(), JSON.stringify(this.settings, null, 2)); if (r && r.catch) r.catch(() => {}); } catch {   } }
  setSetting(key, v) {
    const S = this.settings;
    if (JSON.stringify(S[key]) === JSON.stringify(v)) return;
    S[key] = v;
    const o = SETTINGS.find((x) => x.key === key);
    if (o && (o.range || o.list)) { clearTimeout(this.saveT); this.saveT = setTimeout(() => this.saveSettings(), 400); }
    else this.saveSettings();
    for (const view of this.views) { try { view.applySetting(key); } catch (e) { view.fail('a setting', e); } }
  }
  onunload() {
    if (this.saveT) this.saveSettings();
    this.app.workspace.trigger(`${this.manifest.id}:unload`);
    if (this.hub) this.hub.sources.clear();
  }
}

module.exports = RhoNetwork;
module.exports.__test = { GLOBE_R, NetworkView, Hub, layout, tint, hash, findHub, yawToRight, shortTurn, firstLineOf, ago, makeBelt, groupNotes, inScope, scopeHub, planetScore, byName, baseName, PLANET_ALL, PLANET_SUM, PLANET_MIN, PLANET_FOCUS, REACH, CORE, RING_CAP, agoShort, topBy, sparkBuckets, foldersOf, WIDGETS, WIDGET_DEFAULT, SPANS, SETTINGS, DEFAULTS, THEMES, settingOf, SETTINGS_V, migrateSettings, excludeList, liftAt, paperLum, RhoSettings, WAVE_MS, FLOOD_QUIET, PAPER, INK, inkOf, PALETTE, SAND, MONO, HALLOWEEN, PRESETS };
