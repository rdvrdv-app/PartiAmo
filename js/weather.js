/* weather.js — real forecast via Open-Meteo (no API key, CORS-enabled).
   Beyond the 16-day forecast horizon it falls back to last year's archive for the same dates. */

const Weather = (function () {

  // Local calendar date: toISOString() would shift the day for east-of-UTC timezones.
  const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

  async function geocode(city, country) {
    const q = encodeURIComponent(city);
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${q}&count=5&language=it&format=json`;
    const r = await fetch(url);
    if (!r.ok) throw new Error("Geocoding non disponibile");
    const j = await r.json();
    if (!j.results || !j.results.length) throw new Error(`Località "${city}" non trovata`);
    if (country) {
      const c = country.trim().toLowerCase();
      const hit = j.results.find(x => (x.country || "").toLowerCase().includes(c) || c.includes((x.country || "").toLowerCase()));
      if (hit) return hit;
    }
    return j.results[0];
  }

  async function daily(lat, lon, start, end, archive) {
    const base = archive
      ? "https://archive-api.open-meteo.com/v1/archive"
      : "https://api.open-meteo.com/v1/forecast";
    const vars = archive
      ? "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum"
      : "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max";
    const url = `${base}?latitude=${lat}&longitude=${lon}&daily=${vars}&timezone=auto&start_date=${start}&end_date=${end}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error("Servizio meteo non raggiungibile");
    const j = await r.json();
    if (!j.daily || !j.daily.time) return [];
    return j.daily.time.map((t, i) => ({
      date: t,
      code: j.daily.weather_code[i],
      tmax: j.daily.temperature_2m_max[i],
      tmin: j.daily.temperature_2m_min[i],
      rainP: j.daily.precipitation_probability_max ? j.daily.precipitation_probability_max[i] : null,
      rainMm: j.daily.precipitation_sum ? j.daily.precipitation_sum[i] : null,
      wind: j.daily.wind_speed_10m_max ? j.daily.wind_speed_10m_max[i] : null
    })).filter(d => d.tmax !== null && d.tmax !== undefined);
  }

  /* Fetch the forecast covering the trip; returns a summary used by the checklist engine. */
  async function fetchTrip(trip) {
    const place = await geocode(trip.dest, trip.country);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const start = new Date(trip.start + "T00:00:00");
    const end = new Date(trip.end + "T00:00:00");
    const horizon = addDays(today, 15);

    let days = [], source = "previsione";

    if (start <= horizon) {
      const s = start < today ? today : start;
      const e = end > horizon ? horizon : end;
      days = await daily(place.latitude, place.longitude, iso(s), iso(e), false);
    }

    // Trip extends past the forecast horizon → complete with last year's archive.
    if (end > horizon) {
      const gapStart = start > horizon ? start : addDays(horizon, 1);
      const ly = d => { const x = new Date(d); x.setFullYear(x.getFullYear() - 1); return x; };
      try {
        const hist = await daily(place.latitude, place.longitude, iso(ly(gapStart)), iso(ly(end)), true);
        hist.forEach(h => {
          const d = new Date(h.date + "T00:00:00");
          d.setFullYear(d.getFullYear() + 1);
          days.push(Object.assign({}, h, { date: iso(d), historical: true }));
        });
        source = days.some(d => !d.historical) ? "previsione + storico" : "storico anno precedente";
      } catch (e) { /* archive optional */ }
    }

    if (!days.length) throw new Error("Nessun dato meteo disponibile per queste date");

    const tmins = days.map(d => d.tmin), tmaxs = days.map(d => d.tmax);
    const rainDays = days.filter(d => (d.rainP != null ? d.rainP >= 40 : (d.rainMm || 0) >= 2)).length;

    return {
      place: `${place.name}${place.admin1 ? ", " + place.admin1 : ""} (${place.country})`,
      country: place.country,
      lat: place.latitude, lon: place.longitude,
      source,
      fetchedAt: new Date().toISOString(),
      days,
      tmin: Math.round(Math.min(...tmins)),
      tmax: Math.round(Math.max(...tmaxs)),
      tminAvg: Math.round(tmins.reduce((a, b) => a + b, 0) / tmins.length),
      tmaxAvg: Math.round(tmaxs.reduce((a, b) => a + b, 0) / tmaxs.length),
      rainDays,
      snow: days.some(d => [71, 73, 75, 77, 85, 86].includes(d.code)),
      storm: days.some(d => [95, 96, 99].includes(d.code)),
      windy: days.some(d => (d.wind || 0) >= 40)
    };
  }

  return { fetchTrip, geocode };
})();
