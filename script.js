(function () {
const DEFAULT_CENTER = [48.4827, 135.0838];
const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LNG = 82650;

const FACTIONS = [
{ id: 'neutral', name: 'Нейтрально', color: '#b5b5b5', weight: 5 },
{ id: '10А', name: '10 А', color: '#ef5350', weight: 2 },
{ id: '10Б', name: '10 Б', color: '#42a5f5', weight: 2 },
{ id: '11А', name: '11 А', color: '#66bb6a', weight: 2 },
{ id: '11Б', name: '11 Б', color: '#ffa726', weight: 2 },
{ id: '11В', name: '11 В', color: '#ab47bc', weight: 2 }
];

let center = DEFAULT_CENTER.slice();
let hexes = [];
let gridLayer = null;

const map = L.map('map', {
center: DEFAULT_CENTER,
zoom: 19,
maxZoom: 21
});

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
attribution: '© OpenStreetMap contributors',
maxNativeZoom: 19,
maxZoom: 21
}).addTo(map);

const countEl = document.getElementById('hexCount');
const sizeEl = document.getElementById('hexSize');
const statusEl = document.getElementById('statusLine');
const toastEl = document.getElementById('toast');

let toastTimer = null;

function setStatus(text) {
statusEl.textContent = text;
}

function showToast(text, color) {
const c = color || '#1a1a1a';
toastEl.innerHTML = '<span class="dot" style="background:' + c + '"></span>' + text;
toastEl.classList.add('show');
clearTimeout(toastTimer);
toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
}

function toLocal(latlng) {
return [
(latlng[1] - center[1]) * M_PER_DEG_LNG,
(latlng[0] - center[0]) * M_PER_DEG_LAT
];
}

function toLatLng(x, y) {
return [
center[0] + y / M_PER_DEG_LAT,
center[1] + x / M_PER_DEG_LNG
];
}

function weightedRandom(items) {
const total = items.reduce((s, it) => s + it.weight, 0);
let r = Math.random() * total;
for (const it of items) {
r -= it.weight;
if (r <= 0) return it;
}
return items[0];
}

const HexGridLayer = L.Layer.extend({
initialize: function (items) {
this.items = items;
this._hovered = null;
},
onAdd: function (map) {
this._map = map;
const canvas = document.createElement('canvas');
canvas.className = 'hex-grid-canvas';
this._canvas = canvas;
this._ctx = canvas.getContext('2d');
map.getContainer().appendChild(canvas);
this._click = this._onClick.bind(this);
this._move = this._onMove.bind(this);
this._leave = this._onLeave.bind(this);
canvas.addEventListener('click', this._click);
canvas.addEventListener('mousemove', this._move);
canvas.addEventListener('mouseleave', this._leave);
map.on('move zoom resize viewreset', this._resize, this);
this._resize();
this._draw();
return this;
},
onRemove: function (map) {
this._canvas.removeEventListener('click', this._click);
this._canvas.removeEventListener('mousemove', this._move);
this._canvas.removeEventListener('mouseleave', this._leave);
map.off('move zoom resize viewreset', this._resize, this);
this._canvas.remove();
},
_resize: function () {
const size = this._map.getSize();
this._canvas.width = size.x;
this._canvas.height = size.y;
this._canvas.style.width = size.x + 'px';
this._canvas.style.height = size.y + 'px';
this._draw();
},
_pixelRadius: function (hex) {
const mPerPx = 156543.03392 * Math.cos(center[0] * Math.PI / 180) / Math.pow(2, this._map.getZoom());
return hex.size / mPerPx;
},
_draw: function () {
const ctx = this._ctx;
const size = this._map.getSize();
ctx.clearRect(0, 0, size.x, size.y);
for (const hex of this.items) {
const p = this._map.latLngToContainerPoint(hex.latlng);
const r = this._pixelRadius(hex);
if (p.x < -r || p.x > size.x + r || p.y < -r || p.y > size.y + r) continue;
const isHovered = hex === this._hovered;
this._drawHex(ctx, p.x, p.y, r, hex, isHovered);
}
},
_drawHex: function (ctx, x, y, r, hex, hovered) {
ctx.save();
ctx.beginPath();
for (let i = 0; i < 6; i++) {
const a = Math.PI / 3 * i - Math.PI / 6;
const px = x + r * Math.cos(a);
const py = y + r * Math.sin(a);
if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
}
ctx.closePath();
ctx.fillStyle = hex.color + (hovered ? '66' : '40');
ctx.fill();
ctx.strokeStyle = hex.color;
ctx.lineWidth = hovered ? 2 : 1;
ctx.stroke();
ctx.restore();
},
_hitTest: function (x, y) {
let best = null;
let bestDist = Infinity;
for (const hex of this.items) {
const p = this._map.latLngToContainerPoint(hex.latlng);
const r = this._pixelRadius(hex);
const d = Math.hypot(p.x - x, p.y - y);
if (d < r * 0.92 && d < bestDist) {
bestDist = d;
best = hex;
}
}
return best;
},
_localCoords: function (e) {
const rect = this._canvas.getBoundingClientRect();
return { x: e.clientX - rect.left, y: e.clientY - rect.top };
},
_onClick: function (e) {
const c = this._localCoords(e);
const hex = this._hitTest(c.x, c.y);
if (!hex) return;
const msg = 'Сектор #' + hex.id + ' · ' + hex.ownerName;
console.log('Вы кликнули на сектор #' + hex.id + '. Текущий владелец: ' + hex.ownerName, hex);
showToast(msg, hex.color);
},
_onMove: function (e) {
const c = this._localCoords(e);
const hex = this._hitTest(c.x, c.y);
if (hex !== this._hovered) {
this._hovered = hex;
this._canvas.style.cursor = hex ? 'pointer' : 'default';
this._draw();
}
},
_onLeave: function () {
if (this._hovered) {
this._hovered = null;
this._canvas.style.cursor = 'default';
this._draw();
}
}
});

function buildHexField(size) {
const sqrt3 = Math.sqrt(3);
const result = [];
let id = 1;
for (let q = -2; q <= 2; q++) {
for (let s = -2; s <= 2; s++) {
const x = size * sqrt3 * (q + s / 2);
const y = size * 1.5 * s;
const latlng = toLatLng(x, y);
const owner = weightedRandom(FACTIONS);
result.push({
id: id++,
q: q,
s: s,
size: size,
latlng: latlng,
owner: owner.id,
ownerName: owner.name,
color: owner.color,
hp: Math.floor(Math.random() * 60) + 40
});
}
}
return result;
}

function rebuild() {
if (gridLayer) {
map.removeLayer(gridLayer);
gridLayer = null;
}
const size = 3;
hexes = buildHexField(size);
countEl.textContent = hexes.length;
sizeEl.textContent = size.toFixed(1);
gridLayer = new HexGridLayer(hexes).addTo(map);
setStatus('Гексы построены (тестовая сетка 5×5). Наведите на гекс.');
}

rebuild();
})();