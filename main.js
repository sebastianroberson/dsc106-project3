// Lightning Around the Clock: GOES-16 GLM flashes by local solar hour (D3 v7).
// Data: data/lightning.json (pre-binned by scripts/fetch_glm.py + scripts/export_web.py).

const SERIES_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"]; // categorical slots 1-4, fixed order
const MAX_PINS = 4;
const RATE_FLOOR = 0.2;           // flashes / hr / 1,000 km² below this are not drawn (≈ 2 sampled flashes in a 1.5° box)
const KM_PER_DEG = 111.32;

const state = {
  hour: 15,
  pins: [
    { name: "Lake Maracaibo", lat: 9.75, lon: -71.6, color: SERIES_COLORS[0] },
    { name: "Central Florida", lat: 28.25, lon: -81.5, color: SERIES_COLORS[1] },
    { name: "Great Plains (Kansas)", lat: 38.5, lon: -98.5, color: SERIES_COLORS[2] },
  ],
  playing: null,
};

let D, nLat, nLon, nCell, counts, landFlag, rateScale, sampledHours, rowArea, refProfiles, smooth;

// ---------- data helpers ----------
const latOfRow = (r) => D.latMax - (r + 0.5) * D.res;
const lonOfCol = (c) => D.lonMin + (c + 0.5) * D.res;
const cellOf = (lat, lon) => {
  const r = Math.floor((D.latMax - lat) / D.res), c = Math.floor((lon - D.lonMin) / D.res);
  return r < 0 || r >= nLat || c < 0 || c >= nLon ? -1 : r * nLon + c;
};
// flashes per hour per 1,000 km², smoothed over the 3x3 cells (1.5° box) around each cell; precomputed in init()
const rate = (cell, h) => smooth[cell * 24 + h];

function neighbourhood(lat, lon) {
  const r0 = Math.floor((D.latMax - lat) / D.res), c0 = Math.floor((lon - D.lonMin) / D.res);
  const cells = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    const r = r0 + dr, c = c0 + dc;
    if (r >= 0 && r < nLat && c >= 0 && c < nLon) cells.push(r * nLon + c);
  }
  return cells;
}
// hourly profile summed over the 3x3 neighbourhood (1.5° box) around a point
function profileAt(lat, lon) {
  const cells = neighbourhood(lat, lon);
  const sums = new Array(24).fill(0);
  let area = 0;
  for (const cell of cells) {
    area += rowArea[Math.floor(cell / nLon)];
    for (let h = 0; h < 24; h++) sums[h] += counts[cell * 24 + h];
  }
  const total = d3.sum(sums);
  return d3.range(24).map((h) => ({
    h, n: sums[h], share: total ? sums[h] / total : NaN,
    rate: sums[h] / sampledHours / area * 1000,
  })).map((d) => Object.assign(d, { total }));
}

// ---------- formatting ----------
const fmtHour = (h) => `${((h + 11) % 12) + 1} ${h < 12 ? "am" : "pm"}`;
const fmtHourRange = (h) => `${fmtHour(h)}–${fmtHour((h + 1) % 24)}`;
const partOfDay = (h) => (h < 5 ? "night" : h < 8 ? "dawn" : h < 12 ? "morning" : h < 17 ? "afternoon" : h < 20 ? "evening" : "night");
const fmtLatLon = (lat, lon) => `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(1)}°${lon < 0 ? "W" : "E"}`;
const fmtRate = (v) => (v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toFixed(2));
const fmtPct = (v) => `${(v * 100).toFixed(1)}%`;

// ---------- map ----------
const mapWrap = document.getElementById("map-wrap");
const mapCanvas = document.getElementById("map-canvas");
const mapSvg = d3.select("#map-svg");
const mapTip = document.getElementById("map-tip");
let mapW, mapH, xLon, yLat, geoPath, land, borders, rasterCanvas, rasterCtx, rasterImg, landLayer;

