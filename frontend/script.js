(function () {
  'use strict';
  // Клиент «тонкий»: все данные и правила — на сервере (/api). Здесь только отрисовка и запросы.
  const maxApp = window.Max || window.WebApp || (window.parent && window.parent.Max);
  if (maxApp && typeof maxApp.ready === 'function') maxApp.ready();

  const params = new URLSearchParams(location.search);
  const DEV_USER = params.get('dev_user');           // работает только если на backend DEV_MODE=1
  const GLOW_VALUE_THRESHOLD = 0.7;
  const POLL_MS = 15000;

  let institutionId = parseInt(params.get('inst') || '0', 10) || null;
  let me = null;
  let center = [48.4805, 135.0795];
  let hexRadius = 1;
  let hexes = [];
  let classesById = {};
  let outline = [];
  let gridLayer = null;
  let selectedHex = null;
  let currentQuote = null;
  let toastTimer = null;

  const $ = id => document.getElementById(id);
  const countEl = $('hexCount'), myHexesEl = $('myHexes'), balanceEl = $('myBalance'), classEl = $('myClass');
  const statusEl = $('statusLine'), buildingNameEl = $('buildingName'), toastEl = $('toast'), legendEl = $('legend');
  const attackModal = $('attackModal'), confirmBtn = $('confirmAttack');

  // ---------- helpers ----------
  function authHeaders() {
    const h = { 'Content-Type': 'application/json' };
    const initData = maxApp && (maxApp.initData || (maxApp.WebApp && maxApp.WebApp.initData));
    if (initData) h['X-Max-Init-Data'] = initData;
    else if (DEV_USER) h['X-Dev-User-Id'] = DEV_USER;
    return h;
  }
  async function api(method, path, body) {
    const res = await fetch('/api' + path, { method, headers: authHeaders(), body: body ? JSON.stringify(body) : undefined });
    let data = null;
    try { data = await res.json(); } catch (_) { /* пустое тело */ }
    if (!res.ok) throw new Error((data && data.detail) || ('HTTP ' + res.status));
    return data;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function rgba(hex, a) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return 'rgba(181,181,181,' + a + ')';
    const n = parseInt(m[1], 16);
    return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function setStatus(t) { statusEl.textContent = t; }
  function showToast(text, color) {
    toastEl.textContent = '';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = color || '#1a1a1a';
    toastEl.appendChild(dot);
    toastEl.appendChild(document.createTextNode(text));
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }
  function ownerOf(h) { return h.owner_class_id ? classesById[h.owner_class_id] : null; }

  // ---------- map ----------
  const map = L.map('map', { center, zoom: 19, maxZoom: 21, zoomControl: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap', maxNativeZoom: 19, maxZoom: 21
  }).addTo(map);
  const outlineLayer = L.polygon([], { color: '#1a1a1a', weight: 1.5, dashArray: '4 4', fillColor: '#1a1a1a', fillOpacity: 0.02 }).addTo(map);

  function circleOutline(lat, lng, radiusM) {
    const pts = [], mPerLng = 111320 * Math.cos(lat * Math.PI / 180);
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      pts.push([lat + Math.sin(a) * radiusM / 110540, lng + Math.cos(a) * radiusM / mPerLng]);
    }
    return pts;
  }

  function buildLegend() {
    legendEl.textContent = '';
    Object.values(classesById).forEach(c => {
      const row = document.createElement('div');
      row.className = 'legend-item';
      const sw = document.createElement('div');
      sw.className = 'legend-swatch';
      sw.style.color = c.color;
      const label = document.createElement('span');
      label.textContent = c.name + (c.hexes != null ? ' · ' + c.hexes : '');
      row.appendChild(sw); row.appendChild(label);
      legendEl.appendChild(row);
    });
    const note = document.createElement('div');
    note.className = 'legend-note';
    note.textContent = '«+N» — ОД в день. Золотое свечение — ценные сектора. Пунктир — домашние (не захватываются).';
    legendEl.appendChild(note);
  }

  function updateHud(board) {
    countEl.textContent = hexes.length;
    const mine = me && me.class_id ? hexes.filter(h => h.owner_class_id === me.class_id).length : 0;
    myHexesEl.textContent = mine;
    balanceEl.textContent = me && me.class_id ? me.ap_balance : '—';
    classEl.textContent = me && me.class_name ? me.class_name : '—';
    if (board) board.forEach(b => { if (classesById[b.id]) classesById[b.id].hexes = Number(b.hexes); });
    buildLegend();
  }

  function applyMap(data, first) {
    const inst = data.institution;
    center = [inst.latitude, inst.longitude];
    hexRadius = inst.hex_radius_m;
    buildingNameEl.textContent = inst.name;
    classesById = {};
    data.classes.forEach(c => { classesById[c.id] = { ...c }; });
    hexes = data.hexes.map(h => ({ ...h, latlng: [h.lat, h.lng] }));
    outline = circleOutline(inst.latitude, inst.longitude, inst.outline_radius_m);
    outlineLayer.setLatLngs(outline);
    if (gridLayer) { gridLayer.items = hexes; gridLayer._scheduleRedraw(); }
    else { gridLayer = new HexGridLayer(hexes).addTo(map); }
    updateHud(data.leaderboard);
    if (first) map.fitBounds(L.latLngBounds(outline).pad(0.3), { maxZoom: 20 });
  }

  async function refreshMe() {
    try { me = await api('GET', '/me'); } catch (_) { me = null; }
    if (me && me.registered && !institutionId && me.institution_id) institutionId = me.institution_id;
  }

  async function loadAll(first) {
    if (!institutionId) {
      const list = await api('GET', '/institutions');
      institutionId = list.length ? list[0].id : null;
    }
    if (!institutionId) throw new Error('Нет учреждений');
    const data = await api('GET', '/institutions/' + institutionId + '/map');
    await refreshMe();
    applyMap(data, first);
    if (!me || !me.registered) setStatus('Режим просмотра. Чтобы играть, авторизуйтесь в боте.');
    else if (!me.class_id) setStatus('Вы вошли как ' + me.role + '. Захват доступен игрокам классов.');
    else setStatus('Ваш класс: ' + me.class_name + '. Нажмите на сектор, чтобы захватить.');
  }

  // ---------- capture flow ----------
  async function handleHexClick(hex) {
    const owner = ownerOf(hex);
    selectedHex = hex;
    if (hex.is_home) { showToast('🏠 Домашняя территория: ' + (owner ? owner.name : ''), '#d4a017'); return; }
    if (!me || !me.class_id) { showToast('Захват доступен только игрокам, вошедшим через бота', '#ef5350'); return; }
    if (hex.owner_class_id === me.class_id) { showToast('Это уже ваш сектор', owner && owner.color); return; }
    try {
      currentQuote = await api('GET', '/hexes/' + hex.id + '/quote');
    } catch (e) { showToast(e.message, '#ef5350'); return; }
    $('attackHexId').textContent = '#' + hex.id;
    $('attackOwner').textContent = owner ? owner.name : 'Нейтрально';
    $('attackIncome').textContent = '+' + hex.daily_points + '/день';
    $('attackDistance').textContent = currentQuote.distance + ' гекс.';
    $('attackMultiplier').textContent = 'x' + currentQuote.multiplier.toFixed(2);
    const costEl = $('attackCost');
    costEl.textContent = currentQuote.cost + ' ОД';
    $('attackBalance').textContent = currentQuote.balance + ' ОД';
    const enough = currentQuote.balance >= currentQuote.cost;
    costEl.classList.toggle('cost-bad', !enough);
    confirmBtn.disabled = !enough;
    attackModal.classList.add('show');
  }

  function closeModal() { attackModal.classList.remove('show'); selectedHex = null; currentQuote = null; }
  $('closeModal').onclick = closeModal;
  $('cancelAttack').onclick = closeModal;
  attackModal.addEventListener('click', e => { if (e.target === attackModal) closeModal(); });

  confirmBtn.onclick = async function () {
    if (!selectedHex) return;
    confirmBtn.disabled = true;
    const id = selectedHex.id;
    try {
      const res = await api('POST', '/hexes/' + id + '/capture');
      showToast('✅ Сектор #' + id + ' захвачен за ' + res.cost + ' ОД', '#66bb6a');
      closeModal();
      await loadAll(false);
    } catch (e) {
      showToast('❌ ' + e.message, '#ef5350');
      await loadAll(false).catch(() => {});   // цена/владелец могли измениться
      closeModal();
    } finally { confirmBtn.disabled = false; }
  };

  // ---------- canvas layer (клики слушаем на карте, canvas пассивный — карту можно двигать) ----------
  const HexGridLayer = L.Layer.extend({
    initialize: function (items) { this.items = items; this._hovered = null; this._raf = null; },
    onAdd: function (m) {
      this._map = m;
      this._canvas = document.createElement('canvas');
      this._canvas.className = 'hex-grid-canvas';
      this._ctx = this._canvas.getContext('2d');
      m.getContainer().appendChild(this._canvas);
      m.on('move zoom resize viewreset', this._resize, this);
      m.on('click', this._onClick, this);
      m.on('mousemove', this._onMove, this);
      m.on('mouseout', this._onLeave, this);
      this._resize();
    },
    onRemove: function (m) {
      cancelAnimationFrame(this._raf);
      m.off('move zoom resize viewreset', this._resize, this);
      m.off('click', this._onClick, this);
      m.off('mousemove', this._onMove, this);
      m.off('mouseout', this._onLeave, this);
      this._canvas.remove();
    },
    _resize: function () {
      const size = this._map.getSize(), dpr = window.devicePixelRatio || 1;
      this._canvas.width = size.x * dpr; this._canvas.height = size.y * dpr;
      this._canvas.style.width = size.x + 'px'; this._canvas.style.height = size.y + 'px';
      this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this._draw();
    },
    _pixelRadius: function () {
      const mPerPx = 156543.03392 * Math.cos(center[0] * Math.PI / 180) / Math.pow(2, this._map.getZoom());
      return hexRadius / mPerPx;
    },
    _scheduleRedraw: function () {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => { this._raf = null; this._draw(); });
    },
    _draw: function () {
      const ctx = this._ctx, size = this._map.getSize(), r = this._pixelRadius();
      ctx.clearRect(0, 0, size.x, size.y);
      for (const hex of this.items) {
        const p = this._map.latLngToContainerPoint(hex.latlng);
        if (p.x < -r || p.x > size.x + r || p.y < -r || p.y > size.y + r) continue;
        this._drawHex(ctx, p.x, p.y, r, hex, hex === this._hovered);
      }
    },
    _drawHex: function (ctx, x, y, r, hex, hovered) {
      const owner = ownerOf(hex);
      const color = owner ? owner.color : '#b5b5b5';
      const mine = me && me.class_id && hex.owner_class_id === me.class_id;
      ctx.save();
      if (hex.value > GLOW_VALUE_THRESHOLD && r > 15) {
        ctx.shadowColor = '#ffd54f';
        ctx.shadowBlur = 8 + (hex.value - GLOW_VALUE_THRESHOLD) * 20;
      }
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 3 * i - Math.PI / 6;
        const px = x + r * Math.cos(a), py = y + r * Math.sin(a);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = rgba(color, hovered ? 0.35 : (mine ? 0.28 : 0.18));
      ctx.fill();
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
      if (hex.is_home) { ctx.strokeStyle = '#d4a017'; ctx.lineWidth = hovered ? 2 : 1.5; ctx.setLineDash([4, 3]); }
      else { ctx.strokeStyle = color; ctx.lineWidth = mine ? 2 : (hovered ? 1.6 : 1); ctx.setLineDash([]); }
      ctx.stroke(); ctx.setLineDash([]);

      if (r > 16) {
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.fillStyle = '#1a1a1a';
        const name = owner ? owner.name : 'Нейтрально';
        ctx.font = '600 ' + Math.max(9, Math.min(13, r / 3)) + 'px -apple-system, sans-serif';
        ctx.strokeText(name, x, y - 4); ctx.fillText(name, x, y - 4);
        if (r > 22) {
          const txt = (hex.is_home ? '⌂ ' : '') + '+' + hex.daily_points;
          ctx.font = '700 ' + Math.max(8, Math.min(11, r / 4.5)) + 'px -apple-system, sans-serif';
          ctx.strokeText(txt, x, y + r * 0.45);
          ctx.fillStyle = hex.value > GLOW_VALUE_THRESHOLD ? '#f9a825' : '#1a1a1a';
          ctx.fillText(txt, x, y + r * 0.45);
        }
      }
      ctx.restore();
    },
    _hitTest: function (pt) {
      let best = null, bestD = Infinity;
      const r = this._pixelRadius();
      for (const hex of this.items) {
        const p = this._map.latLngToContainerPoint(hex.latlng);
        const d = Math.hypot(p.x - pt.x, p.y - pt.y);
        if (d < r * 0.92 && d < bestD) { bestD = d; best = hex; }
      }
      return best;
    },
    _onClick: function (e) { const hex = this._hitTest(e.containerPoint); if (hex) handleHexClick(hex); },
    _onMove: function (e) {
      const hex = this._hitTest(e.containerPoint);
      if (hex !== this._hovered) {
        this._hovered = hex;
        this._map.getContainer().classList.toggle('hex-pointer', !!hex);
        this._scheduleRedraw();
      }
    },
    _onLeave: function () {
      if (this._hovered) { this._hovered = null; this._scheduleRedraw(); }
    }
  });

  // ---------- start ----------
  (async function init() {
    try {
      await loadAll(true);
      setInterval(() => { if (!attackModal.classList.contains('show')) loadAll(false).catch(() => {}); }, POLL_MS);
    } catch (e) {
      setStatus('Ошибка: ' + e.message);
      showToast('Ошибка: ' + e.message, '#ef5350');
    }
  })();
})();
