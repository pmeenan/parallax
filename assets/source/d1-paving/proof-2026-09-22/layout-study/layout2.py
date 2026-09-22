"""Local flip search for a mixed-size 4 m paving layout with shorter joint runs."""

import json
import math
import random
from collections import Counter
from pathlib import Path

from layout import SIZE, audit, diagram

OUT = Path(__file__).parent
RNG = random.Random(922810)


def energy(tiles):
    owners, longest, penalty = audit(tiles)
    return longest * 7000 + penalty, longest, penalty, owners


def flip(tiles, x, y):
    horizontal = {(x, y, 4, 2), (x, y + 2, 4, 2)}
    vertical = {(x, y, 2, 4), (x + 2, y, 2, 4)}
    current = set(tiles)
    if horizontal <= current:
        return list((current - horizontal) | vertical)
    if vertical <= current:
        return list((current - vertical) | horizontal)
    return None


def find_best_base():
    current = [(x, y, 4, 2) for y in range(0, SIZE, 2) for x in range(0, SIZE, 4)]
    for _ in range(1200):
        changed = flip(current, RNG.randrange(0, SIZE - 3, 2), RNG.randrange(0, SIZE - 3, 2))
        if changed is not None:
            current = changed
    current_energy = energy(current)
    best = (current_energy, current)
    proposals = 0
    for step in range(12000):
        changed = flip(current, RNG.randrange(0, SIZE - 3, 2), RNG.randrange(0, SIZE - 3, 2))
        if changed is None:
            continue
        proposals += 1
        changed_energy = energy(changed)
        temp = 11000 * (1 - step / 12000) + 250
        if changed_energy[0] < current_energy[0] or RNG.random() < math.exp((current_energy[0] - changed_energy[0]) / temp):
            current, current_energy = changed, changed_energy
            if current_energy[0] < best[0][0]:
                best = (current_energy, current)
    return best[1], proposals, best[0][1:3]


def add_shapes(base):
    tiles = base.copy()
    # Place square cuts only where they do not increase the longest seam.
    for tile in RNG.sample(base, len(base)):
        if sum((w, h) == (2, 2) for _, _, w, h in tiles) >= 26:
            break
        x, y, w, h = tile
        parts = [(x + dx, y + dy, 2, 2) for dy in range(0, h, 2) for dx in range(0, w, 2)]
        candidate = [item for item in tiles if item != tile] + parts
        if energy(candidate)[1] <= energy(tiles)[1]:
            tiles = candidate
    # Exchange a 4+2 strip for two medium 3-cell stones.
    for _ in range(250):
        if sum(3 in (w, h) for _, _, w, h in tiles) >= 24:
            break
        tile = RNG.choice(tiles)
        x, y, w, h = tile
        if (w, h) == (4, 2):
            neighbor = RNG.choice([(x - 2, y, 2, 2), (x + 4, y, 2, 2)])
            if neighbor not in tiles:
                continue
            start = min(x, neighbor[0])
            parts = [(start, y, 3, 2), (start + 3, y, 3, 2)]
        elif (w, h) == (2, 4):
            neighbor = RNG.choice([(x, y - 2, 2, 2), (x, y + 4, 2, 2)])
            if neighbor not in tiles:
                continue
            start = min(y, neighbor[1])
            parts = [(x, start, 2, 3), (x, start + 3, 2, 3)]
        else:
            continue
        candidate = [item for item in tiles if item not in (tile, neighbor)] + parts
        if energy(candidate)[1] <= energy(tiles)[1]:
            tiles = candidate
    return tiles


def main():
    base, proposals, base_score = find_best_base()
    tiles = add_shapes(base)
    state = energy(tiles)
    diagram(tiles, state[3], OUT / "diagram2.png")
    counts = Counter((w, h) for _, _, w, h in tiles)
    result = {
        "seed": 922810,
        "flipProposalLimit": 12000,
        "evaluatedFlipProposals": proposals,
        "baseLongestAndPenalty": base_score,
        "grid": [SIZE, SIZE],
        "fieldMetres": [4, 4],
        "stoneCount": len(tiles),
        "longestInternalSeamCells": state[1],
        "longSeamPenalty": state[2],
        "shapeCounts": {f"{w}x{h}": count for (w, h), count in sorted(counts.items())},
        "tiles": [
            {"family": "B" if (w, h) == (2, 2) else "A" if 3 in (w, h) else "C", "grid": [x, y, w, h]}
            for x, y, w, h in sorted(tiles, key=lambda t: (t[1], t[0]))
        ],
    }
    (OUT / "layout2.json").write_bytes((json.dumps(result, indent=2) + "\n").encode("utf-8"))
    print(json.dumps({key: result[key] for key in ("evaluatedFlipProposals", "baseLongestAndPenalty", "stoneCount", "longestInternalSeamCells", "longSeamPenalty", "shapeCounts")}, indent=2))


if __name__ == "__main__":
    main()
