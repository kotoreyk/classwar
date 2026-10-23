(function () {
const map = L.map('map', {
center: [48.4827, 135.0838],
zoom: 19,
maxZoom: 21
});

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
attribution: '© OpenStreetMap contributors',
maxNativeZoom: 19,
maxZoom: 21
}).addTo(map);

console.log('ready');
})();