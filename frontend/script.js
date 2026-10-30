(function () {
  const SUPABASE_URL = 'https://your-project.supabase.co';
  const SUPABASE_ANON_KEY = 'your-anon-key';
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const maxApp = window.Max || (window.parent && window.parent.Max);
  if (maxApp && typeof maxApp.ready === 'function') maxApp.ready();

  const DEFAULT_CENTER = [48.4805, 135.0795];
  const GLOW_VALUE_THRESHOLD = 0.7;
  const NEIGHBOR_PENALTY = 1.5;
  const HEXES_PER_CLASS = 3;

  let center = DEFAULT_CENTER.slice();
  let outline = [];
  let hexes = [];
  let hexRadius = 0;
  let gridLayer = null;
  let currentInstitutionId = 1;
  let currentUserClass = null;
  let classesConfig = [];

  const map = L.map('map', { center: DEFAULT_CENTER, zoom: 19, maxZoom: 21, zoomControl: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap', maxNativeZoom: 19, maxZoom: 21
  }).addTo(map);

  const outlineLayer = L.polygon([], {
    color: '#1a1a1a', weight: 1.5, dashArray: '4 4',
    fillColor: '#1a1a1a', fillOpacity: 0.02
  }).addTo(map);

  const countEl = document.getElementById('hexCount');
  const myHexesEl = document.getElementById('myHexes');
  const statusEl = document.getElementById('statusLine');
  const buildingNameEl = document.getElementById('buildingName');
  const toastEl = document.getElementById('toast');
  const legendEl = document.getElementById('legend');

  const attackModal = document.getElementById('attackModal');
  const closeModalBtn = document.getElementById('closeModal');
  const cancelAttackBtn = document.getElementById('cancelAttack');
  const confirmAttackBtn = document.getElementById('confirmAttack');
  const attackHexIdEl = document.getElementById('attackHexId');
  const attackOwnerEl = document.getElementById('attackOwner');
  const attackDistanceEl = document.getElementById('attackDistance');
  const attackMultiplierEl = document.getElementById('attackMultiplier');
  const attackCurrentPointsEl = document.getElementById('attackCurrentPoints');
  const attackPointsInput = document.getElementById('attackPointsInput');

  let toastTimer = null;
  let selectedHex = null;

  function setStatus(t) { statusEl.textContent = t; }
  function showToast(text, color) {
    const c = color || '#1a1a1a';
    toastEl.innerHTML = '<span class="dot" style="background:' + c + '"></span>' + text;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
  }
  function setBuildingName(name) { buildingNameEl.textContent = name || 'Загрузка...'; }

  function buildLegend() {
    legendEl.innerHTML = '';
    classesConfig.forEach(g => {
      const row = document.createElement('div');
      row.className = 'legend-item';
      row.innerHTML = '<div class="legend-swatch" style="color:' + g.color + '"></div><span>' + g.name + '</span>';
      legendEl.appendChild(row);
    });
    const homeRow = document.createElement('div');
    homeRow.className = 'legend-item';
    homeRow.innerHTML = '<div class="legend-swatch" style="border: 1.5px dashed #d4a017; background: transparent;"></div><span>Домашняя</span>';
    legendEl.appendChild(homeRow);
    const note = document.createElement('div');
    note.className = 'legend-note';
    note.textContent = 'Число — очки в день. Золотое свечение — ценные сектора. Штраф x1.5 за каждый гекс расстояния.';
    legendEl.appendChild(note);
  }

  function createCircleOutline(lat, lng, radiusMeters) {
    const points = [];
    for (let i = 0; i < 32; i++) {
      const angle = (i / 32) * Math.PI * 2;
      const x = Math.cos(angle) * radiusMeters;
      const y = Math.sin(angle) * radiusMeters;
      const mPerLng = 111320 * Math.cos(lat * Math.PI / 180);
      points.push([lat + y / 110540, lng + x / mPerLng]);
    }
    return points;
  }

  async function loadInstitution(id) {
    const { data, error } = await supabase
      .from('educational_institutions')
      .select('*').eq('id', id).single();
    if (error) throw error;
    center = [data.latitude, data.longitude];
    setBuildingName(data.name);
    outline = createCircleOutline(data.latitude, data.longitude, 100);
  }

  async function loadClasses(id) {
    const { data, error } = await supabase
      .from('institution_classes').select('*').eq('institution_id', id);
    if (error) throw error;
    const colors = ['#ef5350','#42a5f5','#66bb6a','#ffa726','#ab47bc','#26c6da','#ec407a','#8d6e63','#78909c','#7e57c2'];
    classesConfig = data.map((c, i) => ({ id: c.id.toString(), name: c.name, color: colors[i % colors.length] }));
    currentUserClass = classesConfig[0]?.id;
  }

  async function hexesExist(id) {
    const { data } = await supabase.from('map_hexes').select('id').eq('institution_id', id).limit(1);
    return data && data.length > 0;
  }

  async function sendHexesToBackend(hexesData, institutionId) {
    const payload = hexesData.map(h => ({
      institution_id: institutionId,
      q: h.q, r: h.s,
      name: h.ownerName || 'Нейтрально',
      status: h.isHome ? 'home' : 'active',
      type: h.owner ? 'captured' : 'neutral',
      metadata: {
        owner: h.owner, ownerName: h.ownerName, color: h.color,
        isHome: h.isHome, value: h.value, dailyPoints: h.dailyPoints,
        neighbors: h.neighbors
      }
    }));
    const { error } = await supabase.from('map_hexes').insert(payload);
    if (error) throw error;
  }

  async function loadHexesFromDB(id) {
    const { data, error } = await supabase.from('map_hexes').select('*').eq('institution_id', id);
    if (error) throw error;
    hexes = data.map(h => {
      const m = h.metadata || {};
      const mPerLng = 111320 * Math.cos(center[0] * Math.PI / 180);
      const x = (h.q + h.r / 2) * hexRadius * Math.sqrt(3);
      const y = h.r * hexRadius * 1.5;
      return {
        id: h.id, q: h.q, s: h.r,
        latlng: [center[0] + y / 110540, center[1] + x / mPerLng],
        owner: m.owner || null, ownerName: h.name,
        color: m.color || '#b5b5b5',
        isHome: h.status === 'home',
        value: m.value || 0, dailyPoints: m.dailyPoints || 0,
        neighbors: m.neighbors || []
      };
    });
  }

  async function initApp() {
    setStatus('Инициализация...');
    try {
      await loadInstitution(currentInstitutionId);
      await loadClasses(currentInstitutionId);
      buildLegend();

      if (await hexesExist(currentInstitutionId)) {
        await loadHexesFromDB(currentInstitutionId);
        setStatus('Карта загружена из БД');
      } else {
        const result = HexGenerator.generate({
          outline, center, hexesPerClass: HEXES_PER_CLASS, classes: classesConfig
        });
        hexes = result.hexes;
        hexRadius = result.radius;
        await sendHexesToBackend(hexes, currentInstitutionId);
        setStatus('Гексы сгенерированы и сохранены в БД');
      }
      rebuild();
      fitToOutline();
    } catch (e) {
      setStatus('Ошибка: ' + e.message);
      showToast('Ошибка: ' + e.message, '#ef5350');
    }
  }

  function rebuild() {
    if (gridLayer) { map.removeLayer(gridLayer); gridLayer = null; }
    outlineLayer.setLatLngs(outline);
    countEl.textContent = hexes.length;
    myHexesEl.textContent = hexes.filter(h => h.owner === currentUserClass).length;
    if (hexes.length) gridLayer = new HexGridLayer(hexes).addTo(map);
  }

  function fitToOutline() {
    if (outline.length < 3) return;
    map.fitBounds(L.latLngBounds(outline).pad(0.6), { maxZoom: 20, animate: true });
  }

  function getDistanceToNearestOwnedHex(targetHex, ownerId, allHexes) {
    if (targetHex.owner === ownerId) return 0;
    const hexById = new Map(allHexes.map(h => [h.id, h]));
    const visited = new Set([targetHex.id]);
    const queue = [[targetHex.id, 0]];
    while (queue.length > 0) {
      const [curId, dist] = queue.shift();
      const cur = hexById.get(curId);
      if (cur && cur.owner === ownerId) return dist;
      if (cur) {
        for (const nId of cur.neighbors) {
          if (!visited.has(nId)) { visited.add(nId); queue.push([nId, dist + 1]); }
        }
      }
    }
    return -1;
  }

  async function handleHexClick(hex) {
    if (hex.isHome) { showToast('🏠 Нельзя атаковать домашнюю территорию', '#ef5350'); return; }
    selectedHex = hex;
    showToast('Сектор #' + hex.id + ' · ' + hex.ownerName + ' · +' + hex.dailyPoints + ' очков/день', hex.color);

    const distance = getDistanceToNearestOwnedHex(hex, currentUserClass, hexes);
    const multiplier = distance > 0 ? Math.pow(NEIGHBOR_PENALTY, distance) : 1;
    const basePoints = Math.floor(Math.random() * 50) + 30;
    const required = Math.floor(basePoints * multiplier);

    attackHexIdEl.textContent = '#' + hex.id;
    attackOwnerEl.textContent = hex.ownerName || 'Нейтрально';
    attackDistanceEl.textContent = distance + ' гекс(ов)';
    attackMultiplierEl.textContent = 'x' + multiplier.toFixed(2);
    attackCurrentPointsEl.textContent = required;
    attackPointsInput.value = '';
    attackModal.classList.add('show');
  }

  function closeAttackModal() { attackModal.classList.remove('show'); selectedHex = null; }
  closeModalBtn.onclick = closeAttackModal;
  cancelAttackBtn.onclick = closeAttackModal;
  attackModal.addEventListener('click', e => { if (e.target === attackModal) closeAttackModal(); });

  confirmAttackBtn.onclick = async function() {
    if (!selectedHex) return;
    const points = parseInt(attackPointsInput.value);
    if (!points || points < 1) { showToast('Введите количество очков', '#ef5350'); return; }

    const distance = getDistanceToNearestOwnedHex(selectedHex, currentUserClass, hexes);
    const multiplier = distance > 0 ? Math.pow(NEIGHBOR_PENALTY, distance) : 1;
    const basePoints = Math.floor(Math.random() * 50) + 30;
    const required = Math.floor(basePoints * multiplier);

    if (points >= required) {
      const group = classesConfig.find(g => g.id === currentUserClass);
      const { error } = await supabase.from('map_hexes').update({
        name: group?.name || 'Неизвестно',
        type: 'captured',
        metadata: {
          ...(selectedHex.neighbors ? { neighbors: selectedHex.neighbors } : {}),
          owner: currentUserClass, ownerName: group?.name, color: group?.color,
          isHome: false, value: selectedHex.value, dailyPoints: selectedHex.dailyPoints
        }
      }).eq('id', selectedHex.id);

      if (error) { showToast('Ошибка: ' + error.message, '#ef5350'); return; }

      selectedHex.owner = currentUserClass;
      selectedHex.ownerName = group?.name || currentUserClass;
      selectedHex.color = group?.color || '#b5b5b5';
      showToast('✅ Сектор #' + selectedHex.id + ' захвачен!', '#66bb6a');
      closeAttackModal();
      rebuild();
    } else {
      showToast('❌ Атака не удалась. Нужно: ' + required + ' очков', '#ef5350');
    }
  };

  const HexGridLayer = L.Layer.extend({
    initialize: function (items) { this.items = items; this._hovered = null; this._raf = null; },
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
      this._resize(); this._draw();
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
    _pixelRadius: function () {
      const latRad = center[0] * Math.PI / 180;
      const mPerPx = 156543.03392 * Math.cos(latRad) / Math.pow(2, this._map.getZoom());
      return hexRadius / mPerPx;
    },
    _scheduleRedraw: function () {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => { this._raf = null; this._draw(); });
    },
    _draw: function () {
      const ctx = this._ctx;
      const size = this._map.getSize();
      ctx.clearRect(0, 0, size.x, size.y);
      for (const hex of this.items) {
        const p = this._map.latLngToContainerPoint(hex.latlng);
        const r = this._pixelRadius();
        if (p.x < -r || p.x > size.x + r || p.y < -r || p.y > size.y + r) continue;
        this._drawHex(ctx, p.x, p.y, r, hex, hex === this._hovered);
      }
    },
    _drawHex: function (ctx, x, y, r, hex, hovered) {
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
      ctx.fillStyle = hex.color + (hovered ? '55' : '2e');
      ctx.fill();
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;

      if (hex.isHome) {
        ctx.strokeStyle = '#d4a017'; ctx.lineWidth = hovered ? 2 : 1.5; ctx.setLineDash([4, 3]);
      } else {
        ctx.strokeStyle = hex.color; ctx.lineWidth = hovered ? 1.6 : 1; ctx.setLineDash([]);
      }
      ctx.globalAlpha = hovered ? 1 : 0.85;
      ctx.stroke(); ctx.setLineDash([]);

      ctx.globalAlpha = 1;
      if (r > 16) {
        ctx.fillStyle = '#1a1a1a';
        ctx.globalAlpha = hovered ? 0.95 : 0.75;
        ctx.font = '600 ' + Math.max(9, Math.min(13, r / 3.2)) + 'px -apple-system, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
        ctx.strokeText('#' + hex.id, x, y - 5);
        ctx.fillText('#' + hex.id, x, y - 5);

        ctx.font = '500 ' + Math.max(8, Math.min(11, r / 4)) + 'px -apple-system, sans-serif';
        ctx.globalAlpha = hovered ? 0.85 : 0.55;
        ctx.strokeText(hex.ownerName, x, y + 7);
        ctx.fillText(hex.ownerName, x, y + 7);

        if (r > 22) {
          const txt = '+' + hex.dailyPoints;
          const fs = Math.max(8, Math.min(10, r / 5));
          ctx.font = '700 ' + fs + 'px -apple-system, sans-serif';
          const ty = y + r * 0.55;
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
          ctx.strokeText(txt, x, ty);
          ctx.fillStyle = hex.value > GLOW_VALUE_THRESHOLD ? '#f9a825' : '#1a1a1a';
          ctx.globalAlpha = 1;
          ctx.fillText(txt, x, ty);
        }
      }

      if (hex.isHome && r > 18) {
        const ix = x - r * 0.55, iy = y - r * 0.55, is = Math.max(4, r * 0.18);
        ctx.strokeStyle = '#fff'; ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.2; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.arc(ix, iy, is * 1.3, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(ix, iy - is); ctx.lineTo(ix + is, iy - is * 0.1); ctx.lineTo(ix - is, iy - is * 0.1); ctx.closePath(); ctx.stroke();
        ctx.strokeRect(ix - is * 0.7, iy - is * 0.1, is * 1.4, is * 0.9);
      }
      ctx.restore();
    },
    _hitTest: function (x, y) {
      let best = null, bestDist = Infinity;
      for (const hex of this.items) {
        const p = this._map.latLngToContainerPoint(hex.latlng);
        const r = this._pixelRadius();
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < r * 0.92 && d < bestDist) { bestDist = d; best = hex; }
      }
      return best;
    },
    _localCoords: function (e) {
      const r = this._canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    },
    _onClick: function (e) {
      const c = this._localCoords(e);
      const hex = this._hitTest(c.x, c.y);
      if (hex) handleHexClick(hex);
    },
    _onMove: function (e) {
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

  initApp();
})();