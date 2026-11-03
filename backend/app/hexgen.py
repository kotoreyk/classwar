"""Детерминированная генерация гексовой сетки внутри круга вокруг учреждения.
Порт frontend/generator.js: те же формулы осей (q, s), значения и очки; но без Math.random —
расстановка домашних гексов равномерная по углу, карта воспроизводима."""
import math

HEX_AREA_COEFF = 3 * math.sqrt(3) / 2
HOME_EDGE_THRESHOLD = 1.5
HOME_POINTS = 1
BASE_DAILY_POINTS = 10


def compute_radius(area: float, hexes_per_class: int, class_count: int) -> float:
    total = max(1, hexes_per_class * class_count)
    r = math.sqrt((area / total) / HEX_AREA_COEFF)
    return max(0.8, min(20.0, r))


def to_latlng(x: float, y: float, center: tuple[float, float]) -> tuple[float, float]:
    m_per_lng = 111320 * math.cos(math.radians(center[0]))
    return center[0] + y / 110540, center[1] + x / m_per_lng


def generate(center: tuple[float, float], outline_radius_m: float, hexes_per_class: int, class_ids: list[int]) -> dict:
    """Возвращает {'radius': float, 'hexes': [dict,...]}. owner хранится как class_id или None."""
    area = math.pi * outline_radius_m ** 2
    size = compute_radius(area, hexes_per_class, len(class_ids))
    sqrt3 = math.sqrt(3)
    q_range = math.ceil(outline_radius_m / (size * sqrt3)) + 2
    s_range = math.ceil(outline_radius_m / (size * 1.5)) + 2

    hexes = []
    for q in range(-q_range, q_range + 1):
        for s in range(-s_range, s_range + 1):
            x = size * sqrt3 * (q + s / 2)
            y = size * 1.5 * s
            d = math.hypot(x, y)
            if d > outline_radius_m:
                continue
            lat, lng = to_latlng(x, y, center)
            hexes.append({"q": q, "r": s, "x": x, "y": y, "dist": d, "lat": lat, "lng": lng,
                          "owner": None, "is_home": False, "value": 0.0, "daily_points": 1})

    if len(hexes) < len(class_ids):
        raise ValueError("Слишком мало гексов для такого числа классов")

    max_dist = max(h["dist"] for h in hexes) or 1.0
    for h in hexes:
        edge_dist = outline_radius_m - h["dist"]
        h["home_candidate"] = edge_dist < size * HOME_EDGE_THRESHOLD
        value = 1 - h["dist"] / max_dist
        if h["home_candidate"]:
            value = min(value, 0.2)
        h["value"] = round(value, 3)
        h["daily_points"] = HOME_POINTS if h["home_candidate"] else max(1, round(BASE_DAILY_POINTS * value))

    _assign_homes(hexes, class_ids)
    return {"radius": size, "hexes": hexes}


def _assign_homes(hexes: list[dict], class_ids: list[int]) -> None:
    """Домашние гексы равномерно по окружности (честный старт)."""
    cands = [h for h in hexes if h["home_candidate"]] or sorted(hexes, key=lambda h: -h["dist"])
    cands = sorted(cands, key=lambda h: (math.atan2(h["y"], h["x"]), h["q"], h["r"]))
    n = len(class_ids)
    used = set()
    for i, cid in enumerate(class_ids):
        idx = int(i * len(cands) / n)
        while idx in used:
            idx = (idx + 1) % len(cands)
        used.add(idx)
        h = cands[idx]
        h["owner"] = cid
        h["is_home"] = True