function layoutMap() {
  mapW = mapWrap.clientWidth;
  const lonSpan = nLon * D.res, latSpan = nLat * D.res;
  mapH = Math.round(mapW * latSpan / lonSpan);
  mapWrap.style.height = `${mapH}px`;
  xLon = d3.scaleLinear([D.lonMin, D.lonMin + lonSpan], [0, mapW]);
  yLat = d3.scaleLinear([D.latMax, D.latMax - latSpan], [0, mapH]);
  // equirectangular projection with the same linear lon/lat mapping as the raster; unlike a plain
  // transform it cuts shapes at the antimeridian (Fiji, Russia) and clips to the map
  const k = mapW / (lonSpan * Math.PI / 180);
  const proj = d3.geoEquirectangular().scale(k)
    .translate([-k * D.lonMin * Math.PI / 180, k * D.latMax * Math.PI / 180]).clipExtent([[0, 0], [mapW, mapH]]);
  geoPath = d3.geoPath(proj);

  const dpr = window.devicePixelRatio || 1;
  mapCanvas.width = Math.round(mapW * dpr); mapCanvas.height = Math.round(mapH * dpr);
  mapSvg.attr("viewBox", `0 0 ${mapW} ${mapH}`);

  // pre-render land fill once per size
  landLayer = document.createElement("canvas");
  landLayer.width = mapCanvas.width; landLayer.height = mapCanvas.height;
  const lctx = landLayer.getContext("2d");
  lctx.scale(dpr, dpr);
  lctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--map-land").trim();
  lctx.beginPath(); d3.geoPath(proj, lctx)(land); lctx.fill();

  mapSvg.select(".graticule").attr("d", geoPath(d3.geoGraticule().step([20, 20])()));
  mapSvg.select(".equator-label").attr("x", 6).attr("y", yLat(0) - 4);
  mapSvg.select(".country").attr("d", geoPath(borders));
  mapSvg.select(".coast").attr("d", geoPath(land));
  drawMap(); drawPins();
}

function drawMap() {
  const data = rasterImg.data;
  for (let cell = 0; cell < nCell; cell++) {
    const o = cell * 4, v = rate(cell, state.hour);
    if (!(v >= RATE_FLOOR)) { data[o + 3] = 0; continue; }
    const c = d3.rgb(rateScale(v));
    data[o] = c.r; data[o + 1] = c.g; data[o + 2] = c.b; data[o + 3] = 255;
  }
  rasterCtx.putImageData(rasterImg, 0, 0);
  const ctx = mapCanvas.getContext("2d");
  ctx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
  ctx.drawImage(landLayer, 0, 0);
  ctx.imageSmoothingEnabled = false; // show the real 0.5° cells
  ctx.drawImage(rasterCanvas, 0, 0, mapCanvas.width, mapCanvas.height);
}

function drawPins() {
  const g = mapSvg.select(".pins-layer").selectAll("g.pin").data(state.pins, (d) => d.name)
    .join((enter) => { const e = enter.append("g").attr("class", "pin"); e.append("circle").attr("r", 6); e.append("text").attr("dy", "0.35em"); return e; });
  g.attr("transform", (d) => `translate(${xLon(d.lon)},${yLat(d.lat)})`);
  g.select("circle").attr("fill", (d) => d.color);
  const right = (d) => xLon(d.lon) > mapW - 130;
  g.select("text").text((d) => d.name).attr("x", (d) => (right(d) ? -10 : 10)).attr("text-anchor", (d) => (right(d) ? "end" : "start"));
}

function showMapTip(event) {
  const [mx, my] = d3.pointer(event, mapWrap);
  const lat = yLat.invert(my), lon = xLon.invert(mx);
  const cell = cellOf(lat, lon);
  if (cell < 0) { mapTip.hidden = true; return; }
  const prof = profileAt(lat, lon);
  const peak = d3.greatest(prof, (d) => d.n);
  mapTip.innerHTML = `<div class="t-head">${fmtLatLon(lat, lon)} · ${landFlag[cell] ? "land" : "water"}</div>` +
    `<div class="t-row">At ${fmtHourRange(state.hour)} <b>${fmtRate(rate(cell, state.hour))}</b></div>` +
    `<div class="t-head" style="margin:0">flashes / hr / 1,000 km² (1.5° box)</div>` +
    (prof[0].total >= 30
      ? `<div class="t-row" style="margin-top:4px">Busiest hour nearby <b>${fmtHourRange(peak.h)}</b></div>`
      : `<div class="t-head" style="margin-top:4px">Too little lightning nearby for a profile</div>`) +
    `<div class="t-head" style="margin:4px 0 0">Click to pin</div>`;
  mapTip.hidden = false;
  placeTip(mapTip, mx, my, mapWrap);
}

