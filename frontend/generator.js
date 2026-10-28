const HexGenerator = {
  generate(buildingData) {
    const { address, groupCount } = buildingData;
    
    const hexes = this.buildHexGrid(buildingData.outline, buildingData.radius);
    this.buildNeighbors(hexes);
    this.assignOwners(hexes, groupCount);
    
    const edges = this.buildEdges(hexes);
    
    return {
      building_id: buildingData.id,
      address: address,
      hex_radius: buildingData.radius,
      hexes: hexes,
      edges: edges
    };
  },

  buildHexGrid(outline, radius) {
    const sqrt3 = Math.sqrt(3);
    const hexes = [];
    let id = 1;

    const bounds = this.getPolygonBounds(outline);
    const center = this.getPolygonCentroid(outline);

    const halfW = (bounds.maxX - bounds.minX) / 2 + radius * 2;
    const halfH = (bounds.maxY - bounds.minY) / 2 + radius * 2;
    const qRange = Math.ceil(halfW / (radius * sqrt3)) + 1;
    const sRange = Math.ceil(halfH / (radius * 1.5)) + 1;

    for (let q = -qRange; q <= qRange; q++) {
      for (let s = -sRange; s <= sRange; s++) {
        const x = center.x + radius * sqrt3 * (q + s / 2);
        const y = center.y + radius * 1.5 * s;

        if (this.pointInPolygon(x, y, outline)) {
          hexes.push({
            id: id++,
            q: q,
            s: s,
            x: x,
            y: y,
            lat: center.lat + (y / 110540),
            lng: center.lng + (x / (111320 * Math.cos(center.lat * Math.PI / 180))),
            owner: null,
            ownerName: 'Нейтрально',
            color: '#b5b5b5',
            isHome: false,
            value: 0,
            dailyPoints: 0,
            neighbors: []
          });
        }
      }
    }

    return hexes;
  },

  buildNeighbors(hexes) {
    const hexMap = new Map();
    hexes.forEach(h => hexMap.set(`${h.q},${h.s}`, h));

    const directions = [
      [1, 0], [1, -1], [0, -1],
      [-1, 0], [-1, 1], [0, 1]
    ];

    hexes.forEach(hex => {
      for (const [dq, ds] of directions) {
        const neighbor = hexMap.get(`${hex.q + dq},${hex.s + ds}`);
        if (neighbor) {
          hex.neighbors.push(neighbor.id);
        }
      }
    });
  },

  assignOwners(hexes, groupCount) {
    const groups = [];
    for (let i = 0; i < groupCount; i++) {
      groups.push({
        id: `group_${i + 1}`,
        name: `Группа ${i + 1}`,
        color: this.getRandomColor()
      });
    }

    const shuffled = this.shuffleArray([...hexes]);
    const homeCandidates = shuffled.filter(h => this.isEdgeHex(h, hexes));
    const nonHomeHexes = shuffled.filter(h => !this.isEdgeHex(h, hexes));

    let homeIdx = 0;
    groups.forEach(group => {
      if (homeIdx < homeCandidates.length) {
        homeCandidates[homeIdx].owner = group.id;
        homeCandidates[homeIdx].ownerName = group.name;
        homeCandidates[homeIdx].color = group.color;
        homeCandidates[homeIdx].isHome = true;
        homeIdx++;
      }
    });

    const remainingNonHome = this.shuffleArray([...nonHomeHexes]);
    let nonHomeIdx = 0;

    groups.forEach(group => {
      if (nonHomeIdx < remainingNonHome.length) {
        remainingNonHome[nonHomeIdx].owner = group.id;
        remainingNonHome[nonHomeIdx].ownerName = group.name;
        remainingNonHome[nonHomeIdx].color = group.color;
        nonHomeIdx++;
      }
    });

    this.calculateValues(hexes);
  },

  calculateValues(hexes) {
    const center = this.getPolygonCentroid(hexes.map(h => ({ x: h.x, y: h.y })));
    let maxDist = 0;

    hexes.forEach(hex => {
      const d = Math.hypot(hex.x - center.x, hex.y - center.y);
      if (d > maxDist) maxDist = d;
    });

    hexes.forEach(hex => {
      const distToCenter = Math.hypot(hex.x - center.x, hex.y - center.y);
      const normalizedDist = maxDist > 0 ? distToCenter / maxDist : 0;
      hex.value = 1 - normalizedDist;
      hex.dailyPoints = hex.isHome ? 1 : Math.max(1, Math.round(10 * hex.value));
    });
  },

  buildEdges(hexes) {
    const edges = [];
    hexes.forEach(hex => {
      hex.neighbors.forEach(neighborId => {
        edges.push({ from: hex.id, to: neighborId });
      });
    });
    return edges;
  },

  isEdgeHex(hex, allHexes) {
    const hexMap = new Map();
    allHexes.forEach(h => hexMap.set(`${h.q},${h.s}`, h));

    const directions = [
      [1, 0], [1, -1], [0, -1],
      [-1, 0], [-1, 1], [0, 1]
    ];

    for (const [dq, ds] of directions) {
      const neighbor = hexMap.get(`${hex.q + dq},${hex.s + ds}`);
      if (!neighbor) return true;
    }

    return false;
  },

  getPolygonBounds(outline) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    outline.forEach(p => {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    });
    return { minX, minY, maxX, maxY };
  },

  getPolygonCentroid(outline) {
    const bounds = this.getPolygonBounds(outline);
    return {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
      lat: outline[0].lat,
      lng: outline[0].lng
    };
  },

  pointInPolygon(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y;
      const xj = poly[j].x, yj = poly[j].y;
      const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  },

  shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  },

  getRandomColor() {
    const colors = ['#ef5350', '#42a5f5', '#66bb6a', '#ffa726', '#ab47bc', '#26c6da', '#ec407a', '#8d6e63'];
    return colors[Math.floor(Math.random() * colors.length)];
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = HexGenerator;
}