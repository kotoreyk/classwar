(function () {
const DEFAULT_CENTER = [48.4805, 135.0795];
const M_PER_DEG_LAT = 110540;
const HEX_AREA_COEFF = 3 * Math.sqrt(3) / 2;
const MIN_HEX_RADIUS = 0.8;
const MAX_HEX_RADIUS = 20;
const FACTIONS = [
{ id: 'neutral', name: 'Нейтрально', color: '#b5b5b5', weight: 5 },
{ id: '10А', name: '10 А', color: '#ef5350', weight: 2 },
{ id: '10Б', name: '10 Б', color: '#42a5f5', weight: 2 },
{ id: '11А', name: '11 А', color: '#66bb6a', weight: 2 },
{ id: '11Б', name: '11 Б', color: '#ffa726', weight: 2 },
{ id: '11В', name: '11 В', color: '#ab47bc', weight: 2 }
];
let center = DEFAULT_CENTER.slice();
let outline = [];
let hexes = [];
let hexRadius = 0;
let manualRadius = 0;
let gridLayer = null;
let editing = false;
let draft = [];
const map = L.map('map', {
center: DEFAULT_CENTER,
zoom: 19,
maxZoom: 21,
zoomControl: true
});
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
attribution: '© OpenStreetMap',
maxNativeZoom: 19,
maxZoom: 21
}).addTo(map);
const outlineLayer = L.polygon([], {
color: '#1a1a1a',
weight: 1.5,
dashArray: '4 4',
fillColor: '#1a1a1a',
fillOpacity: 0.02
}).addTo(map);
const draftLayer = L.layerGroup().addTo(map);
const countEl = document.getElementById('hexCount');
const sizeEl = document.getElementById('hexSize');
const statusEl = document.getElementById('statusLine');
const editBtn = document.getElementById('editBtn');
const toastEl = document.getElementById('toast');
const densitySlider = document.getElementById('densitySlider');
const densityValue = document.getElementById('densityValue');
const autoBtn = document.getElementById('autoBtn');
let toastTimer = null;
function setStatus(text) { statusEl.textContent = text; }
function showToast(text, color) {
const c = color || '#1a1a1a';
toastEl.innerHTML = '<span class="dot" style="background:' + c + '"></span>' + text;
toastEl.classList.add('show');
clearTimeout(toastTimer);
toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
}
const legendEl = document.getElementById('legend');
FACTIONS.forEach(f => {
const row = document.createElement('div');
row.className = 'legend-item';
row.innerHTML =
'<div class="legend-swatch" style="color:' + f.color + '"></div>' +
'<span>' + f.name + '</span>';
legendEl.appendChild(row);
});
function metersPerDegLng(lat) {
return 111320 * Math.cos(lat * Math.PI / 180);
}
function toLocal(latlng) {
return [
(latlng[1] - center[1]) * metersPerDegLng(center[0]),
(latlng[0] - center[0]) * M_PER_DEG_LAT
];
}
function toLatLng(x, y) {
return [
center[0] + y / M_PER_DEG_LAT,
center[1] + x / metersPerDegLng(center[0])
];
}
function pointInPolygon(x, y, poly) {
let inside = false;
for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
const xi = poly[i][0], yi = poly[i][1];
const xj = poly[j][0], yj = poly[j][1];
const intersect = ((yi > y) !== (yj > y)) &&
(x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi);
if (intersect) inside = !inside;
}
return inside;
}
function polygonArea(points) {
let sum = 0;
for (let i = 0; i < points.length; i++) {
const a = points[i], b = points[(i + 1) % points.length];
sum += a[0] * b[1] - b[0] * a[1];
}
return Math.abs(sum / 2);
}
function polygonBounds(points) {
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (const p of points) {
if (p[0] < minX) minX = p[0];
if (p[1] < minY) minY = p[1];
if (p[0] > maxX) maxX = p[0];
if (p[1] > maxY) maxY = p[1];
}
return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
}
function polygonCentroid(points) {
const bounds = polygonBounds(points);
return [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2];
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
function computeAdaptiveRadius(area) {
const target = Math.round(Math.max(25, Math.min(150, Math.sqrt(area) / 2)));
const r = Math.sqrt(area / (target * HEX_AREA_COEFF));
return Math.max(MIN_HEX_RADIUS, Math.min(MAX_HEX_RADIUS, r));
}
function buildHexField(polyLocal, size) {
const sqrt3 = Math.sqrt(3);
const bounds = polygonBounds(polyLocal);
const origin = polygonCentroid(polyLocal);
const cx = origin[0];
const cy = origin[1];
const halfW = (bounds.maxX - bounds.minX) / 2 + size * 2;
const halfH = (bounds.maxY - bounds.minY) / 2 + size * 2;
const qRange = Math.ceil(halfW / (size * sqrt3)) + 1;
const sRange = Math.ceil(halfH / (size * 1.5)) + 1;
const result = [];
let id = 1;
for (let q = -qRange; q <= qRange; q++) {
for (let s = -sRange; s <= sRange; s++) {
const x = cx + size * sqrt3 * (q + s / 2);
const y = cy + size * 1.5 * s;
if (!pointInPolygon(x, y, polyLocal)) continue;
const owner = weightedRandom(FACTIONS);
result.push({
id: id++,
q: q,
s: s,
size: size,
latlng: toLatLng(x, y),
owner: owner.id,
ownerName: owner.name,
color: owner.color,
hp: Math.floor(Math.random() * 60) + 40
});
}
}
return result;
}
function generateHexes() {
if (outline.length < 3) return { hexes: [], radius: 0, area: 0 };
const polyLocal = outline.map(toLocal);
const area = polygonArea(polyLocal);
if (area < 1) return { hexes: [], radius: 0, area: area };
let r;
if (manualRadius > 0) {
r = manualRadius;
} else {
r = computeAdaptiveRadius(area);
}
const field = buildHexField(polyLocal, r);
return { hexes: field, radius: r, area: area };
}
const HexGridLayer = L.Layer.extend({
initialize: function (items) {
this.items = items;
this._hovered = null;
this._raf = null;
},
onAdd: function (map) {
this._map = map;
const canvas = document.createElement('canvas');
canvas.className = 'hex-grid-canvas';
canvas.style.pointerEvents = editing ? 'none' : 'auto';
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
cancelAnimationFrame(this._raf);
this._canvas.removeEventListener('click', this._click);
this._canvas.removeEventListener('mousemove', this._move);
this._canvas.removeEventListener('mouseleave', this._leave);
map.off('move zoom resize viewreset', this._resize, this);
this._canvas.remove();
},
_resize: function () {
const size = this._map.getSize();
const dpr = window.devicePixelRatio || 1;
this._canvas.width = size.x * dpr;
this._canvas.height = size.y * dpr;
this._canvas.style.width = size.x + 'px';
this._canvas.style.height = size.y + 'px';
this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
this._draw();
},
_pixelRadius: function (hex) {
const latRad = center[0] * Math.PI / 180;
const mPerPx = 156543.03392 * Math.cos(latRad) / Math.pow(2, this._map.getZoom());
return hex.size / mPerPx;
},
_scheduleRedraw: function () {
if (this._raf) return;
this._raf = requestAnimationFrame(() => {
this._raf = null;
this._draw();
});
},
_draw: function () {
const ctx = this._ctx;
const size = this._map.getSize();
ctx.clearRect(0, 0, size.x, size.y);
for (const hex of this.items) {
const p = this._map.latLngToContainerPoint(hex.latlng);
const r = this._pixelRadius(hex);
if (p.x < -r || p.x > size.x + r || p.y < -r || p.y > size.y + r) continue;
this._drawHex(ctx, p.x, p.y, r, hex, hex === this._hovered);
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
ctx.fillStyle = hex.color + (hovered ? '55' : '2e');
ctx.fill();
ctx.strokeStyle = hex.color;
ctx.lineWidth = hovered ? 1.6 : 1;
ctx.globalAlpha = hovered ? 1 : 0.85;
ctx.stroke();
ctx.globalAlpha = 1;
if (r > 16) {
ctx.fillStyle = '#1a1a1a';
ctx.globalAlpha = hovered ? 0.95 : 0.75;
ctx.font = '600 ' + Math.max(9, Math.min(13, r / 3.2)) + 'px -apple-system, "Inter", sans-serif';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
ctx.fillText('#' + hex.id, x, y - 5);
ctx.font = '500 ' + Math.max(8, Math.min(11, r / 4)) + 'px -apple-system, "Inter", sans-serif';
ctx.globalAlpha = hovered ? 0.85 : 0.55;
ctx.fillText(hex.ownerName, x, y + 7);
}
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
if (editing) return;
const c = this._localCoords(e);
const hex = this._hitTest(c.x, c.y);
if (!hex) return;
const msg = 'Сектор #' + hex.id + ' · ' + hex.ownerName;
console.log('Вы кликнули на сектор #' + hex.id + '. Текущий владелец: ' + hex.ownerName, hex);
showToast(msg, hex.color);
},
_onMove: function (e) {
if (editing) return;
const c = this._localCoords(e);
const hex = this._hitTest(c.x, c.y);
if (hex !== this._hovered) {
this._hovered = hex;
this._canvas.style.cursor = hex ? 'pointer' : 'default';
this._scheduleRedraw();
}
},
_onLeave: function () {
if (this._hovered) {
this._hovered = null;
this._canvas.style.cursor = 'default';
this._scheduleRedraw();
}
}
});
function rebuild() {
if (gridLayer) {
map.removeLayer(gridLayer);
gridLayer = null;
}
outlineLayer.setLatLngs(outline);
const result = generateHexes();
hexes = result.hexes;
hexRadius = result.radius;
countEl.textContent = hexes.length;
sizeEl.textContent = hexRadius ? hexRadius.toFixed(1) : '—';
if (hexes.length) {
gridLayer = new HexGridLayer(hexes).addTo(map);
setStatus('Гексы построены внутри контура здания.');
} else if (outline.length >= 3) {
if (result.area < 5) {
setStatus('Площадь здания менее 5 м² — слишком мало для сетки.');
} else {
setStatus('Не удалось разместить гексы. Попробуйте уменьшить размер.');
}
} else {
setStatus('Нажмите «Разметить корпус» и обведите здание на карте.');
}
}
function fitToOutline() {
if (outline.length < 3) return;
map.fitBounds(L.latLngBounds(outline).pad(0.6), { maxZoom: 20, animate: true });
}
function applyOutline(points) {
outline = points.map(p => [p[0], p[1]]);
rebuild();
fitToOutline();
}
function setEditing(value) {
editing = value;
editBtn.classList.toggle('active', value);
editBtn.textContent = value ? 'Завершить' : 'Разметить корпус';
if (value) {
draft = [];
draftLayer.clearLayers();
map.dragging.disable();
map.doubleClickZoom.disable();
map.getContainer().style.cursor = 'crosshair';
setStatus('Кликайте по углам корпуса. Enter — сохранить, Esc — отмена.');
} else {
map.dragging.enable();
map.doubleClickZoom.enable();
map.getContainer().style.cursor = '';
draftLayer.clearLayers();
}
if (gridLayer && gridLayer._canvas) {
gridLayer._canvas.style.pointerEvents = value ? 'none' : 'auto';
}
}
function updateDraft() {
draftLayer.clearLayers();
draft.forEach(p => {
L.circleMarker(p, {
radius: 4,
color: '#1a1a1a',
fillColor: '#1a1a1a',
fillOpacity: 1,
weight: 1
}).addTo(draftLayer);
});
if (draft.length > 1) {
L.polyline(draft.concat([draft[0]]), {
color: '#1a1a1a',
weight: 1.5,
dashArray: '4 4',
fillOpacity: 0.04
}).addTo(draftLayer);
}
}
map.on('click', function (e) {
if (!editing) return;
const p = [e.latlng.lat, e.latlng.lng];
const last = draft[draft.length - 1];
if (last && Math.hypot(last[0] - p[0], last[1] - p[1]) < 0.000002) return;
draft.push(p);
updateDraft();
});
document.addEventListener('keydown', function (e) {
if (!editing) return;
if (e.key === 'Enter') {
e.preventDefault();
if (draft.length >= 3) {
const points = draft.slice();
setEditing(false);
applyOutline(points);
showToast('Контур сохранён', '#66bb6a');
} else {
showToast('Нужно минимум 3 точки', '#ef5350');
}
}
if (e.key === 'Escape') {
setEditing(false);
setStatus('Разметка отменена.');
}
});
editBtn.onclick = function () {
if (editing) {
if (draft.length >= 3) {
const points = draft.slice();
setEditing(false);
applyOutline(points);
} else {
setEditing(false);
}
} else {
setEditing(true);
}
};
document.getElementById('clearBtn').onclick = function () {
outline = [];
rebuild();
showToast('Контур сброшен', '#1a1a1a');
};
function updateDensityUI() {
if (manualRadius > 0) {
densitySlider.value = manualRadius;
densityValue.textContent = manualRadius.toFixed(1) + ' м';
autoBtn.classList.remove('active');
} else {
densityValue.textContent = 'авто';
autoBtn.classList.add('active');
if (hexRadius > 0) {
densitySlider.value = hexRadius;
}
}
}
densitySlider.oninput = function () {
manualRadius = parseFloat(this.value);
densityValue.textContent = manualRadius.toFixed(1) + ' м';
autoBtn.classList.remove('active');
rebuild();
};
autoBtn.onclick = function () {
manualRadius = 0;
updateDensityUI();
rebuild();
showToast('Автоматический размер', '#1a1a1a');
};
rebuild();
updateDensityUI();
})();