function placeTip(tip, x, y, wrap) {
  const w = tip.offsetWidth, h = tip.offsetHeight, W = wrap.clientWidth;
  tip.style.left = `${x + 14 + w > W ? Math.max(0, x - w - 14) : x + 14}px`;
  tip.style.top = `${y - h - 10 < 0 ? y + 16 : y - h - 10}px`;
}

function addPin(event) {
  const [mx, my] = d3.pointer(event, mapWrap);
  const lat = yLat.invert(my), lon = xLon.invert(mx);
  const cell = cellOf(lat, lon);
  if (cell < 0 || state.pins.some((p) => cellOf(p.lat, p.lon) === cell)) return; // pins are keyed by name: one per cell
  // colour follows the place, never its position: drop the oldest pin if full, take a free slot
  const kept = state.pins.slice(-(MAX_PINS - 1));
  const used = new Set(kept.map((p) => p.color));
  state.pins = [...kept, { name: fmtLatLon(lat, lon), lat, lon, color: SERIES_COLORS.find((c) => !used.has(c)) }];
  drawPins(); renderPins(); drawProfile();
}

// ---------- legend ----------
function drawLegend() {
  const W = 280, H = 10;
  const legend = d3.select("#legend").html("");
  const box = legend.append("div");
  box.append("div").text("Lightning flashes per hour per 1,000 km² (log scale)").style("margin-bottom", "4px");
  const svg = box.append("svg").attr("width", W).attr("height", H + 18);
  const grad = svg.append("defs").append("linearGradient").attr("id", "rate-grad");
  const [lo, hi] = rateScale.domain();
  d3.range(0, 1.0001, 0.05).forEach((p) => grad.append("stop").attr("offset", p)
    .attr("stop-color", rateScale(lo * Math.pow(hi / lo, p))));
  svg.append("rect").attr("width", W).attr("height", H).attr("rx", 2).attr("fill", "url(#rate-grad)");
  const x = d3.scaleLog([lo, hi], [0, W]);
  svg.append("g").attr("transform", `translate(0,${H})`)
    .call(d3.axisBottom(x).tickValues([0.1, 1, 10, 100].filter((v) => v >= lo && v <= hi)).tickSize(4).tickFormat(fmtRate))
    .call((g) => g.select(".domain").remove());
}

// ---------- profile chart ----------
const tsWrap = document.getElementById("ts-wrap");
const tsSvg = d3.select("#ts-svg");
const tsTip = document.getElementById("ts-tip");
const M = { top: 16, right: 52, bottom: 30, left: 44 };
let tsW, tsH = 260, xH, yS, series = [];

function layoutProfile() {
  tsW = tsWrap.clientWidth;
  tsSvg.attr("viewBox", `0 0 ${tsW} ${tsH}`).attr("height", tsH);
  xH = d3.scaleLinear([0, 24], [M.left, tsW - M.right]);
  drawProfile();
}

