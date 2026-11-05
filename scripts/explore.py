"""Exploratory static graphs for the checkpoint (matplotlib) -> figures/exploratory/*.png"""
import json
import numpy as np, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import LogNorm

OUT = "figures/exploratory"
meta = json.load(open("data/cache/glm_meta.json"))
C = np.load("data/cache/glm_counts_clean.npy")  # artifact cells removed by export_web.py.astype("f8")      # (24, nlat, nlon) flashes per local hour
land = np.load("data/cache/land_mask.npy").astype(bool)
res, nlat, nlon = meta["res"], meta["nlat"], meta["nlon"]
lat = meta["latMax"] - (np.arange(nlat) + 0.5) * res
EXT = [meta["lonMin"], meta["lonMin"] + nlon * res, meta["latMax"] - nlat * res, meta["latMax"]]
hours_sampled = meta["days"] * meta["per_hour"] * meta["seconds_per_file"] / 3600
area = (111.32 * res) ** 2 * np.cos(np.deg2rad(lat))[:, None]          # km² per cell
RATE = C / hours_sampled / area * 1000                                   # flashes / hr / 1000 km²
TOTAL = C.sum(0)
plt.rcParams.update({"figure.dpi": 130, "font.size": 9, "axes.spines.top": False, "axes.spines.right": False})
BG = "#0b1222"
def hour_lbl(h): return f"{(h + 11) % 12 + 1} {'am' if h < 12 else 'pm'}"
def mapax(ax):
    ax.set_facecolor(BG); ax.set_xlim(EXT[:2]); ax.set_ylim(EXT[2:]); ax.set_aspect("equal")
    ax.contour(np.linspace(EXT[0], EXT[1], nlon), lat, land.astype(float), [0.5], colors="w", linewidths=.3, alpha=.5)

PLACES = {"Lake Maracaibo": (9.75, -71.6), "Central Florida": (28.25, -81.5), "Gulf Stream (off Carolinas)": (33.0, -76.0),
          "Great Plains (Kansas)": (38.5, -98.5), "Pacific off Colombia": (4.0, -79.0), "Sierra Madre (Mexico)": (24.0, -105.0)}
def profile(la, lo):
    r = int((meta["latMax"] - la) / res); c = int((lo - meta["lonMin"]) / res)
    s = C[:, r-1:r+2, c-1:c+2].sum(axis=(1, 2)); return s / s.sum(), s.sum()

# 1. where: mean flash rate
fig, ax = plt.subplots(figsize=(7, 6)); mapax(ax)
im = ax.imshow(np.where(TOTAL > 0, RATE.mean(0), np.nan), extent=EXT, cmap="inferno", norm=LogNorm(0.05, 50))
fig.colorbar(im, ax=ax, shrink=.7, label="Mean flashes / hr / 1,000 km²")
ax.set_title("1. Where: mean GLM flash rate, Aug 2023 (all hours)")
fig.savefig(f"{OUT}/1_where_map.png", bbox_inches="tight"); plt.close(fig)

# 2. when: hour of peak (only where enough flashes)
peak = np.argmax(np.stack([np.roll(C, k, 0) for k in (-1, 0, 1)]).sum(0), axis=0)  # 3-hr smoothed argmax
fig, ax = plt.subplots(figsize=(7, 6)); mapax(ax)
im = ax.imshow(np.where(TOTAL >= 40, peak, np.nan), extent=EXT, cmap="twilight_shifted", vmin=0, vmax=24, interpolation="nearest")
cb = fig.colorbar(im, ax=ax, shrink=.7, ticks=[0, 6, 12, 18, 24], label="Local solar hour of peak lightning")
cb.ax.set_yticklabels(["12 am", "6 am", "12 pm", "6 pm", "12 am"])
ax.set_title("2. When: busiest local hour (cells with ≥ 40 sampled flashes)")
fig.savefig(f"{OUT}/2_peak_hour_map.png", bbox_inches="tight"); plt.close(fig)

