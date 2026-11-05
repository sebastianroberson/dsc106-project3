# Lightning Around the Clock

DSC 106 Project 3: an interactive D3 map of GOES-16 Geostationary Lightning Mapper (GLM) flashes across
the Americas, with a 24-hour local-time slider and hour-by-hour profiles for any location.

## Layout
| Path | What |
|------|------|
| `index.html`, `style.css`, `main.js` | The site (served by GitHub Pages from the repo root) |
| `data/lightning.json` | Pre-binned flash counts: 0.5° cell × local solar hour, plus a land/water mask |
| `data/countries-50m.json` | Country outlines (world-atlas 2.0.2) |
| `scripts/fetch_glm.py` | Samples `GLM-L2-LCFA` files from `s3://noaa-goes16` (Aug 2023, 3 files per UTC hour) and bins the flashes |
| `scripts/export_web.py` | Builds the land mask (Natural Earth 1:50m) and writes `data/lightning.json` |
| `scripts/explore.py` | Exploratory static figures → `figures/exploratory/` |
| `CHECKPOINT.md` | Checkpoint video outline and narration script |

## Reproduce
```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
curl -sL -o data/cache/ne_50m_land.geojson  https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_land.geojson
curl -sL -o data/cache/ne_50m_lakes.geojson https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_lakes.geojson
.venv/bin/python scripts/fetch_glm.py      # ~20 min, ~1.7 GB streamed (raw files deleted as processed; resumable)
.venv/bin/python scripts/export_web.py
.venv/bin/python scripts/explore.py
python3 -m http.server                     # open http://localhost:8000
```

Data: NOAA GOES-R GLM L2 Lightning Detection (flashes), via the NOAA Open Data Dissemination program
(https://github.com/NOAA-Big-Data-Program/nodd-data-docs/tree/main/GOES).
