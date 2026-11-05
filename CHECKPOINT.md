# Checkpoint video plan (due Thu 11/05, 11:59 PM)

Submit one **mp4, 2 minutes or less, with voice-over** on Gradescope, and add every team member to the submission.

Record the screen while one person narrates (QuickTime › File › New Screen Recording, with the mic on).
Show the six PNGs in `figures/exploratory/`, then the live prototype (`python3 -m http.server`, open `http://localhost:8000`).

> **Before recording:** confirm on Ed that GLM lightning data counts as the GOES dataset. It lives in the same
> NOAA GOES AWS bucket the spec links to, but the spec only describes the imagery products.

---

## 1. Team (≈ 5 s)
- Team name: **TODO**
- Members: **TODO**

## 2. Dataset and the parts we use (≈ 20 s)
- **NOAA GOES-16 Geostationary Lightning Mapper (GLM), Level 2 flashes** (`GLM-L2-LCFA`), from the public
  `noaa-goes16` S3 bucket in the NODD GOES docs. GOES-16 sits over 75.2°W and sees the whole Americas.
- GLM writes a file every 20 s (≈ 134,000 per month), so we **sampled 3 files per UTC hour, every day of
  August 2023**: 2,232 files and 769,011 good-quality flashes (`flash_quality_flag == 0`).
- Fields used: flash latitude, longitude, time, and quality flag. Each flash is binned into a 0.5° cell and a
  **local solar hour** (UTC + longitude ÷ 15). Because every UTC hour is sampled equally, each hour at each
  place gets the same 31 minutes of observation, so counts convert to rates.
- Cleaning: we removed one artifact cell in the open Pacific (7°S, 96°W) with 14,457 flashes, spread evenly
  across all 24 hours and with nothing around it.

## 3. Exploratory graphs (≈ 50 s, ~8 s each)
| # | File | What it showed us |
|---|------|-------------------|
| 1 | `1_where_map.png` | Where lightning hits: Central America, Colombia, Mexico's west coast, the Amazon, the US Southeast. This is the static map everyone makes, and it says nothing about *when*. |
| 2 | `2_peak_hour_map.png` | The busiest hour at each place: most land peaks mid-to-late afternoon, but there are clear night-peaking patches (the Plains, Lake Maracaibo, coasts and oceans). |
| 3 | `3_land_vs_water.png` | All land vs. all water: land lightning is sharply afternoon (≈ 11% of flashes in the 4 pm hour, under 1% at 9 am); water lightning is flat and slightly higher overnight. |
| 4 | `4_hotspot_profiles.png` | Six places: **Lake Maracaibo peaks at 2–3 am (86% of its flashes at night)**, Kansas at 2–3 am (93% at night), Central Florida at 2–3 pm (12% at night), the Pacific off Colombia near dawn. |
| 5 | `5_night_share_map.png` | The share of flashes between 6 pm and 6 am: red (daytime) continents, blue (nighttime) Plains, Maracaibo, coastal waters. |
| 6 | `6_four_hours.png` | Four snapshots (3 am / 9 am / 3 pm / 9 pm): a static stand-in for a slider, which already hints that the hour is the story. |

Note: in our August sample, Colombia's Magdalena valley is busier than Lake Maracaibo. Maracaibo's "most
lightning on Earth" title comes from the multi-year satellite record (TRMM LIS), not from one month.

## 4. Title / question (≈ 10 s)
**Lightning Around the Clock:** *When during the day does lightning strike across the Americas, and which
places break the "afternoon thunderstorm" rule?*

## 5. Current progress on the interactive graphic (≈ 35 s, live demo)
Built in D3 only (plus `topojson-client` for country outlines):
- **Map** of flash rate (log color scale) for one local solar hour.
- **24-hour local-time slider** and Play button; a note explains the map is "3 pm everywhere", not one instant.
- **Click any location** to pin it (up to 4). The **hour-by-hour profile** chart shows each place's share of
  flashes per hour against "all land" and "all water" reference lines. Clicking the chart sets the slider.
- **Tooltips** on the map (rate, land/water, busiest nearby hour) and the chart.
- Default pins: Lake Maracaibo, Central Florida, and Kansas show the three patterns right away.

Next steps: write-up, annotations at key hours (e.g. "watch Maracaibo at 2 am"), and polish.

---

## Suggested narration (~2 min at a normal pace; adapt freely)

> Hi, we're **[team]**: **[names]**.
>
> We used the NOAA GOES dataset, specifically the Geostationary Lightning Mapper on GOES-16, which records
> every lightning flash across the Americas. It writes a new file every 20 seconds, so we sampled three files
> per hour for every day of August 2023, which is about 770 thousand flashes. We placed each flash on a
> half-degree grid by its local sun time, and removed one bad cell in the Pacific that was clearly a sensor artifact.
>
> Our first graph is the classic map of where lightning strikes, but it can't tell you when. So we mapped each
> place's busiest hour. Most land peaks in the afternoon, but some patches peak at night. Comparing all land with
> all water confirmed it: land lightning is an afternoon event, and over water it's spread out and leans
> overnight. Zooming into six places, Lake Maracaibo gets 86 percent of its lightning at night, peaking around
> 2 a.m. Kansas is even more nocturnal, while Central Florida peaks at 2 p.m. The night-share map shows the
> same split everywhere, and four static snapshots made it obvious that a slider would tell this better.
>
> So our question is: when during the day does lightning strike across the Americas, and which places break
> the afternoon-thunderstorm rule?
>
> Here's the prototype. As I drag the clock, the continents light up through the afternoon and fade at night,
> while Lake Maracaibo and the Plains light up after dark. Clicking any place adds its hour-by-hour profile,
> compared against all land and all water. Next, we'll add annotations and finish the write-up.
