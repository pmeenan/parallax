"""Deterministic rectangle-merging preflight; no native art is generated here."""

import hashlib
import json
import random
from collections import Counter
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).parent
SOURCE = HERE.parent / "layout-study" / "layout2.json"
SIZE = 28
SEED = 922812
TRIALS = 12
TARGET = 58


def audit(tiles):
    owners = [[-1] * SIZE for _ in range(SIZE)]
    for index, (x, y, w, h) in enumerate(tiles):
        assert 0 <= x < x + w <= SIZE and 0 <= y < y + h <= SIZE
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                assert owners[yy][xx] == -1
                owners[yy][xx] = index
    assert all(value >= 0 for row in owners for value in row)
    runs = []
    for x in range(1, SIZE):
        runs.extend(run_lengths([owners[y][x - 1] != owners[y][x] for y in range(SIZE)]))
    for y in range(1, SIZE):
        runs.extend(run_lengths([owners[y - 1][x] != owners[y][x] for x in range(SIZE)]))
    return owners, max(runs), sum(max(0, run - 5) ** 3 for run in runs)


def run_lengths(line):
    result = []
    run = 0
    for flag in line + [False]:
        if flag:
            run += 1
        elif run:
            result.append(run)
            run = 0
    return result


def union(a, b):
    x = min(a[0], b[0])
    y = min(a[1], b[1])
    right = max(a[0] + a[2], b[0] + b[2])
    top = max(a[1] + a[3], b[1] + b[3])
    w, h = right - x, top - y
    if w * h != a[2] * a[3] + b[2] * b[3]:
        return None
    if w > 8 or h > 8 or max(w, h) / min(w, h) > 2.5:
        return None
    return x, y, w, h


def options(tiles):
    for i, a in enumerate(tiles):
        for j in range(i):
            joined = union(a, tiles[j])
            if joined is not None:
                yield i, j, joined


def make_candidate(initial, rng):
    tiles = initial.copy()
    while len(tiles) > TARGET:
        choices = []
        for i, j, joined in options(tiles):
            replacement = [tile for k, tile in enumerate(tiles) if k not in (i, j)] + [joined]
            _, longest, penalty = audit(replacement)
            # Favor short joints, then avoid large shape imbalance. Random selection
            # among close choices keeps the finite search from one greedy trap.
            aspect = max(joined[2], joined[3]) / min(joined[2], joined[3])
            choices.append(((longest, penalty, aspect), replacement))
        if not choices:
            break
        choices.sort(key=lambda item: item[0])
        selected = choices[rng.randrange(min(6, len(choices)))][1]
        tiles = selected
    return tiles


def diagram(tiles, path):
    scale = 32
    image = Image.new("RGB", (SIZE * scale, SIZE * scale), (85, 67, 50))
    draw = ImageDraw.Draw(image)
    palette = [(181, 169, 146), (158, 150, 135), (199, 184, 154), (147, 146, 139)]
    for index, (x, y, w, h) in enumerate(tiles):
        color = palette[(index * 7 + x * 3 + y) % len(palette)]
        draw.rectangle((x * scale + 3, y * scale + 3,
                        (x + w) * scale - 4, (y + h) * scale - 4), fill=color)
    image.save(path)


def main():
    raw = SOURCE.read_bytes()
    initial = [tuple(tile["grid"]) for tile in json.loads(raw)["tiles"]]
    baseline = audit(initial)
    assert len(initial) == 111 and baseline[1] == 16
    rng = random.Random(SEED)
    best = None
    for trial in range(TRIALS):
        tiles = make_candidate(initial, rng)
        owners, longest, penalty = audit(tiles)
        count = len(tiles)
        large = sum(w * h >= 12 for _, _, w, h in tiles)
        score = (abs(count - TARGET), longest, penalty, -large)
        if best is None or score < best[0]:
            best = score, trial, tiles
    score, trial, tiles = best
    owners, longest, penalty = audit(tiles)
    diagram(tiles, HERE / "diagram.png")
    counts = Counter((w, h) for _, _, w, h in tiles)
    result = {
        "seed": SEED,
        "candidateCount": TRIALS,
        "selectedTrial": trial,
        "input": {"path": str(SOURCE), "sha256": hashlib.sha256(raw).hexdigest()},
        "grid": [SIZE, SIZE],
        "fieldMetres": [4, 4],
        "stoneCount": len(tiles),
        "longestInternalSeamCells": longest,
        "longSeamPenalty": penalty,
        "baselineLongestInternalSeamCells": baseline[1],
        "baselineLongSeamPenalty": baseline[2],
        "shapeCounts": {f"{w}x{h}": n for (w, h), n in sorted(counts.items())},
        "tiles": [{"grid": list(tile)} for tile in sorted(tiles, key=lambda t: (t[1], t[0]))],
    }
    (HERE / "layout.json").write_bytes((json.dumps(result, indent=2) + "\n").encode())
    print(json.dumps({k: result[k] for k in ("stoneCount", "longestInternalSeamCells",
                                                 "longSeamPenalty", "shapeCounts")}, indent=2))


if __name__ == "__main__":
    main()
