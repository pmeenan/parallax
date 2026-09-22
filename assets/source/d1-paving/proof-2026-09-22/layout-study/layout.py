"""Deterministic broken-joint candidate on a 28 × 28 paving planning grid."""

import json
import random
from collections import Counter
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).parent
BASE = 14
SIZE = BASE * 2
SEED = 922809


def domino_tiling(rng):
    partner = {}
    for y in range(BASE):
        for x in range(0, BASE, 2):
            partner[x, y] = (x + 1, y)
            partner[x + 1, y] = (x, y)
    for _ in range(1800):
        x, y = rng.randrange(BASE - 1), rng.randrange(BASE - 1)
        a, b, c, d = (x, y), (x + 1, y), (x, y + 1), (x + 1, y + 1)
        if partner[a] == b and partner[c] == d:
            partner[a], partner[c] = c, a
            partner[b], partner[d] = d, b
        elif partner[a] == c and partner[b] == d:
            partner[a], partner[b] = b, a
            partner[c], partner[d] = d, c
    tiles = []
    visited = set()
    for y in range(BASE):
        for x in range(BASE):
            cell = (x, y)
            if cell in visited:
                continue
            mate = partner[cell]
            visited.update((cell, mate))
            gx, gy = 2 * min(x, mate[0]), 2 * min(y, mate[1])
            w = 4 if x != mate[0] else 2
            h = 4 if y != mate[1] else 2
            if rng.random() < 0.31:
                for dy in range(0, h, 2):
                    for dx in range(0, w, 2):
                        tiles.append((gx + dx, gy + dy, 2, 2))
            else:
                tiles.append((gx, gy, w, h))
    # Replace adjacent 4+2 cell lengths with two 3-cell lengths. This restores
    # medium pavers and breaks the visual cadence of a pure domino tiling.
    for _ in range(90):
        if not tiles:
            break
        i = rng.randrange(len(tiles))
        x, y, w, h = tiles[i]
        if (w, h) == (4, 2):
            candidates = [(x - 2, y, 2, 2), (x + 4, y, 2, 2)]
            horizontal = True
        elif (w, h) == (2, 4):
            candidates = [(x, y - 2, 2, 2), (x, y + 4, 2, 2)]
            horizontal = False
        else:
            continue
        rng.shuffle(candidates)
        for neighbor in candidates:
            if neighbor not in tiles:
                continue
            tiles.remove((x, y, w, h))
            tiles.remove(neighbor)
            bx, by = min(x, neighbor[0]), min(y, neighbor[1])
            if horizontal:
                tiles.extend(((bx, by, 3, 2), (bx + 3, by, 3, 2)))
            else:
                tiles.extend(((bx, by, 2, 3), (bx, by + 3, 2, 3)))
            break
    return tiles


def audit(tiles):
    owners = [[-1] * SIZE for _ in range(SIZE)]
    for index, (x, y, w, h) in enumerate(tiles):
        assert (w, h) in {(2, 2), (3, 2), (2, 3), (4, 2), (2, 4)}
        assert x >= 0 and y >= 0 and x + w <= SIZE and y + h <= SIZE
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                assert owners[yy][xx] == -1
                owners[yy][xx] = index
    assert all(value >= 0 for row in owners for value in row)
    runs = []
    for x in range(1, SIZE):
        line = [owners[y][x - 1] != owners[y][x] for y in range(SIZE)]
        runs += run_lengths(line)
    for y in range(1, SIZE):
        line = [owners[y - 1][x] != owners[y][x] for x in range(SIZE)]
        runs += run_lengths(line)
    return owners, max(runs), sum(max(0, run - 5) ** 3 for run in runs)


def run_lengths(line):
    lengths = []
    run = 0
    for value in line + [False]:
        if value:
            run += 1
        elif run:
            lengths.append(run)
            run = 0
    return lengths


def diagram(tiles, owners, path):
    scale = 32
    image = Image.new("RGB", (SIZE * scale, SIZE * scale), (86, 68, 50))
    draw = ImageDraw.Draw(image)
    palette = {"A": (172, 164, 145), "B": (192, 184, 161), "C": (155, 150, 138)}
    for index, tile in enumerate(tiles):
        x, y, w, h = tile
        family = "B" if (w, h) == (2, 2) else "A" if 3 in (w, h) else "C"
        variation = ((index * 37) % 21) - 10
        color = tuple(max(0, min(255, channel + variation)) for channel in palette[family])
        draw.rectangle((x * scale + 3, y * scale + 3, (x + w) * scale - 4, (y + h) * scale - 4), fill=color)
        draw.text(((x + w / 2) * scale - 5, (y + h / 2) * scale - 6), family, fill=(35, 32, 28))
    image.save(path)


def main():
    rng = random.Random(SEED)
    best = None
    for trial in range(300):
        tiles = domino_tiling(rng)
        owners, longest, penalty = audit(tiles)
        sizes = Counter((w, h) for _, _, w, h in tiles)
        # Prefer no full-field seam, balanced shapes, and fewer long segments.
        score = (longest, penalty, abs(sizes[(2, 2)] - 18), len(tiles))
        if best is None or score < best[0]:
            best = (score, trial, tiles, owners)
    score, trial, tiles, owners = best
    diagram(tiles, owners, OUT / "diagram.png")
    result = {
        "seed": SEED,
        "trial": trial,
        "candidateCount": 300,
        "grid": [SIZE, SIZE],
        "fieldMetres": [4, 4],
        "stoneCount": len(tiles),
        "longestInternalSeamCells": score[0],
        "longSeamPenalty": score[1],
        "shapeCounts": {f"{w}x{h}": count for (w, h), count in Counter((w, h) for _, _, w, h in tiles).items()},
        "tiles": [
            {"family": "B" if (w, h) == (2, 2) else "A" if 3 in (w, h) else "C", "grid": [x, y, w, h]}
            for x, y, w, h in tiles
        ],
    }
    (OUT / "layout.json").write_bytes((json.dumps(result, indent=2) + "\n").encode("utf-8"))
    print(json.dumps({key: result[key] for key in ("trial", "stoneCount", "longestInternalSeamCells", "longSeamPenalty", "shapeCounts")}, indent=2))


if __name__ == "__main__":
    main()