function drawProfile() {
  series = state.pins.map((p) => ({ pin: p, color: p.color, values: profileAt(p.lat, p.lon) }));
  const maxShare = d3.max([...series.flatMap((s) => s.values), ...refProfiles.flatMap((r) => r.values)], (d) => d.share) || 0.1;
  yS = d3.scaleLinear([0, Math.max(0.12, maxShare * 1.08)], [tsH - M.bottom, M.top]).nice();

  tsSvg.select(".night-am").attr("x", xH(0)).attr("width", xH(6) - xH(0)).attr("y", M.top).attr("height", tsH - M.top - M.bottom);
  tsSvg.select(".night-pm").attr("x", xH(18)).attr("width", xH(24) - xH(18)).attr("y", M.top).attr("height", tsH - M.top - M.bottom);
  tsSvg.select(".night-label").attr("x", xH(0) + 4).attr("y", M.top + 12).text("night");
  const narrow = tsW < 560;
  tsSvg.select(".x-axis").attr("transform", `translate(0,${tsH - M.bottom})`)
    .call(d3.axisBottom(xH).tickValues(narrow ? [0, 6, 12, 18, 24] : d3.range(0, 25, 3)).tickFormat((h) => fmtHour(h % 24)).tickSizeOuter(0));
  tsSvg.select(".y-grid").attr("transform", `translate(${M.left},0)`)
    .call(d3.axisLeft(yS).ticks(5).tickSize(-(tsW - M.left - M.right)).tickFormat(""));
  tsSvg.select(".y-axis").attr("transform", `translate(${M.left},0)`)
    .call(d3.axisLeft(yS).ticks(5).tickFormat((d) => `${Math.round(d * 100)}%`))
    .call((g) => g.select(".domain").remove()).call((g) => g.selectAll(".tick line").remove());
  tsSvg.select(".even-line").attr("x1", M.left).attr("x2", tsW - M.right).attr("y1", yS(1 / 24)).attr("y2", yS(1 / 24));
  tsSvg.select(".even-label").attr("x", tsW - M.right + 4).attr("y", yS(1 / 24)).attr("dy", "0.35em").text("even");

  // one point per local hour, plotted at the middle of the hour
  const line = d3.line().defined((d) => !Number.isNaN(d.share)).curve(d3.curveMonotoneX)
    .x((d) => xH(d.h + 0.5)).y((d) => yS(d.share));
  tsSvg.select(".refs").selectAll("path").data(refProfiles).join("path").attr("class", "ref-line")
    .attr("stroke-dasharray", (d) => (d.key === "land" ? "5 3" : "1.5 3")).attr("d", (d) => line(d.values));
  // direct labels at the right edge, nudged apart (and away from "even") so they never overlap
  const labels = [{ text: "even", y: yS(1 / 24) }, ...refProfiles.map((r) => ({ text: r.label, y: yS(r.values[23].share) }))]
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 12);
  tsSvg.select(".even-label").attr("display", "none");
  tsSvg.select(".refs").selectAll("text").data(labels).join("text").attr("class", "even-label")
    .attr("x", tsW - M.right + 4).attr("y", (d) => d.y).attr("dy", "0.35em").text((d) => d.text);
  tsSvg.select(".lines").selectAll("path").data(series, (d) => d.pin.name)
    .join("path").attr("class", "series").attr("stroke", (d) => d.color).attr("d", (d) => line(d.values));
  drawHourBand();
}

function drawHourBand() {
  tsSvg.select(".hour-band").attr("x", xH(state.hour)).attr("width", xH(state.hour + 1) - xH(state.hour))
    .attr("y", M.top).attr("height", tsH - M.top - M.bottom).attr("rx", 3);
  tsSvg.select(".dots").selectAll("circle").data(series.filter((s) => !Number.isNaN(s.values[state.hour].share)), (d) => d.pin.name)
    .join("circle").attr("r", 4).attr("fill", (d) => d.color).attr("stroke", "var(--surface)").attr("stroke-width", 2)
    .attr("cx", xH(state.hour + 0.5)).attr("cy", (d) => yS(d.values[state.hour].share));
}

function hourFromX(x) { return Math.max(0, Math.min(23, Math.floor(xH.invert(x)))); }

function showProfileTip(event) {
  const [x, y] = d3.pointer(event, tsWrap);
  const h = hourFromX(x);
  tsSvg.select(".hover-rule").attr("x1", xH(h + 0.5)).attr("x2", xH(h + 0.5)).attr("y1", M.top).attr("y2", tsH - M.bottom).attr("opacity", 1);
  tsTip.innerHTML = `<div class="t-head">${fmtHourRange(h)} local solar time</div>` +
    series.map((s) => {
      const d = s.values[h];
      return `<div class="t-row"><i style="background:${s.color}"></i>${s.pin.name}<b>${d.total < 30 ? "too few" : fmtPct(d.share)}</b></div>`;
    }).join("") +
    refProfiles.map((r) => `<div class="t-row"><i style="background:var(--muted)"></i>${r.label}<b>${fmtPct(r.values[h].share)}</b></div>`).join("");
  tsTip.hidden = false;
  placeTip(tsTip, xH(h + 0.5), y, tsWrap);
}

function renderPins() {
  const chips = d3.select("#pins").selectAll(".chip").data(state.pins, (d) => d.name)
    .join((enter) => {
      const c = enter.append("span").attr("class", "chip");
      c.append("i"); c.append("span").attr("class", "chip-name");
      c.append("button").attr("aria-label", (d) => `Remove ${d.name}`).text("×")
        .on("click", (e, d) => { state.pins = state.pins.filter((p) => p !== d); drawPins(); renderPins(); drawProfile(); });
      return c;
    });
  chips.order();
  chips.select("i").style("background", (d) => d.color);
  chips.select(".chip-name").text((d) => d.name);
}

