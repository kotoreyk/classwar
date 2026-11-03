import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "app"))

import hexgen  # noqa: E402
import rules  # noqa: E402


def test_hex_distance():
    assert rules.hex_distance(0, 0, 0, 0) == 0
    for dq, dr in [(1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1)]:
        assert rules.hex_distance(0, 0, dq, dr) == 1
    assert rules.hex_distance(0, 0, 2, -1) == 2
    assert rules.hex_distance(0, 0, 3, 0) == 3


def test_no_owned_hexes_is_not_free():
    # баг оригинала: расстояние -1 давало множитель 1
    assert rules.nearest_distance(5, 5, []) == 1
    assert rules.capture_cost(0.5, 1, False) > 0


def test_cost_grows_with_distance_and_enemy():
    near = rules.capture_cost(0.5, 1, False)
    far = rules.capture_cost(0.5, 4, False)
    enemy = rules.capture_cost(0.5, 1, True)
    assert far > near
    assert enemy > near
    assert rules.capture_cost(0.0, 1, False) == 30  # ceil(20 * 1.5)


def test_cost_is_deterministic():
    assert rules.capture_cost(0.37, 3, True) == rules.capture_cost(0.37, 3, True)


def test_generation_homes_unique_and_deterministic():
    ids = [1, 2, 3, 4]
    a = hexgen.generate((48.48, 135.08), 100, 6, ids)
    b = hexgen.generate((48.48, 135.08), 100, 6, ids)
    homes = [h for h in a["hexes"] if h["is_home"]]
    assert sorted(h["owner"] for h in homes) == ids
    assert [(h["q"], h["r"], h["owner"]) for h in a["hexes"]] == [(h["q"], h["r"], h["owner"]) for h in b["hexes"]]
    assert len({(h["q"], h["r"]) for h in a["hexes"]}) == len(a["hexes"])
    assert len(a["hexes"]) >= 6 * len(ids) * 0.6
    assert all(h["daily_points"] >= 1 for h in a["hexes"])
