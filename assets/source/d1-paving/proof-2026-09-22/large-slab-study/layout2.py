"""Final deterministic merge search balancing broad slabs across the 4 m field."""

import hashlib
import json
import random
from collections import Counter
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).parent
SOURCE = HERE.parent / "layout-study" / "layout2.json"
SIZE = 28
SEED = 922814
TRIALS = 80
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


def distribution(tiles):
    cover = [0, 0, 0, 0]
    for x, y, w, h in tiles:
        if w * h < 12:
            continue
        for qy in range(2):
            for qx in range(2):
                overlap_x = max(0, min(x + w, (qx + 1) * 14) - max(x, qx * 14))
                overlap_y = max(0, min(y + h, (qy + 1) * 14) - max(y, qy * 14))
                cover[qy * 2 + qx] += overlap_x * overlap_y
    narrow = [t for t in tiles if min(t[2], t[3]) == 2 and t[2] * t[3] <= 8]
    adjacent_narrow = 0
    for i, a in enumerate(narrow):
        for b in narrow[:i]:
            if ((a[0] + a[2] == b[0] or b[0] + b[2] == a[0])
                    and max(a[1], b[1]) < min(a[1] + a[3], b[1] + b[3])):
                adjacent_narrow += 1
            elif ((a[1] + a[3] == b[1] or b[1] + b[3] == a[1])
                    and max(a[0], b[0]) < min(a[0] + a[2], b[0] + b[2])):
                adjacent_narrow += 1
    return max(cover) - min(cover), adjacent_narrow, cover


def make_candidate(initial, rng):
    tiles = initial.copy()
    while len(tiles) > TARGET:
        choices = []
        for i, j, joined in options(tiles):
            replacement = [tile for k, tile in enumerate(tiles) if k not in (i, j)] + [joined]
            _, longest, penalty = audit(replacement)
            spread, adjacent_narrow, _ = distribution(replacement)
            # Preserve interrupted joints while spreading large plates and reducing
            # contiguous narrow runs; the source material is deliberately unchanged.
            aspect = max(joined[2], joined[3]) / min(joined[2], joined[3])
            choices.append(((longest * 7000 + penalty + spread * 180
                             + adjacent_narrow * 130, aspect), replacement))
        if not choices:
            break
        choices.sort(key=lambda item: item[0])
        selected = choices[rng.randrange(min(12, len(choices)))][1]
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
        spread, adjacent_narrow, _ = distribution(tiles)
        score = (abs(count - TARGET), longest * 7000 + penalty
                 + spread * 180 + adjacent_narrow * 130)
        if best is None or score < best[0]:
            best = score, trial, tiles
    score, trial, tiles = best
    owners, longest, penalty = audit(tiles)
    diagram(tiles, HERE / "diagram2.png")
    counts = Counter((w, h) for _, _, w, h in tiles)
    spread, adjacent_narrow, cover = distribution(tiles)
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
        "largeSlabQuadrantCoverageCells": cover,
        "largeSlabCoverageSpreadCells": spread,
        "adjacentNarrowPairs": adjacent_narrow,
        "baselineLongestInternalSeamCells": baseline[1],
        "baselineLongSeamPenalty": baseline[2],
        "shapeCounts": {f"{w}x{h}": n for (w, h), n in sorted(counts.items())},
        "tiles": [{"grid": list(tile)} for tile in sorted(tiles, key=lambda t: (t[1], t[0]))],
    }
    (HERE / "layout2.json").write_bytes((json.dumps(result, indent=2) + "\n").encode())
    print(json.dumps({k: result[k] for k in ("stoneCount", "longestInternalSeamCells",
                                                 "longSeamPenalty", "largeSlabQuadrantCoverageCells",
                                                 "adjacentNarrowPairs", "shapeCounts")}, indent=2))


if __name__ == "__main__":
    main()
