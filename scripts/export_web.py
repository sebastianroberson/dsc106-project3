"""Pack binned GLM counts for the browser -> data/lightning.json

cells: [[cell_index, c_0, ..., c_23], ...] for every 0.5-degree cell with at least one sampled flash,
       where c_h = good-quality flashes sampled in local solar hour h.
land:  base64 of one byte per cell (1 = land centre, from Natural Earth 1:50m land; lakes/bays = 0).
"""
import base64, json
import numpy as np
from matplotlib.path import Path

meta = json.load(open("data/cache/glm_meta.json"))
counts = np.load("data/cache/glm_counts.npy")            # (24, nlat, nlon)
done = json.load(open("data/cache/glm_done.json"))
nlat, nlon, res = meta["nlat"], meta["nlon"], meta["res"]

def land_mask():
    lat = meta["latMax"] - (np.arange(nlat) + 0.5) * res
    lon = meta["lonMin"] + (np.arange(nlon) + 0.5) * res
    LON, LAT = np.meshgrid(lon, lat)
    pts = np.column_stack([LON.ravel(), LAT.ravel()])
    inside = np.zeros(len(pts), bool)
    for f in json.load(open("data/cache/ne_50m_land.geojson"))["features"]:
        g = f["geometry"]
        for poly in (g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]):
            ring = np.array(poly[0])
            if ring[:, 0].max() < meta["lonMin"] or ring[:, 0].min() > meta["lonMin"] + nlon * res: continue
            m = Path(ring).contains_points(pts)
            for hole in poly[1:]:
                m &= ~Path(np.array(hole)).contains_points(pts)
            inside |= m
    for f in json.load(open("data/cache/ne_50m_lakes.geojson"))["features"]:
        g = f["geometry"]
        for poly in (g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]):
            inside &= ~Path(np.array(poly[0])).contains_points(pts)
    return inside

# Remove isolated "hot spot" artifacts: a cell with >= 200 sampled flashes whose 8 neighbours together
# hold < 10% of its count. Real storms never stay inside one 0.5-degree cell all month; a false-detection
# hot spot does (e.g. 7.25S 96.25W in Aug 2023: 14,457 flashes, flat across all 24 hours, 0 nearby).
total = counts.sum(0)
pad = np.pad(total, 1)
neigh = sum(pad[1 + dr:1 + dr + nlat, 1 + dc:1 + dc + nlon] for dr in (-1, 0, 1) for dc in (-1, 0, 1)) - total
artifact = (total >= 200) & (neigh < 0.1 * total)
for r, c in zip(*np.where(artifact)):
    print(f"removed artifact cell {meta['latMax'] - (r + .5) * res:.2f}, {meta['lonMin'] + (c + .5) * res:.2f}: {total[r, c]} flashes")
counts[:, artifact] = 0
np.save("data/cache/glm_counts_clean.npy", counts)

land = land_mask().reshape(nlat, nlon)

# crop the web map to where the lightning is (50N-45S, 130W-25W)
CROP_LAT, CROP_LON = (50.0, -45.0), (-130.0, -25.0)
r0, r1 = int((meta["latMax"] - CROP_LAT[0]) / res), int((meta["latMax"] - CROP_LAT[1]) / res)
c0, c1 = int((CROP_LON[0] - meta["lonMin"]) / res), int((CROP_LON[1] - meta["lonMin"]) / res)
kept = counts[:, r0:r1, c0:c1].sum()
print(f"crop keeps {kept / counts.sum():.1%} of flashes")
np.save("data/cache/land_mask.npy", land)
web_counts, web_land = counts[:, r0:r1, c0:c1], land[r0:r1, c0:c1]
meta = {**meta, "latMax": CROP_LAT[0], "lonMin": CROP_LON[0], "nlat": r1 - r0, "nlon": c1 - c0}
flat = web_counts.reshape(24, -1).T                       # (cells, 24)
nz = np.where(flat.sum(axis=1) > 0)[0]
out = {**meta,
       "sampledSecondsPerBin": meta["days"] * meta["per_hour"] * meta["seconds_per_file"],
       "filesUsed": len(done) * meta["per_hour"],
       "totalFlashes": int(counts.sum()), "mapFlashes": int(kept),
       "artifactCells": int(artifact.sum()), "artifactFlashes": int(total[artifact].sum()),
       "land": base64.b64encode(web_land.astype("u1").tobytes()).decode(),
       "cells": [[int(i), *map(int, flat[i])] for i in nz]}
json.dump(out, open("data/lightning.json", "w"), separators=(",", ":"))
print(len(nz), "cells;", round(len(open("data/lightning.json").read()) / 1e6, 2), "MB")