// ---------- time ----------
function setHour(h) {
  state.hour = ((h % 24) + 24) % 24;
  document.getElementById("hour").value = state.hour;
  document.getElementById("clock").innerHTML =
    `<div class="big">${fmtHour(state.hour)}</div><div class="sub">${fmtHourRange(state.hour)} · ${partOfDay(state.hour)}, local solar time</div>`;
  document.getElementById("everywhere").textContent = `${fmtHour(state.hour)} everywhere`;
  drawMap(); drawHourBand();
  if (!mapTip.hidden && lastMapEvent) showMapTip(lastMapEvent);
}
let lastMapEvent = null;

function togglePlay(force) {
  const btn = document.getElementById("play");
  if (force === false || (force === undefined && state.playing)) {
    if (state.playing) state.playing.stop();
    state.playing = null; btn.textContent = "▶ Play"; btn.setAttribute("aria-label", "Play through the day");
    return;
  }
  let last = -Infinity;
  state.playing = d3.timer((elapsed) => {
    if (elapsed - last < 450) return;
    last = elapsed;
    setHour(state.hour + 1);
  });
  btn.textContent = "❚❚ Pause"; btn.setAttribute("aria-label", "Pause");
}

// ---------- boot ----------
async function init() {
  const [data, world] = await Promise.all([d3.json("data/lightning.json"), d3.json("data/countries-50m.json")]);
  D = data; nLat = D.nlat; nLon = D.nlon; nCell = nLat * nLon;
  counts = new Uint32Array(nCell * 24);
  landFlag = Uint8Array.from(atob(D.land), (ch) => ch.charCodeAt(0));
  for (const [cell, ...hrs] of D.cells) for (let h = 0; h < 24; h++) counts[cell * 24 + h] = hrs[h];
  sampledHours = D.sampledSecondsPerBin / 3600;
  rowArea = Float64Array.from({ length: nLat }, (_, r) => (KM_PER_DEG * D.res) ** 2 * Math.cos(latOfRow(r) * Math.PI / 180));

  // smoothed rates: sum of flashes in the 3x3 box / box area (the same box the pinned profiles use)
  smooth = new Float32Array(nCell * 24);
  for (let r = 0; r < nLat; r++) for (let c = 0; c < nLon; c++) {
    let area = 0; const sums = new Float64Array(24);
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || rr >= nLat || cc < 0 || cc >= nLon) continue;
      area += rowArea[rr];
      const base = (rr * nLon + cc) * 24;
      for (let h = 0; h < 24; h++) sums[h] += counts[base + h];
    }
    const o = (r * nLon + c) * 24;
    for (let h = 0; h < 24; h++) smooth[o + h] = sums[h] / sampledHours / area * 1000;
  }

  // log colour scale: floor -> 99.9th percentile of all drawn hourly rates
  const rates = [];
  for (let cell = 0; cell < nCell; cell++) for (let h = 0; h < 24; h++) { const v = rate(cell, h); if (v >= RATE_FLOOR) rates.push(v); }
  rates.sort(d3.ascending);
  const hi = Math.pow(10, Math.ceil(Math.log10(d3.quantileSorted(rates, 0.999))));
  rateScale = d3.scaleSequentialLog([RATE_FLOOR, hi], (t) => d3.interpolateInferno(0.22 + 0.78 * t)).clamp(true);

  // reference profiles: all land vs all water across the map
  refProfiles = [["land", "all land", 1], ["water", "all water", 0]].map(([key, label, flag]) => {
    const sums = new Array(24).fill(0);
    for (let cell = 0; cell < nCell; cell++) if (landFlag[cell] === flag) for (let h = 0; h < 24; h++) sums[h] += counts[cell * 24 + h];
    const total = d3.sum(sums);
    return { key, label, values: sums.map((n, h) => ({ h, n, share: n / total, total })) };
  });

  land = topojson.feature(world, world.objects.land);
  borders = topojson.mesh(world, world.objects.countries, (a, b) => a !== b);
  rasterCanvas = document.createElement("canvas"); rasterCanvas.width = nLon; rasterCanvas.height = nLat;
  rasterCtx = rasterCanvas.getContext("2d"); rasterImg = rasterCtx.createImageData(nLon, nLat);

  mapSvg.append("path").attr("class", "graticule");
  mapSvg.append("text").attr("class", "equator-label").text("equator");
  mapSvg.append("path").attr("class", "country");
  mapSvg.append("path").attr("class", "coast");
  mapSvg.append("g").attr("class", "pins-layer");
  mapSvg.on("pointermove", (e) => { lastMapEvent = e; showMapTip(e); })
    .on("pointerleave", () => { mapTip.hidden = true; lastMapEvent = null; })
    .on("click", addPin);

  tsSvg.append("rect").attr("class", "night night-am");
  tsSvg.append("rect").attr("class", "night night-pm");
  tsSvg.append("text").attr("class", "night-label");
  tsSvg.append("g").attr("class", "gridline y-grid");
  tsSvg.append("g").attr("class", "axis x-axis");
  tsSvg.append("g").attr("class", "axis y-axis");
  tsSvg.append("line").attr("class", "even-line");
  tsSvg.append("text").attr("class", "even-label");
  tsSvg.append("g").attr("class", "refs");
  tsSvg.append("g").attr("class", "lines");
  tsSvg.append("rect").attr("class", "hour-band");
  tsSvg.append("line").attr("class", "hover-rule").attr("opacity", 0);
  tsSvg.append("g").attr("class", "dots");
  tsSvg.on("pointermove", showProfileTip)
    .on("pointerleave", () => { tsTip.hidden = true; tsSvg.select(".hover-rule").attr("opacity", 0); })
    .on("click", (e) => { togglePlay(false); setHour(hourFromX(d3.pointer(e)[0])); });

  d3.select("#hour").on("input", function () { togglePlay(false); setHour(+this.value); });
  d3.select("#play").on("click", () => togglePlay());
  window.addEventListener("keydown", (e) => {
    if (e.target.id === "hour") return; // the slider handles its own arrows
    if (e.key === "ArrowRight") { togglePlay(false); setHour(state.hour + 1); e.preventDefault(); }
    if (e.key === "ArrowLeft") { togglePlay(false); setHour(state.hour - 1); e.preventDefault(); }
  });
  let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { layoutMap(); layoutProfile(); }, 100); });

  const fmtDate = d3.utcFormat("%-d %b %Y");
  const start = new Date(D.start), end = new Date(+start + (D.days - 1) * 864e5);
  document.getElementById("data-note").innerHTML =
    `<strong>Data:</strong> NOAA GOES-16 Geostationary Lightning Mapper, Level 2 flashes (<code>GLM-L2-LCFA</code>), ` +
    `${fmtDate(start)} – ${fmtDate(end)}. <strong>Transformations:</strong> GLM writes a file every 20 seconds, so we sampled ` +
    `three 20-second files per UTC hour per day (${D.filesUsed.toLocaleString()} files, ${d3.format(",")(D.totalFlashes)} good-quality flashes; ` +
    `${d3.format(",")(D.mapFlashes)} fall inside this map). ` +
    `Each flash is placed in a 0.5° cell and in a local solar hour (UTC + longitude ÷ 15). The map shows each cell's rate averaged over the ` +
    `surrounding 3×3 cells (a 1.5° box) to reduce sampling noise. Because every UTC hour was sampled ` +
    `equally, every hour at every place gets the same ${Math.round(D.sampledSecondsPerBin / 60)} minutes of observation, so counts ` +
    `convert to rates (flashes per hour per 1,000 km²). We removed ${D.artifactCells} isolated cell (${d3.format(",")(D.artifactFlashes)} flashes ` +
    `in one 0.5° box in the open Pacific with none around it, spread evenly over all 24 hours), which is a detection artifact, not a storm. Rates under ${RATE_FLOOR} are not drawn. Pinned profiles sum the 3×3 cells (1.5°) around ` +
    `the pin and show each hour's share of that place's flashes; "all land" and "all water" pool every cell on the map. ` +
    `Land vs. water uses Natural Earth 1:50m land polygons (Lake Maracaibo counts as water). GLM sees the Americas from 75.2°W, ` +
    `so detection weakens toward the edges of the disk.`;

  drawLegend(); renderPins();
  layoutMap(); layoutProfile(); setHour(state.hour);
}

init();
