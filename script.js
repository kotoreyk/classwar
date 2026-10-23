(function () {
const DEFAULT_CENTER = [48.4827, 135.0838];
const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LNG = 82650;

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

const HexGridLayer = L.Layer.extend({
initialize: function (items) {
this.items = items;
},
onAdd: function (map) {
this._map = map;
const canvas = document.createElement('canvas');
canvas.className = 'hex-grid-canvas';
this._canvas = canvas;
this._ctx = canvas.getContext('2d');
map.getContainer().appendChild(canvas);
map.on('move zoom resize viewreset', this._resize, this);
this._resize();
this._draw();
return this;
},
onRemove: function (map) {
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
this._drawHex(ctx, p.x, p.y, r, hex);
}
},
_drawHex: function (ctx, x, y, r, hex) {
ctx.save();
ctx.beginPath();
for (let i = 0; i < 6; i++) {
const a = Math.PI / 3 * i - Math.PI / 6;
const px = x + r * Math.cos(a);
const py = y + r * Math.sin(a);
if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
}
ctx.closePath();
ctx.fillStyle = hex.color + '40';
ctx.fill();
ctx.strokeStyle = hex.color;
ctx.lineWidth = 1;
ctx.stroke();
ctx.restore();
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
result.push({
id: id++,
q: q,
s: s,
size: size,
latlng: latlng,
color: '#b5b5b5'
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
setStatus('Гексы построены (тестовая сетка 5×5).');
}

function setStatus(text) {
statusEl.textContent = text;
}

rebuild();
})();