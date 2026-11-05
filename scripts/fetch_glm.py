"""Sample GOES-16 GLM Level-2 lightning flashes (GLM-L2-LCFA) for August 2023 and bin them by
location (0.5 deg) and LOCAL SOLAR hour (UTC + longitude/15).

Sampling: GLM writes one file every 20 s (180 per hour). For every day and every UTC hour we take
3 files (at :00, :20, :40), i.e. 60 s of observation per UTC hour per day. Because every UTC hour is
sampled equally, every local-solar-hour bin at every location receives the same observation time
(DAYS x 60 s), so counts convert directly to rates.

Kept: flashes with flash_quality_flag == 0 (good). Output: data/cache/glm_counts.npy (24, NLAT, NLON)
and data/cache/glm_meta.json. Progress is checkpointed so the script can resume.
"""
import os, re, json, threading, urllib.request, datetime as dt, concurrent.futures as cf
import numpy as np, xarray as xr

BUCKET = "https://noaa-goes16.s3.amazonaws.com"
START, DAYS, PER_HOUR = dt.date(2023, 8, 1), 31, 3
LAT_MIN, LAT_MAX, LON_MIN, LON_MAX, RES = -56.0, 56.0, -140.0, -10.0, 0.5
NLAT, NLON = int((LAT_MAX - LAT_MIN) / RES), int((LON_MAX - LON_MIN) / RES)
RAW, CACHE = "raw", "data/cache"
os.makedirs(RAW, exist_ok=True); os.makedirs(CACHE, exist_ok=True)
lock = threading.Lock()

def keys_for(day, hour):
    prefix = f"GLM-L2-LCFA/{day:%Y}/{day.timetuple().tm_yday:03d}/{hour:02d}/"
    xml = urllib.request.urlopen(f"{BUCKET}/?list-type=2&prefix={prefix}").read().decode()
    keys = sorted(re.findall(r"<Key>([^<]+\.nc)</Key>", xml))
    if not keys: return []
    step = len(keys) / PER_HOUR
    return [keys[int(i * step)] for i in range(PER_HOUR)]

def process(job):
    day, hour = job
    out = []
    for key in keys_for(day, hour):
        path = os.path.join(RAW, os.path.basename(key))
        for attempt in range(3):
            try: urllib.request.urlretrieve(f"{BUCKET}/{key}", path); break
            except Exception:
                if attempt == 2: raise
        with lock:
            with xr.open_dataset(path) as ds:
                lat = ds.flash_lat.values.astype("f8"); lon = ds.flash_lon.values.astype("f8")
                q = ds.flash_quality_flag.values
                t = ds.flash_time_offset_of_first_event.values
        os.remove(path)
        ok = (q == 0) & np.isfinite(lat) & np.isfinite(lon)
        lat, lon, t = lat[ok], lon[ok], t[ok]
        utc_h = (t - t.astype("datetime64[D]")).astype("timedelta64[ms]").astype("f8") / 3.6e6
        local_h = np.floor((utc_h + lon / 15.0) % 24).astype("i8")
        out.append((lat, lon, local_h))
    return job, out

counts_path, done_path = f"{CACHE}/glm_counts.npy", f"{CACHE}/glm_done.json"
counts = np.load(counts_path) if os.path.exists(counts_path) else np.zeros((24, NLAT, NLON), "i4")
done = set(map(tuple, json.load(open(done_path)))) if os.path.exists(done_path) else set()
jobs = [((START + dt.timedelta(d)).isoformat(), h) for d in range(DAYS) for h in range(24)]
todo = [j for j in jobs if j not in done]
files_per_utc_hour = np.zeros(24, "i4")
with cf.ThreadPoolExecutor(8) as ex:
    futs = [ex.submit(process, (dt.date.fromisoformat(d), h)) for d, h in todo]
    for n, f in enumerate(cf.as_completed(futs), 1):
        (day, hour), out = f.result()
        for lat, lon, lh in out:
            r = np.floor((LAT_MAX - lat) / RES).astype("i8"); c = np.floor((lon - LON_MIN) / RES).astype("i8")
            k = (r >= 0) & (r < NLAT) & (c >= 0) & (c < NLON)
            np.add.at(counts, (lh[k], r[k], c[k]), 1)
        if len(out) != PER_HOUR: print("short hour", day, hour, len(out), flush=True)
        done.add((day.isoformat(), hour))
        if n % 48 == 0 or n == len(todo):
            np.save(counts_path, counts); json.dump(sorted(done), open(done_path, "w"))
            print(f"{n}/{len(todo)} hours, {counts.sum():,} flashes", flush=True)
json.dump({"start": START.isoformat(), "days": DAYS, "per_hour": PER_HOUR, "seconds_per_file": 20,
           "latMax": LAT_MAX, "lonMin": LON_MIN, "res": RES, "nlat": NLAT, "nlon": NLON},
          open(f"{CACHE}/glm_meta.json", "w"))
print("done", counts.sum())
