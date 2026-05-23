// ── Linear regression ────────────────────────────────────────────────────────
export function linReg(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const ssxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  const ssxy = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0);
  const slope = ssxy / ssxx;
  const intercept = my - slope * mx;
  const ssres = ys.reduce((a, y, i) => a + (y - (slope * xs[i] + intercept)) ** 2, 0);
  const sstot = ys.reduce((a, y) => a + (y - my) ** 2, 0);
  const r2 = sstot === 0 ? 1 : 1 - ssres / sstot;
  const se = Math.sqrt((ssres / Math.max(n - 2, 1)) / ssxx);
  return { slope, intercept, r2, se, n };
}

// ── Exponentially weighted moving average on weight ───────────────────────────
export function ewaSmooth(entries, alpha = 0.15) {
  const out = [];
  let ewa = entries[0].wt;
  for (const e of entries) {
    ewa = alpha * e.wt + (1 - alpha) * ewa;
    out.push({ ...e, ewaWt: parseFloat(ewa.toFixed(3)) });
  }
  return out;
}

// ── LOWESS-style local regression smoother ───────────────────────────────────
export function lowess(xs, ys, bandwidth = 0.4) {
  const n = xs.length;
  const xRange = xs[n - 1] - xs[0] || 1;
  const h = xRange * bandwidth;
  return xs.map((x0) => {
    const weights = xs.map(x => {
      const u = Math.abs(x - x0) / h;
      return u < 1 ? Math.pow(1 - Math.pow(u, 3), 3) : 0;
    });
    const sw   = weights.reduce((a, b) => a + b, 0);
    if (sw === 0) return ys[xs.indexOf(x0)];
    const swx  = weights.reduce((a, w, j) => a + w * xs[j], 0);
    const swy  = weights.reduce((a, w, j) => a + w * ys[j], 0);
    const swxx = weights.reduce((a, w, j) => a + w * xs[j] * xs[j], 0);
    const swxy = weights.reduce((a, w, j) => a + w * xs[j] * ys[j], 0);
    const denom = sw * swxx - swx * swx;
    if (Math.abs(denom) < 1e-10) return swy / sw;
    const slope = (sw * swxy - swx * swy) / denom;
    const intercept = (swy - slope * swx) / sw;
    return slope * x0 + intercept;
  });
}

// ── Main analysis ─────────────────────────────────────────────────────────────
export function analyze(entries, unit) {
  if (entries.length < 5) return null;
  const kcalPerUnit = unit === 'kg' ? 7700 : 3500;

  const xs = entries.map(e => e.relDay);
  const ys = entries.map(e => e.wt);
  const reg = linReg(xs, ys);

  const avgCal = entries.reduce((a, e) => a + e.cal, 0) / entries.length;
  const tdee = avgCal - reg.slope * kcalPerUnit;
  const tdeeCI95 = 1.96 * reg.se * kcalPerUnit;

  // EWA-smoothed weight
  const smoothed = ewaSmooth(entries, 0.15);

  // Rolling 14-day TDEE — raw endpoints (noisy)
  const rollingRaw = [];
  for (let i = 13; i < entries.length; i++) {
    const w = entries.slice(i - 13, i + 1);
    const wChange = w[w.length - 1].wt - w[0].wt;
    const days = w[w.length - 1].relDay - w[0].relDay;
    if (days < 1) continue;
    const avgC = w.reduce((a, e) => a + e.cal, 0) / w.length;
    rollingRaw.push({
      day: w[w.length - 1].relDay,
      label: w[w.length - 1].label,
      tdeeRaw: Math.round(avgC - (wChange / days) * kcalPerUnit),
    });
  }

  // Rolling 14-day TDEE — EWA endpoints (smooth)
  const ewaRolling = [];
  for (let i = 13; i < smoothed.length; i++) {
    const w = smoothed.slice(i - 13, i + 1);
    const wChange = w[w.length - 1].ewaWt - w[0].ewaWt;
    const days = w[w.length - 1].relDay - w[0].relDay;
    if (days < 1) continue;
    const avgC = w.reduce((a, e) => a + e.cal, 0) / w.length;
    ewaRolling.push({
      day: w[w.length - 1].relDay,
      label: w[w.length - 1].label,
      tdeeEwa: Math.round(avgC - (wChange / days) * kcalPerUnit),
    });
  }

  // LOWESS over EWA rolling → drift trend
  const lwXs = ewaRolling.map(r => r.day);
  const lwYs = ewaRolling.map(r => r.tdeeEwa);
  const lwSmooth = lowess(lwXs, lwYs, 0.4);
  const smoothedTDEE = ewaRolling.map((r, i) => ({ ...r, tdeeDrift: Math.round(lwSmooth[i]) }));

  // Merge raw + EWA + drift by day
  const dayMap = {};
  rollingRaw.forEach(r  => { dayMap[r.day] = { ...dayMap[r.day], day: r.day, label: r.label, tdeeRaw: r.tdeeRaw }; });
  smoothedTDEE.forEach(r => { dayMap[r.day] = { ...dayMap[r.day], day: r.day, label: r.label, tdeeEwa: r.tdeeEwa, tdeeDrift: r.tdeeDrift }; });
  const combined = Object.values(dayMap).sort((a, b) => a.day - b.day);

  return { tdee, tdeeCI95, avgCal, weightChangePerDay: reg.slope, reg, combined, kcalPerUnit };
}

// ── Rolling consistency: mean & std dev bands on calorie intake ──────────────
export function rollingConsistency(entries, window = 14) {
  const result = [];
  
  for (let i = window - 1; i < entries.length; i++) {
    const slice = entries.slice(i - window + 1, i + 1);
    const cals = slice.map(e => e.cal);
    
    // Calculate mean
    const mean = cals.reduce((a, b) => a + b, 0) / cals.length;
    
    // Calculate standard deviation
    const variance = cals.reduce((a, cal) => a + Math.pow(cal - mean, 2), 0) / cals.length;
    const stdDev = Math.sqrt(variance);
    
    // ±1.5 std dev band
    const bandwidth = 1.5 * stdDev;
    
    result.push({
      day: entries[i].relDay,
      label: entries[i].label,
      cal: entries[i].cal,
      mean: parseFloat(mean.toFixed(1)),
      upper: parseFloat((mean + bandwidth).toFixed(1)),
      lower: parseFloat(Math.max(0, mean - bandwidth).toFixed(1)),
      stdDev: parseFloat(stdDev.toFixed(1)),
    });
  }
  
  return result;
}
