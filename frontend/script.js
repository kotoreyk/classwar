(function () {
  const DEFAULT_CENTER = [48.4805, 135.0795];
  const NEIGHBOR_PENALTY = 1.5;
  const GLOW_VALUE_THRESHOLD = 0.7;

  let center = DEFAULT_CENTER.slice();
  let outline = [];
  let hexes = [];
  let hexRadius = 0;
  let gridLayer = null;
  let editing = false;
  let draft = [];
  let currentAddress = '';
  let buildingId = 1;
  let currentUserGroup = 'group_1';

  const API = {
    base: 'https://your-backend.ru/api',

    async getMap(buildingId) {
      // TODO: раскомментировать когда бэк будет готов
      // const res = await fetch(`${this.base}/map?building_id=${buildingId}`);
      // return await res.json();
      
      return null;
    },

    async sendMapToBackend(data) {
      // TODO: раскомментировать когда бэк будет готов
      // const res = await fetch(`${this.base}/map/generate`, {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify(data)
      // });
      // return await res.json();
      
      console.log('Отправка на бэк (закомментировано):', data);
      return null;
    },

    async hexAction(hexId, action, points = 0) {
      const hex = hexes.find(h => h.id === hexId);
      if (!hex) return { type: 'error', reason: 'Гекс не найден' };

      if (hex.isHome) {
        return { type: 'forbidden', reason: 'Нельзя атаковать домашнюю территорию', updated: false };
      }

      const distance = this.getDistanceToNearestOwnedHex(hex, currentUserGroup, hexes);
      const multiplier = distance > 0 ? Math.pow(NEIGHBOR_PENALTY, distance) : 1;
      const basePoints = Math.floor(Math.random() * 50) + 30;
      const requiredPoints = Math.floor(basePoints * multiplier);

      if (action === 'attack') {
        const success = points >= requiredPoints;

        if (success) {
          hex.owner = currentUserGroup;
          const group = GROUPS_CONFIG.find(g => g.id === currentUserGroup);
          hex.ownerName = group ? group.name : currentUserGroup;
          hex.color = group ? group.color : '#b5b5b5';
          return { type: 'success', success: true, hex_id: hexId, updated: true };
        } else {
          return {
            type: 'failed',
            success: false,
            reason: 'Недостаточно очков. Нужно: ' + requiredPoints,
            updated: false
          };
        }
      }

      return {
        type: 'battle_start',
        current_points: requiredPoints,
        distance: distance,
        multiplier: multiplier,
        hex_id: hexId,
        updated: false
      };
    },

    getDistanceToNearestOwnedHex(targetHex, ownerId, allHexes) {
      if (targetHex.owner === ownerId) return 0;

      const hexById = new Map(allHexes.map(h => [h.id, h]));
      const visited = new Set();
      const queue = [[targetHex.id, 0]];
      visited.add(targetHex.id);

      while (queue.length > 0) {
        const [currentId, dist] = queue.shift();
        const current = hexById.get(currentId);

        if (current && current.owner === ownerId) return dist;

        if (current) {
          for (const neighborId of current.neighbors) {
            if (!visited.has(neighborId)) {
              visited.add(neighborId);
              queue.push([neighborId, dist + 1]);
            }
          }
        }
      }

      return -1;
    }
  };

  const GROUPS_CONFIG = [
    { id: 'group_1', name: 'Группа 1', color: '#ef5350' },
    { id: 'group_2', name: 'Группа 2', color: '#42a5f5' },
    { id: 'group_3', name: 'Группа 3', color: '#66bb6a' }
  ];

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
  const buildingNameEl = document.getElementById('buildingName');
  const editBtn = document.getElementById('editBtn');
  const toastEl = document.getElementById('toast');
  const legendEl = document.getElementById('legend');
  const addressInput = document.getElementById('addressInput');
  const searchBtn = document.getElementById('searchBtn');

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
  let pendingAttackData = null;

  function setStatus(text) { statusEl.textContent = text; }

  function showToast(text, color) {
    const c = color || '#1a1a1a';
    toastEl.innerHTML = '<span class="dot" style="background:' + c + '"></span>' + text;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
  }

  function setBuildingName(name) {
    buildingNameEl.textContent = name || 'Адрес не задан';
  }

  function buildLegend() {
    legendEl.innerHTML = '';
    GROUPS_CONFIG.forEach(g => {
      const row = document.createElement('div');
      row.className = 'legend-item';
      row.innerHTML = '<div class="legend-swatch" style="color:' + g.color + '"></div><span>' + g.name + '</span>';
      legendEl.appendChild(row);
    });
    const neutralRow = document.createElement('div');
    neutralRow.className = 'legend-item';
    neutralRow.innerHTML = '<div class="legend-swatch" style="color:#b5b5b5"></div><span>Нейтрально</span>';
    legendEl.appendChild(neutralRow);
    const homeRow = document.createElement('div');
    homeRow.className = 'legend-item';
    homeRow.innerHTML = '<div class="legend-swatch" style="border: 1.5px dashed #d4a017; background: transparent;"></div><span>Домашняя</span>';
    legendEl.appendChild(homeRow);
    const note = document.createElement('div');
    note.className = 'legend-note';
    note.textContent = 'Число на гексе — очки в день. Золотое свечение — ценные сектора. Штраф x1.5 за каждый гекс расстояния.';
    legendEl.appendChild(note);
  }

  buildLegend();

  async function loadMapFromBackend() {
    try {
      setStatus('Загрузка карты...');
      const data = await API.getMap(buildingId);

      if (data) {
        outline = data.building.outline;
        hexes = data.hexes;
        hexRadius = data.hex_radius;
        setBuildingName(data.address);
        rebuild();
        setStatus('Карта загружена из бэка');
      } else {
        setStatus('Данные не найдены в бэке. Генерация локально...');
        generateAndDisplay();
      }
    } catch (e) {
      setStatus('Ошибка: ' + e.message);
      showToast('Не удалось загрузить карту', '#ef5350');
    }
  }

  function generateAndDisplay() {
    if (outline.length < 3) {
      setStatus('Сначала создайте контур здания');
      return;
    }

    const buildingData = {
      id: buildingId,
      address: currentAddress || 'Локальная карта',
      groupCount: GROUPS_CONFIG.length,
      radius: 5,
      outline: outline.map(p => ({ x: p[0], y: p[1], lat: p[0], lng: p[1] }))
    };

    const generatedData = HexGenerator.generate(buildingData);
    
    hexes = generatedData.hexes;
    hexRadius = generatedData.hex_radius;
    
    rebuild();
    setStatus('Гексы сгенерированы локально');

    API.sendMapToBackend(generatedData);
  }

  async function handleHexClick(hex) {
    if (hex.isHome) {
      showToast('🏠 Нельзя атаковать домашнюю территорию', '#ef5350');
      return;
    }

    selectedHex = hex;
    showToast('Сектор #' + hex.id + ' · ' + hex.ownerName + ' · +' + hex.dailyPoints + ' очков/день', hex.color);

    try {
      const result = await API.hexAction(hex.id, 'inspect');

      if (result.type === 'battle_start') {
        attackHexIdEl.textContent = '#' + hex.id;
        attackOwnerEl.textContent = hex.ownerName || 'Нейтрально';
        attackDistanceEl.textContent = result.distance + ' гекс(ов)';
        attackMultiplierEl.textContent = 'x' + result.multiplier.toFixed(2);
        attackCurrentPointsEl.textContent = result.current_points;
        attackPointsInput.value = '';
        pendingAttackData = result;
        attackModal.classList.add('show');
      } else if (result.type === 'forbidden') {
        showToast('🚫 ' + result.reason, '#ef5350');
      }

      if (result.updated) {
        rebuild();
      }
    } catch (e) {
      showToast('Ошибка связи', '#ef5350');
    }
  }

  async function searchBuilding(address) {
    setStatus('Поиск адреса...');
    try {
      const res = await fetch(
        'https://nominatim.openstreetmap.org/search?format=json&q=' +
          encodeURIComponent(address) +
          '&limit=1',
        {
          headers: { 'Accept-Language': 'ru' }
        }
      );
      if (!res.ok) throw new Error('Ошибка геокодера');
      const data = await res.json();
      if (!data || data.length === 0) {
        throw new Error('Адрес не найден');
      }
      return {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
        displayName: data[0].display_name
      };
    } catch (e) {
      throw new Error('Поиск: ' + e.message);
    }
  }

  async function fetchBuildingOutline(lat, lng) {
    setStatus('Загрузка контура здания...');
    const radius = 30;
    const query = `
      [out:json][timeout:10];
      (
        way["building"](around:${radius},${lat},${lng});
      );
      out body;
      >;
      out skel qt;
    `;
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: 'data=' + encodeURIComponent(query)
    });
    if (!res.ok) throw new Error('Ошибка Overpass API');
    const data = await res.json();

    const nodes = {};
    for (const el of data.elements) {
      if (el.type === 'node') {
        nodes[el.id] = [el.lat, el.lon];
      }
    }

    const buildings = [];
    for (const el of data.elements) {
      if (el.type === 'way' && el.tags && el.tags.building) {
        const coords = el.nodes
          .map((id) => nodes[id])
          .filter(Boolean);
        if (coords.length >= 3) {
          buildings.push(coords);
        }
      }
    }

    if (buildings.length === 0) {
      throw new Error('Контур здания не найден');
    }

    return buildings[0].map(coord => ({ x: coord[0], y: coord[1], lat: coord[0], lng: coord[1] }));
  }

  async function handleSearch() {
    const address = addressInput.value.trim();
    if (!address) {
      showToast('Введите адрес', '#ef5350');
      return;
    }

    searchBtn.disabled = true;
    try {
      const geo = await searchBuilding(address);
      center = [geo.lat, geo.lng];
      currentAddress = geo.displayName;
      setBuildingName(geo.displayName.split(',')[0]);

      const outlineCoords = await fetchBuildingOutline(geo.lat, geo.lng);
      outline = outlineCoords.map(p => [p.lat, p.lng]);
      
      generateAndDisplay();
      fitToOutline();
      showToast('Здание найдено и гексы сгенерированы', '#66bb6a');
    } catch (e) {
      showToast(e.message, '#ef5350');
      setStatus('Ошибка: ' + e.message);
    } finally {
      searchBtn.disabled = false;
    }
  }

  searchBtn.onclick = handleSearch;
  addressInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSearch();
  });

  function closeAttackModal() {
    attackModal.classList.remove('show');
    selectedHex = null;
    pendingAttackData = null;
  }

  closeModalBtn.onclick = closeAttackModal;
  cancelAttackBtn.onclick = closeAttackModal;

  attackModal.addEventListener('click', (e) => {
    if (e.target === attackModal) closeAttackModal();
  });

  confirmAttackBtn.onclick = async function() {
    if (!selectedHex) return;

    const points = parseInt(attackPointsInput.value);
    if (!points || points < 1) {
      showToast('Введите количество очков', '#ef5350');
      return;
    }

    confirmAttackBtn.disabled = true;
    confirmAttackBtn.textContent = 'Атака...';

    try {
      const result = await API.hexAction(selectedHex.id, 'attack', points);

      if (result.success) {
        showToast('✅ Сектор #' + selectedHex.id + ' захвачен!', '#66bb6a');
        closeAttackModal();
        rebuild();
      } else if (result.type === 'failed') {
        showToast('❌ Атака не удалась. ' + result.reason, '#ef5350');
      } else {
        showToast('Ошибка: ' + (result.reason || 'Неизвестно'), '#ef5350');
      }
    } catch (e) {
      showToast('Ошибка связи', '#ef5350');
    } finally {
      confirmAttackBtn.disabled = false;
      confirmAttackBtn.textContent = 'Атаковать';
    }
  };

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
      return hexRadius / mPerPx;
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
        const p = this._map.latLngToContainerPoint([hex.lat, hex.lng]);
        const r = this._pixelRadius(hex);
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
        const px = x + r * Math.cos(a);
        const py = y + r * Math.sin(a);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = hex.color + (hovered ? '55' : '2e');
      ctx.fill();

      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;

      if (hex.isHome) {
        ctx.strokeStyle = '#d4a017';
        ctx.lineWidth = hovered ? 2 : 1.5;
        ctx.setLineDash([4, 3]);
      } else {
        ctx.strokeStyle = hex.color;
        ctx.lineWidth = hovered ? 1.6 : 1;
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = hovered ? 1 : 0.85;
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.globalAlpha = 1;
      if (r > 16) {
        ctx.fillStyle = '#1a1a1a';
        ctx.globalAlpha = hovered ? 0.95 : 0.75;
        ctx.font = '600 ' + Math.max(9, Math.min(13, r / 3.2)) + 'px -apple-system, "Inter", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.strokeText('#' + hex.id, x, y - 5);
        ctx.fillText('#' + hex.id, x, y - 5);

        ctx.font = '500 ' + Math.max(8, Math.min(11, r / 4)) + 'px -apple-system, "Inter", sans-serif';
        ctx.globalAlpha = hovered ? 0.85 : 0.55;
        ctx.strokeText(hex.ownerName, x, y + 7);
        ctx.fillText(hex.ownerName, x, y + 7);

        if (r > 22) {
          const pointsText = '+' + hex.dailyPoints;
          const fontSize = Math.max(8, Math.min(10, r / 5));
          ctx.font = '700 ' + fontSize + 'px -apple-system, "Inter", sans-serif';

          const textX = x;
          const textY = y + r * 0.55;

          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 3;
          ctx.lineJoin = 'round';
          ctx.strokeText(pointsText, textX, textY);

          ctx.fillStyle = hex.value > GLOW_VALUE_THRESHOLD ? '#f9a825' : '#1a1a1a';
          ctx.globalAlpha = 1;
          ctx.fillText(pointsText, textX, textY);
        }
      }

      if (hex.isHome && r > 18) {
        this._drawHomeIcon(ctx, x - r * 0.55, y - r * 0.55, Math.max(4, r * 0.18));
      }

      ctx.restore();
    },
    _drawHomeIcon: function (ctx, x, y, size) {
      ctx.save();
      ctx.strokeStyle = '#fff';
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1.2;
      ctx.lineJoin = 'round';

      ctx.beginPath();
      ctx.arc(x, y, size * 1.3, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(x, y - size);
      ctx.lineTo(x + size, y - size * 0.1);
      ctx.lineTo(x - size, y - size * 0.1);
      ctx.closePath();
      ctx.stroke();

      ctx.strokeRect(
        x - size * 0.7,
        y - size * 0.1,
        size * 1.4,
        size * 0.9
      );

      ctx.restore();
    },
    _hitTest: function (x, y) {
      let best = null;
      let bestDist = Infinity;
      for (const hex of this.items) {
        const p = this._map.latLngToContainerPoint([hex.lat, hex.lng]);
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
      handleHexClick(hex);
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

    countEl.textContent = hexes.length;
    sizeEl.textContent = hexRadius ? hexRadius.toFixed(1) : '—';
    if (hexes.length) {
      gridLayer = new HexGridLayer(hexes).addTo(map);
    }
  }

  function fitToOutline() {
    if (outline.length < 3) return;
    map.fitBounds(L.latLngBounds(outline).pad(0.6), { maxZoom: 20, animate: true });
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
        outline = points;
        generateAndDisplay();
        fitToOutline();
        showToast('Контур сохранён и гексы сгенерированы', '#66bb6a');
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
        outline = points;
        generateAndDisplay();
        fitToOutline();
      } else {
        setEditing(false);
      }
    } else {
      setEditing(true);
    }
  };

  loadMapFromBackend();
})();