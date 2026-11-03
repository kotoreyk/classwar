"""Чистые игровые правила (без БД и сети) — легко тестировать."""
import math

NEIGHBOR_PENALTY = 1.5
ENEMY_MULTIPLIER = 1.5
BASE_COST = 20
VALUE_COST = 40


def hex_distance(q1: int, r1: int, q2: int, r2: int) -> int:
    """Расстояние в гексах между осевыми координатами."""
    dq, dr = q1 - q2, r1 - r2
    return (abs(dq) + abs(dr) + abs(dq + dr)) // 2


def nearest_distance(q: int, r: int, owned: list[tuple[int, int]]) -> int:
    """Расстояние до ближайшего своего гекса. Если своих нет — считаем 1 (минимальный штраф, но не бесплатно)."""
    if not owned:
        return 1
    return max(1, min(hex_distance(q, r, oq, orr) for oq, orr in owned))


def capture_cost(value: float, distance: int, owned_by_enemy: bool) -> int:
    base = BASE_COST + VALUE_COST * max(0.0, min(1.0, value))
    cost = base * (NEIGHBOR_PENALTY ** max(1, distance))
    if owned_by_enemy:
        cost *= ENEMY_MULTIPLIER
    return math.ceil(cost)