# 3. land vs water daily cycle
fig, ax = plt.subplots(figsize=(7, 3.2))
for m, lab, col in [(land, "land", "#eb6834"), (~land, "water", "#2a78d6")]:
    s = C[:, m].sum(1); ax.plot(np.arange(24) + .5, s / s.sum() * 100, "o-", ms=3, color=col, label=f"all {lab}")
ax.axhline(100 / 24, color="grey", lw=.6, ls=":"); ax.set_xticks(range(0, 25, 3), [hour_lbl(h % 24) for h in range(0, 25, 3)])
ax.set_ylabel("% of flashes"); ax.set_xlabel("Local solar hour"); ax.legend(frameon=False)
ax.set_title("3. Land lightning is an afternoon event; water lightning is spread out and peaks overnight")
fig.savefig(f"{OUT}/3_land_vs_water.png", bbox_inches="tight"); plt.close(fig)

# 4. hotspot profiles
fig, axs = plt.subplots(2, 3, figsize=(10, 5), sharex=True, sharey=True)
for ax, (n, (la, lo)) in zip(axs.flat, PLACES.items()):
    p, tot = profile(la, lo)
    ax.bar(np.arange(24) + .5, p * 100, width=.85, color="#2a78d6" if not land[int((meta['latMax']-la)/res), int((lo-meta['lonMin'])/res)] else "#eb6834")
    ax.axhline(100 / 24, color="grey", lw=.6, ls=":"); ax.set_title(f"{n}  (n={int(tot):,})", fontsize=9)
    ax.set_xticks([0, 6, 12, 18, 24], ["12a", "6a", "12p", "6p", "12a"])
for ax in axs[:, 0]: ax.set_ylabel("% of flashes")
fig.suptitle("4. Hour-by-hour profiles (orange = land, blue = water): Maracaibo and the Plains peak at night", y=1.0)
fig.tight_layout(); fig.savefig(f"{OUT}/4_hotspot_profiles.png", bbox_inches="tight"); plt.close(fig)

# 5. night share
night = C[list(range(0, 6)) + list(range(18, 24))].sum(0) / np.maximum(TOTAL, 1)
fig, ax = plt.subplots(figsize=(7, 6)); mapax(ax)
im = ax.imshow(np.where(TOTAL >= 40, night * 100, np.nan), extent=EXT, cmap="RdBu", vmin=0, vmax=100)
fig.colorbar(im, ax=ax, shrink=.7, label="% of flashes between 6 pm and 6 am")
ax.set_title("5. Night share: red = daytime lightning (land), blue = nighttime (water, Plains)")
fig.savefig(f"{OUT}/5_night_share_map.png", bbox_inches="tight"); plt.close(fig)

# 6. small multiples at four hours (the static version of the slider)
fig, axs = plt.subplots(1, 4, figsize=(13, 3.8))
for ax, h in zip(axs, [3, 9, 15, 21]):
    mapax(ax); im = ax.imshow(np.where(RATE[h] > 0, RATE[h], np.nan), extent=EXT, cmap="inferno", norm=LogNorm(0.05, 50))
    ax.set_title(hour_lbl(h) + " local"); ax.set_xticks([]); ax.set_yticks([])
fig.colorbar(im, ax=axs, shrink=.8, label="flashes / hr / 1,000 km²")
fig.suptitle("6. Four snapshots: the continents light up at 3 pm; at 3 am what remains is the Plains, coasts and Lake Maracaibo", y=1.02)
fig.savefig(f"{OUT}/6_four_hours.png", bbox_inches="tight"); plt.close(fig)

for n, (la, lo) in PLACES.items():
    p, tot = profile(la, lo); print(f"{n:24s} n={int(tot):6d} peak={hour_lbl(int(np.argmax(p)))} night%={p[list(range(6))+list(range(18,24))].sum()*100:.0f}")
r, c = np.unravel_index(np.argmax(TOTAL), TOTAL.shape)
print("max cell", lat[r], meta["lonMin"] + (c + .5) * res, "mean rate", RATE.mean(0)[r, c])
