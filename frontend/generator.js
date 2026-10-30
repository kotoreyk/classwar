const HexGenerator = {
  generate(params) {
    const { outline, center, hexesPerClass, classes } = params;
    const outlineLocal = outline.map(p => this.toLocal(p, center));
    const area = this.polygonArea(outlineLocal);
    if (area < 1) return { hexes: [], radius: 0 };

    const radius = this.computeRadius(area, hexesPerClass, classes.length);
    const hexes = this.buildField(outlineLocal, radius, center);
    const centroid = this.centroid(outlineLocal);

    this.classify(hexes, outlineLocal, centroid, radius);
    this.buildNeighbors(hexes);
    this.assignOwners(hexes, classes);

    return { hexes, radius };
  },

  toLocal(latlng, center) {
    const mPerLng = 111320 * Math.cos(center[0] * Math.PI / 180);
    return [
      (latlng[1] - center[1]) * mPerLng,
      (latlng[0] - center[0]) * 110540
    ];
  },

  toLatLng(x, y, center) {
    const mPerLng = 111320 * Math.cos(center[0] * Math.PI / 180);
    return [
      center[0] + y / 110540,
      center[1] + x / mPerLng
    ];
  },

  pointInPolygon(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1];
      const xj = poly[j][0], yj = poly[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi) {
        inside = !inside;
      }
    }
    return inside;
  },

  polygonArea(points) {
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      sum += a[0] * b[1] - b[0] * a[1];
    }
    return Math.abs(sum / 2);
  },

  polygonBounds(points) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      if (p[0] < minX) minX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] > maxY) maxY = p[1];
    }
    return { minX, minY, maxX, maxY };
  },

  centroid(points) {
    const b = this.polygonBounds(points);
    return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
  },

  computeRadius(area, hexesPerClass, classCount) {
    const HEX_AREA_COEFF = 3 * Math.sqrt(3) / 2;
    const total = hexesPerClass * classCount;
    const r = Math.sqrt((area / total) / HEX_AREA_COEFF);
    return Math.max(0.8, Math.min(20, r));
  },

  buildField(outlineLocal, size, center) {
    const sqrt3 = Math.sqrt(3);
    const bounds = this.polygonBounds(outlineLocal);
    const c = this.centroid(outlineLocal);
    const halfW = (bounds.maxX - bounds.minX) / 2 + size * 2;
    const halfH = (bounds.maxY - bounds.minY) / 2 + size * 2;
    const qRange = Math.ceil(halfW / (size * sqrt3)) + 1;
    const sRange = Math.ceil(halfH / (size * 1.5)) + 1;
    const result = [];
    let id = 1;

    for (let q = -qRange; q <= qRange; q++) {
      for (let s = -sRange; s <= sRange; s++) {
        const x = c[0] + size * sqrt3 * (q + s / 2);
        const y = c[1] + size * 1.5 * s;
        if (!this.pointInPolygon(x, y, outlineLocal)) continue;
        result.push({
          id: id++,
          q, s, size,
          localX: x, localY: y,
          latlng: this.toLatLng(x, y, center),
          owner: null, ownerName: null, color: null,
          isHome: false, isHomeCandidate: false,
          value: 0, dailyPoints: 0,
          neighbors: []
        });
      }
    }
    return result;
  },

  classify(hexes, outlineLocal, centroid, radius) {
    const HOME_EDGE_THRESHOLD = 1.5;
    const HOME_POINTS = 1;
    const BASE_DAILY_POINTS = 10;

    let maxDist = 0;
    for (const h of hexes) {
      const d = Math.hypot(h.localX - centroid[0], h.localY - centroid[1]);
      if (d > maxDist) maxDist = d;
    }

    for (const h of hexes) {
      let minDist = Infinity;
      for (let i = 0; i < outlineLocal.length; i++) {
        const a = outlineLocal[i], b = outlineLocal[(i + 1) % outlineLocal.length];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const len2 = dx * dx + dy * dy;
        let t = len2 === 0 ? 0 : ((h.localX - a[0]) * dx + (h.localY - a[1]) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(h.localX - (a[0] + t * dx), h.localY - (a[1] + t * dy));
        if (d < minDist) minDist = d;
      }

      h.isHomeCandidate = minDist < radius * HOME_EDGE_THRESHOLD;
      const nd = maxDist > 0 ? Math.hypot(h.localX - centroid[0], h.localY - centroid[1]) / maxDist : 0;
      let value = 1 - nd;
      if (h.isHomeCandidate) value = Math.min(value, 0.2);
      h.value = value;
      h.dailyPoints = h.isHomeCandidate ? HOME_POINTS : Math.max(1, Math.round(BASE_DAILY_POINTS * value));
    }
  },

  buildNeighbors(hexes) {
    const map = new Map();
    hexes.forEach(h => map.set(h.q + ',' + h.s, h));
    const dirs = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
    hexes.forEach(h => {
      h.neighbors = [];
      for (const [dq, ds] of dirs) {
        const n = map.get((h.q + dq) + ',' + (h.s + ds));
        if (n) h.neighbors.push(n.id);
      }
    });
  },

  assignOwners(hexes, classes) {
    const shuffled = [...hexes].sort(() => Math.random() - 0.5);
    const homeCandidates = shuffled.filter(h => h.isHomeCandidate);
    const nonHome = shuffled.filter(h => !h.isHomeCandidate);

    let hi = 0;
    classes.forEach(g => {
      if (hi < homeCandidates.length) {
        const h = homeCandidates[hi++];
        h.owner = g.id; h.ownerName = g.name; h.color = g.color; h.isHome = true;
      }
    });
    while (hi < homeCandidates.length) homeCandidates[hi++].isHome = false;

    const remaining = [...nonHome].sort(() => Math.random() - 0.5);
    let ni = 0;
    classes.forEach(g => {
      if (ni < remaining.length) {
        const h = remaining[ni++];
        h.owner = g.id; h.ownerName = g.name; h.color = g.color;
      }
    });

    const leftovers = [...homeCandidates.filter(h => !h.isHome), ...remaining.slice(ni)];
    leftovers.forEach(h => {
      h.owner = null; h.ownerName = 'Нейтрально'; h.color = '#b5b5b5';
    });
  }
};

if (typeof module !== 'undefined') module.exports = HexGenerator;