import { useState, useMemo, useRef, useCallback } from 'react';
import {
  ComposedChart, Line, Bar, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Area,
} from 'recharts';
import { analyze, linReg, rollingConsistency } from './analysis.js';
import CsvImporter from './CsvImporter.jsx';
import GoogleSheetsImporter from './GoogleSheetsImporter.jsx';
import html2canvas from 'html2canvas';

// ── Fonts ─────────────────────────────────────────────────────────────────────
const FONT_DISPLAY = "'Montserrat', sans-serif";
const FONT_NUMERIC = "'Quicksand', system-ui, sans-serif";
const FONT_MONO    = "'DM Mono', 'Fira Mono', monospace";

// ── Theme system ──────────────────────────────────────────────────────────────
const THEMES = {
  dark: {
    // Surfaces
    bg: '#080a0f', card: '#0c0e16', cardInner: '#0a0c14', inputBg: '#070910',
    tooltipBg: '#0f1117', tooltipBorder: '#2a2d3a',
    border: '#1a1f2e', borderSubtle: '#13161f',
    // Text hierarchy (brightest → dimmest)
    text: '#c9cfe0', textSec: '#4a5066', textMuted: '#939396', textFaint: '#2e3244', textLabel: '#5a607a',
    // Accents
    blue: '#3d7fff', blueSoft: '#7eb3ff', green: '#4ecb71', gold: '#f0c040', coral: '#ff8c6b', error: '#ff6b6b',
    // UI
    btnActive: '#1a1f2e', btnBorder: '#1e2130', scrollTrack: '#0f1117', scrollThumb: '#2a2d3a',
    overlay: '#000000cc',
    // Chart
    chartBlue: '#3d7fff', grid: '#1e2130',
  },
  light: {
    // Surfaces
    bg: '#f0f2f5', card: '#ffffff', cardInner: '#f5f6f8', inputBg: '#ffffff',
    tooltipBg: '#1a2030', tooltipBorder: '#2a3040',
    border: '#d8dce5', borderSubtle: '#e8ebf0',
    // Text hierarchy
    text: '#1a1f2e', textSec: '#5a607a', textMuted: '#6b7280', textFaint: '#9ca3af', textLabel: '#6b7280',
    // Accents
    blue: '#2b6ae0', blueSoft: '#5d9cff', green: '#38a85c', gold: '#d4a820', coral: '#e06040', error: '#d94040',
    // UI
    btnActive: '#e0e8ff', btnBorder: '#c8d0e0', scrollTrack: '#f0f2f5', scrollThumb: '#c0c6d4',
    overlay: '#000000aa',
    // Chart
    chartBlue: '#1e5fd7', grid: '#c0c0c0',
  },
};

// ── Shared styles ─────────────────────────────────────────────────────────────
const TAB_STYLE = (active, T) => ({
  background: active ? T.btnActive : 'none',
  border: `1px solid ${active ? T.blue : T.btnBorder}`,
  color: active ? T.blueSoft : T.textLabel,
  padding: '6px 14px', borderRadius: 4, cursor: 'pointer',
  fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '.08em', transition: 'all .15s',
});

const CARD_STYLE = (accentColor, prominent, T) => ({
  background: T.card,
  border: `1px solid ${prominent ? accentColor + '44' : T.border}`,
  borderRadius: 8, padding: prominent ? '14px 16px' : '12px 14px',
});

const CustomTooltip = ({ active, payload, T }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: T.tooltipBg, border: `1px solid ${T.tooltipBorder}`, borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#c9cfe0', fontFamily: FONT_MONO }}>
      {payload.map((p, i) => (
        <div key={i}>
          <span style={{ color: p.color }}>{p.name}:</span>{' '}
          {typeof p.value === 'number'
            ? p.value.toFixed(['weight','ma7','ma21','calAvg7','calAvg14','calAvg21'].includes(p.name) ? (p.name.startsWith('cal') ? 0 : 2) : 0)
            : p.value}
        </div>
      ))}
    </div>
  );
};

// ── Moving average helper ─────────────────────────────────────────────────────
function movingAvg(arr, key, win) {
  return arr.map((d, i) => {
    const slice = arr.slice(Math.max(0, i - win + 1), i + 1);
    const avg = slice.reduce((s, x) => s + (x[key] ?? 0), 0) / slice.length;
    return parseFloat(avg.toFixed(3));
  });
}

// ── Number formatter with locale-appropriate thousands separator ───────────
function formatThousands(num, unit) {
  if (num == null) return num;
  const n = Math.round(num);
  if (unit === 'kg') {
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  } else {
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
}

// ── Number formatter for decimals with locale-appropriate separator ────────
function formatDecimal(num, decimals, unit) {
  if (num == null) return num;
  const rounded = num.toFixed(decimals);
  if (unit === 'kg') {
    return rounded.replace('.', ',');
  } else {
    return rounded;
  }
}

// ── X-axis date tick formatter ────────────────────────────────────────────────
function makeDateFormatter(entries) {
  if (!entries?.length) return (v) => v;
  const d0 = entries[0].dayNum;
  return (relDay) => {
    const ms = (d0 + relDay) * 86400000;
    const d = new Date(ms);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  };
}

// ── "Show dates" checkbox (shared across chart panels) ────────────────────────
function DateToggle({ showDates, onChange, T }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11, color: T.textSec, fontFamily: FONT_MONO, userSelect: 'none' }}>
      <input type="checkbox" checked={showDates} onChange={e => onChange(e.target.checked)}
        style={{ accentColor: T.blue, cursor: 'pointer' }} />
      show dates
    </label>
  );
}

// ── Chart components ──────────────────────────────────────────────────────────

function WeightChart({ data, entries, height, large, showDates, T }) {
  const fs = large ? 11 : 10;
  const fmtDate = useMemo(() => makeDateFormatter(entries), [entries]);
  const xProps = showDates
    ? { tickFormatter: fmtDate, height: 28 }
    : {};
  return (
    <>
      <div style={{ fontSize: fs - 1, letterSpacing: '.1em', color: T.textMuted, textAlign: 'center', marginBottom: 10 }}>
        WEIGHT OVER TIME WITH REGRESSION TREND
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 4, right: 24, left: 0, bottom: showDates ? 8 : 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={T.grid} />
          <XAxis dataKey="day" tick={{ fill: T.textMuted, fontSize: fs }} tickLine={false} {...xProps} />
          <YAxis tick={{ fill: T.textMuted, fontSize: fs }} tickLine={false} domain={['auto', 'auto']} width={40} />
          <Tooltip content={<CustomTooltip T={T} />} />
          <Scatter name="weight" dataKey="weight" fill={T.chartBlue} opacity={0.5} r={large ? 4 : 3} />
          <Line name="trend" type="monotone" dataKey="trend" stroke={T.coral} strokeWidth={2} dot={false} strokeDasharray="4 2" />
        </ComposedChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: fs - 1, color: T.textMuted }}><span style={{ color: T.chartBlue }}>●</span> measured weight</span>
        <span style={{ fontSize: fs - 1, color: T.textMuted }}><span style={{ color: T.coral }}>— —</span> regression trend</span>
      </div>
    </>
  );
}

function TdeeChart({ data, entries, result, recentResult, recentWeeks, height, large, showDates, T }) {
  const fs = large ? 11 : 10;
  const fmtDate = useMemo(() => makeDateFormatter(entries), [entries]);
  const xProps = showDates
    ? { tickFormatter: fmtDate, height: 28 }
    : {};
  return (
    <>
      <div style={{ fontSize: fs - 1, letterSpacing: '.1em', color: T.textMuted, textAlign: 'center', marginBottom: 10 }}>
        TDEE OVER TIME — RAW · EWA-SMOOTHED · DRIFT TREND
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 20, right: 24, left: 0, bottom: showDates ? 8 : 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={T.grid} />
          <XAxis dataKey="day" tick={{ fill: T.textMuted, fontSize: fs }} tickLine={false} {...xProps} />
          <YAxis tick={{ fill: T.textMuted, fontSize: fs }} tickLine={false} domain={['auto', 'auto']} width={46} />
          <Tooltip content={<CustomTooltip T={T} />} />
          <ReferenceLine y={Math.round(result.tdee)} stroke={T.coral} strokeDasharray="4 2" strokeWidth={1.5}
            label={{ value: `full: ${Math.round(result.tdee)}`, fill: T.coral, fontSize: fs - 1, position: 'insideTopRight' }} />
          {recentResult && (
            <ReferenceLine y={Math.round(recentResult.tdee)} stroke={T.green} strokeDasharray="4 2" strokeWidth={1.5}
              label={{ value: `${recentWeeks}w: ${Math.round(recentResult.tdee)}`, fill: T.green, fontSize: fs - 1, position: 'insideBottomRight' }} />
          )}
          <Line name="raw 14d"      type="monotone" dataKey="tdeeRaw"    stroke={T.chartBlue + '33'} strokeWidth={large ? 1.5 : 1}   dot={false} connectNulls />
          <Line name="EWA-smoothed" type="monotone" dataKey="tdeeEwa"    stroke={T.blueSoft}   strokeWidth={large ? 2 : 1.5}   dot={false} connectNulls />
          <Line name="drift trend"  type="monotone" dataKey="tdeeDrift"  stroke={T.green}   strokeWidth={large ? 3 : 2.5}   dot={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: fs - 1, color: T.textMuted }}><span style={{ color: T.chartBlue + '44' }}>—</span> raw 14d (noisy)</span>
        <span style={{ fontSize: fs - 1, color: T.textMuted }}><span style={{ color: T.blueSoft }}>—</span> EWA-smoothed</span>
        <span style={{ fontSize: fs - 1, color: T.textMuted }}><span style={{ color: T.green }}>—</span> drift trend (LOWESS)</span>
        <span style={{ fontSize: fs - 1, color: T.textMuted }}><span style={{ color: T.coral }}>- -</span> full-period TDEE</span>
      </div>
      {!large && (
        <div style={{ fontSize: 11, color: T.textFaint, textAlign: 'center', marginTop: 8, padding: '0 12px' }}>
          The green drift curve shows whether your TDEE has been rising or falling over time.
        </div>
      )}
    </>
  );
}

function MaCloudChart({ data, entries, unit, height, large, showDates, T }) {
  const fs = large ? 11 : 10;
  const fmtDate = useMemo(() => makeDateFormatter(entries), [entries]);
  const xProps = showDates
    ? { tickFormatter: fmtDate, height: 28 }
    : {};

  const chartData = useMemo(() => {
    const ma7      = movingAvg(data, 'weight', 7);
    const ma21     = movingAvg(data, 'weight', 21);
    const calAvg7  = movingAvg(data, 'cal', 7);
    const calAvg21 = movingAvg(data, 'cal', 21);
    return data.map((d, i) => ({
      day:       d.day,
      weight:    d.wt,
      ma7:       ma7[i],
      ma21:      ma21[i],
      cloudLow:  parseFloat(Math.min(ma7[i], ma21[i]).toFixed(3)),
      cloudHigh: parseFloat(Math.max(ma7[i], ma21[i]).toFixed(3)),
      calAvg7:   calAvg7[i],
      calAvg21:  calAvg21[i],
      cal:       d.cal,
    }));
  }, [data]);

  const cloudH  = large ? Math.round(height * 0.55) : 210;
  const calH    = large ? Math.round(height * 0.32) : 120;

  return (
    <>
      <div style={{ fontSize: fs - 1, letterSpacing: '.1em', color: T.textMuted, textAlign: 'center', marginBottom: 6 }}>
        WEIGHT MA CLOUD — 7-DAY / 21-DAY · CALORIE 7d & 21d AVERAGES
      </div>
      <div style={{ fontSize: 11, color: T.textMuted, textAlign: 'center', marginBottom: 10 }}>
        Cloud narrows = stable trend. Fast (7d) <span style={{ color: T.green }}>green</span> below slow (21d) <span style={{ color: T.gold }}>yellow</span> = confirmed downtrend.
      </div>

      <ResponsiveContainer width="100%" height={cloudH}>
        <ComposedChart data={chartData} margin={{ top: 8, right: 24, left: 0, bottom: showDates ? 8 : 4 }}>
          <defs>
            <linearGradient id="cloudGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={T.chartBlue} stopOpacity={0.18} />
              <stop offset="100%" stopColor={T.chartBlue} stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={T.grid} />
          <XAxis dataKey="day" tick={{ fill: T.textMuted, fontSize: fs }} tickLine={false} {...xProps} />
          <YAxis tick={{ fill: T.textMuted, fontSize: fs }} tickLine={false} domain={['auto', 'auto']} width={40} />
          <Tooltip content={<CustomTooltip T={T} />} />
          <Scatter name="weight" dataKey="weight" fill={T.chartBlue} opacity={0.2} r={large ? 3 : 2} />
          <Area type="monotone" dataKey="cloudHigh" stroke="none" fill="url(#cloudGrad)" legendType="none" dot={false} connectNulls />
          <Area type="monotone" dataKey="cloudLow"  stroke="none" fill={T.bg}            legendType="none" dot={false} connectNulls />
          <Line name="ma7"  type="monotone" dataKey="ma7"  stroke={T.green} strokeWidth={large ? 2.5 : 2} dot={false} connectNulls />
          <Line name="ma21" type="monotone" dataKey="ma21" stroke={T.gold} strokeWidth={large ? 2.5 : 2} dot={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>

      <div style={{ fontSize: fs - 1, letterSpacing: '.1em', color: T.textMuted, textAlign: 'center', margin: '14px 0 6px' }}>
        7-DAY & 21-DAY ROLLING CALORIE AVERAGES
      </div>
      <ResponsiveContainer width="100%" height={calH}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 24, left: 0, bottom: showDates ? 8 : 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={T.grid} />
          <XAxis dataKey="day" tick={{ fill: T.textMuted, fontSize: fs }} tickLine={false} {...xProps} />
          <YAxis tick={{ fill: T.textMuted, fontSize: fs }} tickLine={false} domain={['auto', 'auto']} width={46} />
          <Tooltip content={<CustomTooltip T={T} />} />
          <Bar  dataKey="cal"      fill={T.chartBlue} opacity={0.10} name="daily kcal" />
          <Line name="calAvg7"  type="monotone" dataKey="calAvg7"  stroke={T.blueSoft} strokeWidth={large ? 2 : 1.5} dot={false} connectNulls />
          <Line name="calAvg21" type="monotone" dataKey="calAvg21" stroke={T.gold} strokeWidth={large ? 2 : 1.5} dot={false} strokeDasharray="5 3" connectNulls />
        </ComposedChart>
      </ResponsiveContainer>

      <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: fs - 1, color: T.textMuted }}><span style={{ color: T.green }}>—</span> 7d MA weight</span>
        <span style={{ fontSize: fs - 1, color: T.textMuted }}><span style={{ color: T.gold }}>—</span> 21d MA weight</span>
        <span style={{ fontSize: fs - 1, color: T.textMuted }}><span style={{ color: T.blueSoft }}>—</span> 7d avg kcal</span>
        <span style={{ fontSize: fs - 1, color: T.textMuted }}><span style={{ color: T.gold }}>- -</span> 21d avg kcal</span>
      </div>
    </>
  );
}

function CalIntakeChart({ entries, result, unit, height, large, T }) {
  const fs = large ? 11 : 10;

  const scatterData = useMemo(() => {
    const pts = [];
    for (let i = 0; i < entries.length - 1; i++) {
      const wtChange = entries[i + 1].wt - entries[i].wt;
      if (Math.abs(wtChange) < 3) pts.push({ cal: entries[i].cal, wtChange: parseFloat(wtChange.toFixed(2)) });
    }
    return pts;
  }, [entries]);

  const scatterReg = useMemo(() => {
    if (scatterData.length < 5) return null;
    const xs = scatterData.map(d => d.cal);
    const ys = scatterData.map(d => d.wtChange);
    const r = linReg(xs, ys);
    const zeroCal = -r.intercept / r.slope;
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    return {
      lineData: [
        { cal: xMin, regLine: parseFloat((r.slope * xMin + r.intercept).toFixed(3)) },
        { cal: xMax, regLine: parseFloat((r.slope * xMax + r.intercept).toFixed(3)) },
      ],
      zeroCal: Math.round(zeroCal),
      r2: r.r2,
    };
  }, [scatterData]);

  const bucketData = useMemo(() => {
    const size = 400;
    const map = {};
    scatterData.forEach(d => {
      const bucket = Math.floor(d.cal / size) * size;
      if (!map[bucket]) map[bucket] = { total: 0, count: 0 };
      map[bucket].total += d.wtChange;
      map[bucket].count += 1;
    });
    return Object.entries(map)
      .map(([b, v]) => ({ bucket: `${(+b / 1000).toFixed(1)}k`, bucketMid: +b + size / 2, avgChange: parseFloat((v.total / v.count).toFixed(3)), count: v.count }))
      .sort((a, b) => a.bucketMid - b.bucketMid);
  }, [scatterData]);

  const BucketTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
      <div style={{ background: T.tooltipBg, border: `1px solid ${T.tooltipBorder}`, borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#c9cfe0', fontFamily: FONT_MONO }}>
        <div><span style={{ color: T.blueSoft }}>range:</span> {d.bucket}</div>
        <div><span style={{ color: T.blueSoft }}>avg Δweight:</span> {d.avgChange > 0 ? '+' : ''}{d.avgChange} {unit}</div>
        <div><span style={{ color: '#8a8ea0' }}>n days:</span> {d.count}</div>
      </div>
    );
  };

  const ScatterTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    return (
      <div style={{ background: T.tooltipBg, border: `1px solid ${T.tooltipBorder}`, borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#c9cfe0', fontFamily: FONT_MONO }}>
        <div><span style={{ color: T.blueSoft }}>calories:</span> {d?.cal}</div>
        <div><span style={{ color: T.blueSoft }}>next-day Δweight:</span> {d?.wtChange > 0 ? '+' : ''}{d?.wtChange} {unit}</div>
      </div>
    );
  };

  const scatterH = large ? Math.round(height * 0.52) : 200;
  const bucketH  = large ? Math.round(height * 0.35) : 130;

  return (
    <>
      <div style={{ fontSize: fs - 1, letterSpacing: '.1em', color: T.textMuted, textAlign: 'center', marginBottom: 4 }}>
        CALORIES EATEN vs NEXT-DAY WEIGHT CHANGE
      </div>
      {scatterReg && (
        <div style={{ fontSize: 11, color: T.textFaint, textAlign: 'center', marginBottom: 8 }}>
          Zero-crossing (independent TDEE estimate): <span style={{ color: T.gold }}>{scatterReg.zeroCal.toLocaleString()} kcal</span>
          {' · '}R² {scatterReg.r2.toFixed(3)}
        </div>
      )}
      <ResponsiveContainer width="100%" height={scatterH}>
        <ComposedChart margin={{ top: 8, right: 24, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={T.grid} />
          <XAxis dataKey="cal" type="number" domain={['auto', 'auto']} tick={{ fill: T.textMuted, fontSize: fs }} tickLine={false}
            label={{ value: 'kcal eaten', position: 'insideBottomRight', fill: T.textMuted, fontSize: fs }} />
          <YAxis type="number" domain={['auto', 'auto']} tick={{ fill: T.textMuted, fontSize: fs }} tickLine={false} width={44}
            label={{ value: `Δ${unit}`, angle: -90, position: 'insideLeft', fill: T.textMuted, fontSize: fs }} />
          <ReferenceLine y={0} stroke={T.tooltipBorder} strokeWidth={1.5} />
          {scatterReg && (
            <ReferenceLine x={scatterReg.zeroCal} stroke={T.gold + '55'} strokeDasharray="3 3"
              label={{ value: `TDEE≈${scatterReg.zeroCal}`, fill: T.gold + 'aa', fontSize: fs - 1, position: 'top' }} />
          )}
          <Tooltip content={<ScatterTooltip />} />
          <Scatter data={scatterData} dataKey="wtChange" fill={T.chartBlue} opacity={0.5} r={large ? 4 : 3} />
          {scatterReg && (
            <Line data={scatterReg.lineData} type="linear" dataKey="regLine" stroke={T.coral} strokeWidth={2} dot={false} legendType="none" />
          )}
        </ComposedChart>
      </ResponsiveContainer>

      <div style={{ fontSize: fs - 1, letterSpacing: '.1em', color: T.textMuted, textAlign: 'center', margin: '14px 0 6px' }}>
        AVG WEIGHT CHANGE BY CALORIE BAND (400 kcal buckets)
      </div>
      <ResponsiveContainer width="100%" height={bucketH}>
        <ComposedChart data={bucketData} margin={{ top: 4, right: 24, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={T.grid} />
          <XAxis dataKey="bucket" tick={{ fill: T.textMuted, fontSize: fs }} tickLine={false} />
          <YAxis tick={{ fill: T.textMuted, fontSize: fs }} tickLine={false} width={44}
            label={{ value: `Δ${unit}`, angle: -90, position: 'insideLeft', fill: T.textMuted, fontSize: fs }} />
          <ReferenceLine y={0} stroke={T.tooltipBorder} strokeWidth={1.5} />
          <Tooltip content={<BucketTooltip />} />
          <Bar dataKey="avgChange" radius={[3, 3, 0, 0]}
            fill={T.chartBlue}
            label={false}
          >
            {bucketData.map((d, i) => (
              <rect key={i} fill={d.avgChange < 0 ? T.green : T.coral} />
            ))}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>

      <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: fs - 1, color: T.textMuted }}><span style={{ color: T.chartBlue }}>●</span> daily observation</span>
        <span style={{ fontSize: fs - 1, color: T.textMuted }}><span style={{ color: T.coral }}>—</span> regression line</span>
        <span style={{ fontSize: fs - 1, color: T.textMuted }}><span style={{ color: T.gold }}>|</span> zero-crossing (TDEE)</span>
        <span style={{ fontSize: fs - 1, color: T.green }}>▮ loss band</span>
        <span style={{ fontSize: fs - 1, color: T.coral }}>▮ gain band</span>
      </div>
    </>
  );
}

// ── 7-day rolling weight vs calorie average chart ────────────────────────────
function RollingCorrelChart({ data, entries, unit, height, large, showDates, T }) {
  const fs = large ? 11 : 10;
  const fmtDate = useMemo(() => makeDateFormatter(entries), [entries]);
  const xProps = showDates ? { tickFormatter: fmtDate, height: 28 } : {};

  const chartData = useMemo(() => {
    const wtAvg7   = movingAvg(data, 'weight', 7);
    const calAvg14 = movingAvg(data, 'cal', 14);
    return data.map((d, i) => ({
      day:       d.day,
      wtAvg7:    wtAvg7[i],
      calAvg14:  Math.round(calAvg14[i]),
    })).slice(13);
  }, [data]);

  const DualTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const wt  = payload.find(p => p.dataKey === 'wtAvg7');
    const cal = payload.find(p => p.dataKey === 'calAvg14');
    const dateStr = showDates ? fmtDate(label) : `Day ${label}`;
    return (
      <div style={{ background: T.tooltipBg, border: `1px solid ${T.tooltipBorder}`, borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#c9cfe0', fontFamily: FONT_MONO }}>
        <div style={{ color: '#8a8ea0', marginBottom: 4 }}>{dateStr}</div>
        {wt  && <div><span style={{ color: wt.color  }}>7d avg weight:</span> {Number(wt.value).toFixed(2)} {unit}</div>}
        {cal && <div><span style={{ color: cal.color }}>14d avg kcal:</span>  {formatThousands(cal.value, unit)}</div>}
      </div>
    );
  };

  const corr = useMemo(() => {
    const xs = chartData.map(d => d.calAvg14);
    const ys = chartData.map(d => d.wtAvg7);
    const n  = xs.length;
    if (n < 3) return null;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    const num   = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0);
    const denX  = Math.sqrt(xs.reduce((a, x) => a + (x - mx) ** 2, 0));
    const denY  = Math.sqrt(ys.reduce((a, y) => a + (y - my) ** 2, 0));
    return denX * denY === 0 ? null : parseFloat((num / (denX * denY)).toFixed(3));
  }, [chartData]);

  const wtTicks = useMemo(() => {
    if (!chartData.length) return [];
    const weights = chartData.map(d => d.wtAvg7).filter(w => !isNaN(w));
    if (weights.length === 0) return [];
    const minW = Math.floor(Math.min(...weights));
    const maxW = Math.ceil(Math.max(...weights));
    const ticks = [];
    for (let i = minW; i <= maxW; i++) { ticks.push(i); }
    return ticks;
  }, [chartData]);

  const calTicks = useMemo(() => {
    if (!chartData.length) return [];
    const cals = chartData.map(d => d.calAvg14).filter(c => !isNaN(c));
    if (cals.length === 0) return [];
    const minC = Math.min(...cals);
    const maxC = Math.max(...cals);
    const minRounded = Math.floor(minC / 200) * 200;
    const maxRounded = Math.ceil(maxC / 200) * 200;
    const ticks = [];
    for (let i = minRounded; i <= maxRounded; i += 200) { ticks.push(i); }
    return ticks;
  }, [chartData]);

  return (
    <>
      <div style={{ fontSize: fs - 1, letterSpacing: '.1em', color: T.textMuted, textAlign: 'center', marginBottom: 4 }}>
        7-DAY ROLLING AVG WEIGHT vs 14-DAY ROLLING AVG CALORIES
      </div>
      <div style={{ fontSize: 11, color: T.textFaint, textAlign: 'center', marginBottom: 10 }}>
        {corr !== null && (
          <>
            Pearson correlation: <span style={{ color: Math.abs(corr) > 0.6 ? T.green : Math.abs(corr) > 0.3 ? T.gold : T.coral, fontFamily: FONT_NUMERIC, fontWeight: 900, letterSpacing: '.02em' }}>{corr}</span>
            {' · '}
            {Math.abs(corr) > 0.6
              ? 'Strong relationship — calorie intake tracks closely with weight trend.'
              : Math.abs(corr) > 0.3
              ? 'Moderate relationship — general pattern visible but other factors present.'
              : 'Weak relationship — weight changes driven more by water/retention noise than intake over this window.'}
          </>
        )}
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={chartData} margin={{ top: 8, right: 64, left: 0, bottom: showDates ? 8 : 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={T.grid} />
          <XAxis dataKey="day" tick={{ fill: T.textMuted, fontSize: fs }} tickLine={false} {...xProps} />
          <YAxis
            yAxisId="wt" orientation="left"
            tick={{ fill: T.green, fontSize: fs }} tickLine={false}
            ticks={wtTicks} domain={['auto', 'auto']} width={44}
            label={{ value: unit, angle: -90, position: 'insideLeft', fill: T.green, fontSize: fs }}
          />
          <YAxis
            yAxisId="cal" orientation="right"
            tick={{ fill: T.gold, fontSize: fs }}
            tickFormatter={(val) => formatThousands(val, unit)}
            tickLine={false} ticks={calTicks} domain={['auto', 'auto']} width={54}
            label={{ value: 'kcal', angle: 90, position: 'insideRight', fill: T.gold, fontSize: fs }}
          />
          <Tooltip content={<DualTooltip />} />
          <Area yAxisId="cal" type="monotone" dataKey="calAvg14"
            stroke={T.gold} strokeWidth={large ? 2 : 1.5}
            fill={T.gold + '12'} dot={false} connectNulls name="calAvg14" />
          <Line yAxisId="wt" type="monotone" dataKey="wtAvg7"
            stroke={T.green} strokeWidth={large ? 2.5 : 2} dot={false} connectNulls name="wtAvg7" />
        </ComposedChart>
      </ResponsiveContainer>

      <div style={{ display: 'flex', gap: 20, justifyContent: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: fs - 1, color: T.textMuted }}><span style={{ color: T.green }}>—</span> 7d avg weight <span style={{ color: T.textMuted }}>(left axis)</span></span>
        <span style={{ fontSize: fs - 1, color: T.textMuted }}><span style={{ color: T.gold }}>—</span> 14d avg calories <span style={{ color: T.textMuted }}>(right axis)</span></span>
      </div>
      <div style={{ fontSize: 11, color: T.textFaint, textAlign: 'center', marginTop: 6, padding: '0 16px' }}>
        Weight typically responds to calorie changes with a 2–5 day lag. Look for calorie spikes followed by weight bumps shortly after.
      </div>
    </>
  );
}

// ── Consistency bandwidth chart ───────────────────────────────────────────────
function ConsistencyChart({ entries, height, large, showDates, T }) {
  const fs = large ? 11 : 10;
  const fmtDate = useMemo(() => makeDateFormatter(entries), [entries]);
  const xProps = showDates ? { tickFormatter: fmtDate, height: 28 } : {};

  const consistencyData = useMemo(() => {
    if (!entries || entries.length < 14) return [];
    return rollingConsistency(entries, 14);
  }, [entries]);

  const ConsistencyTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    return (
      <div style={{ background: T.tooltipBg, border: `1px solid ${T.tooltipBorder}`, borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#c9cfe0', fontFamily: FONT_MONO }}>
        <div><span style={{ color: T.blueSoft }}>day:</span> {d?.day}</div>
        <div><span style={{ color: '#c9cfe0' }}>actual:</span> {Math.round(d?.cal)} kcal</div>
        <div><span style={{ color: T.gold }}>14d mean:</span> {Math.round(d?.mean)} kcal</div>
        <div><span style={{ color: T.green }}>±1.5 σ:</span> {Math.round(d?.stdDev)} kcal</div>
      </div>
    );
  };

  return (
    <>
      <div style={{ fontSize: fs - 1, letterSpacing: '.1em', color: T.textMuted, textAlign: 'center', marginBottom: 10 }}>
        14-DAY CALORIE CONSISTENCY — ROLLING MEAN & ±1.5 STD DEV BANDS
      </div>
      <div style={{ fontSize: 11, color: T.textFaint, textAlign: 'center', marginBottom: 10 }}>
        Narrower bands = more consistent intake. Watch the bandwidth shrink as you dial in your routine.
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={consistencyData} margin={{ top: 8, right: 24, left: 0, bottom: showDates ? 8 : 4 }}>
          <defs>
            <linearGradient id="bandGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={T.green} stopOpacity={0.12} />
              <stop offset="100%" stopColor={T.green} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={T.grid} />
          <XAxis dataKey="day" tick={{ fill: T.textMuted, fontSize: fs }} tickLine={false} {...xProps} />
          <YAxis tick={{ fill: T.textMuted, fontSize: fs }} tickLine={false} domain={['auto', 'auto']} width={46} />
          <Tooltip content={<ConsistencyTooltip />} />
          <Area type="monotone" dataKey="upper" stroke="none" fill="url(#bandGrad)" legendType="none" dot={false} connectNulls />
          <Area type="monotone" dataKey="lower" stroke="none" fill={T.bg} legendType="none" dot={false} connectNulls />
          <Line name="14d mean" type="monotone" dataKey="mean" stroke={T.gold} strokeWidth={large ? 2.5 : 2} dot={false} connectNulls />
          <Scatter name="daily intake" dataKey="cal" fill={T.chartBlue} opacity={0.4} r={large ? 4 : 3} />
        </ComposedChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: fs - 1, color: T.textMuted }}><span style={{ color: T.chartBlue }}>●</span> daily intake</span>
        <span style={{ fontSize: fs - 1, color: T.textMuted }}><span style={{ color: T.gold }}>—</span> 14d rolling mean</span>
        <span style={{ fontSize: fs - 1, color: T.textMuted }}><span style={{ color: T.green }}>▬</span> ±1.5 σ band (consistency width)</span>
      </div>
    </>
  );
}

// ── Body fat projections ──────────────────────────────────────────────────────
const BF_TARGETS = [5, 8, 10, 12, 15, 18, 20];

function BfProjections({ entries, result, recentResult, recentWeeks, unit, T }) {
  const [bfPct, setBfPct] = useState(18);
  const [open, setOpen]   = useState(true);

  const currentWeight   = entries[entries.length - 1].wt;
  const leanMass        = currentWeight * (1 - bfPct / 100);
  const ratePerDay      = result.weightChangePerDay;
  const rateRecentPerDay = recentResult?.weightChangePerDay ?? ratePerDay;

  const targets = BF_TARGETS.map(targetBf => {
    const isAbove = targetBf >= bfPct;
    const targetWeight = leanMass / (1 - targetBf / 100);
    const weightToLose = currentWeight - targetWeight;

    const fmt = (rate) => {
      if (!rate || rate >= 0) return null;
      const days = weightToLose / Math.abs(rate);
      if (days <= 0) return null;
      const weeks = days / 7, months = days / 30.44;
      return weeks < 2 ? `${Math.round(days)}d` : months < 3 ? `${Math.round(weeks)}w` : `${months.toFixed(1)}mo`;
    };

    const arrivalDate = (rate) => {
      if (!rate || rate >= 0) return null;
      const days = weightToLose / Math.abs(rate);
      if (days <= 0) return null;
      const d = new Date();
      d.setDate(d.getDate() + Math.round(days));
      return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
    };

    return {
      bf: targetBf,
      isAbove,
      targetWeight: isAbove ? null : parseFloat(targetWeight.toFixed(1)),
      weightToLose: isAbove ? null : parseFloat(weightToLose.toFixed(1)),
      etaAll:    isAbove ? null : fmt(ratePerDay),
      etaRecent: isAbove ? null : fmt(rateRecentPerDay),
      dateAll:   isAbove ? null : arrivalDate(ratePerDay),
      dateRecent: isAbove ? null : arrivalDate(rateRecentPerDay),
    };
  });

  const losing = ratePerDay < 0;

  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, marginBottom: 20, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', background: 'none', border: 'none', padding: '8px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, fontFamily: FONT_MONO }}
      >
        <span style={{ fontSize: 11, color: T.textFaint }}>{open ? '▲ collapse' : '▼ expand'}</span>
      </button>

      {open && (
        <div style={{ padding: '0 16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 10, color: T.textSec, letterSpacing: '.08em', textTransform: 'uppercase', fontFamily: FONT_MONO }}>Current body fat estimate</span>
                <span style={{ fontSize: 22, fontFamily: FONT_NUMERIC, fontWeight: 900, color: T.gold }}>{bfPct}%</span>
              </div>
              <input type="range" min={0} max={45} step={1} value={bfPct}
                onChange={e => setBfPct(+e.target.value)}
                style={{ width: '100%', accentColor: T.gold, cursor: 'pointer' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: T.textFaint, marginTop: 2, fontFamily: FONT_MONO }}>
                <span>0%</span><span>45%</span>
              </div>
            </div>
            <div style={{ background: T.cardInner, border: `1px solid ${T.border}`, borderRadius: 6, padding: '8px 14px', textAlign: 'center', minWidth: 100, flexShrink: 0 }}>
              <div style={{ fontSize: 9, color: T.textMuted, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 3, fontFamily: FONT_MONO }}>Lean mass</div>
              <div style={{ fontSize: 22, fontFamily: FONT_NUMERIC, fontWeight: 900, color: T.text }}>{formatDecimal(leanMass, 1, unit)}</div>
              <div style={{ fontSize: 10, color: T.textMuted, fontFamily: FONT_MONO }}>{unit} (fixed)</div>
            </div>
          </div>

          <>
            <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr 1fr 1fr 1fr', gap: 8, marginBottom: 6, padding: '0 2px' }}>
              {['Target', `Weight (${unit})`, `To lose (${unit})`, `ETA — full`, `ETA — ${recentWeeks}w`].map(h => (
                <div key={h} style={{ fontSize: 9, color: T.textMuted, letterSpacing: '.08em', textTransform: 'uppercase', fontFamily: FONT_MONO }}>{h}</div>
              ))}
            </div>

            {targets.map(t => {
              const accent = t.isAbove ? T.textSec : t.bf <= 10 ? T.green : T.blue;
              return (
                <div key={t.bf} style={{ display: 'grid', gridTemplateColumns: '70px 1fr 1fr 1fr 1fr', gap: 8, padding: '10px 2px', borderTop: `1px solid ${T.inputBg}`, alignItems: 'center', opacity: t.isAbove ? 0.5 : 1 }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: accent + '18', border: `1px solid ${accent}44`, borderRadius: 4, padding: '3px 8px', width: 'fit-content' }}>
                    <span style={{ fontSize: 15, fontFamily: FONT_NUMERIC, fontWeight: 600, color: accent }}>{t.bf}%</span>
                  </div>
                  <div>
                    {t.isAbove ? (
                      <div style={{ fontSize: 17, fontFamily: FONT_NUMERIC, fontWeight: 600, color: T.textSec }}>—</div>
                    ) : (
                      <>
                        <div style={{ fontSize: 17, fontFamily: FONT_NUMERIC, fontWeight: 600, color: T.text }}>{formatDecimal(t.targetWeight, 1, unit)}</div>
                        <div style={{ fontSize: 10, color: T.textMuted, fontFamily: FONT_MONO }}>target</div>
                      </>
                    )}
                  </div>
                  <div>
                    {t.isAbove ? (
                      <div style={{ fontSize: 17, fontFamily: FONT_NUMERIC, fontWeight: 600, color: T.textSec }}>—</div>
                    ) : (
                      <>
                        <div style={{ fontSize: 17, fontFamily: FONT_NUMERIC, fontWeight: 600, color: T.coral }}>−{formatDecimal(t.weightToLose, 1, unit)}</div>
                        <div style={{ fontSize: 10, color: T.textMuted, fontFamily: FONT_MONO }}>from now</div>
                      </>
                    )}
                  </div>
                  <div>
                    {t.isAbove ? (
                      <div style={{ fontSize: 17, fontFamily: FONT_NUMERIC, fontWeight: 600, color: T.textSec }}>—</div>
                    ) : losing && t.etaAll ? (
                      <>
                        <div style={{ fontSize: 16, fontFamily: FONT_NUMERIC, fontWeight: 600, color: T.blueSoft }}>{t.etaAll}</div>
                        <div style={{ fontSize: 10, color: T.textMuted, fontFamily: FONT_MONO }}>{t.dateAll}</div>
                      </>
                    ) : (
                      <div style={{ fontSize: 11, color: T.textFaint, fontFamily: FONT_MONO }}>not losing</div>
                    )}
                  </div>
                  <div>
                    {t.isAbove ? (
                      <div style={{ fontSize: 17, fontFamily: FONT_NUMERIC, fontWeight: 600, color: T.textSec }}>—</div>
                    ) : recentResult && rateRecentPerDay < 0 && t.etaRecent ? (
                      <>
                        <div style={{ fontSize: 16, fontFamily: FONT_NUMERIC, fontWeight: 600, color: T.green }}>{t.etaRecent}</div>
                        <div style={{ fontSize: 10, color: T.textMuted, fontFamily: FONT_MONO }}>{t.dateRecent}</div>
                      </>
                    ) : (
                      <div style={{ fontSize: 11, color: T.textFaint, fontFamily: FONT_MONO }}>—</div>
                    )}
                  </div>
                </div>
              );
            })}

            <div style={{ marginTop: 14, fontSize: 11, color: T.textFaint, lineHeight: 1.6, fontFamily: FONT_MONO }}>
              Lean mass ({formatDecimal(leanMass, 1, unit)} {unit}) held constant. Target weight = lean mass ÷ (1 − target bf%).
              ETAs assume current deficit is maintained and lean mass is preserved.
            </div>
          </>
        </div>
      )}
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [entries, setEntries]             = useState(null);
  const [unit, setUnit]                   = useState('kg');
  const [tab, setTab]                     = useState('weight');
  const [recentWeeks, setRecentWeeks]     = useState(12);
  const [customWeeks, setCustomWeeks]     = useState(12);
  const [windowMode, setWindowMode]       = useState('custom');
  const [hasData, setHasData]             = useState(false);
  const [expandedChart, setExpandedChart] = useState(null);
  const [showDates, setShowDates]         = useState(false);
  const [theme, setTheme]                 = useState('light');
  const [importMethod, setImportMethod]   = useState('sheets');
  const [snapshotting, setSnapshotting]   = useState(false);
  const snapshotRef = useRef(null);

  const T = THEMES[theme];

  const result = useMemo(() => entries ? analyze(entries, unit) : null, [entries, unit]);

  const recentEntries = useMemo(() => {
    if (!entries?.length) return [];
    const maxDay = entries[entries.length - 1].relDay;
    return entries.filter(e => e.relDay > maxDay - recentWeeks * 7);
  }, [entries, recentWeeks]);
  const recentResult = useMemo(() => analyze(recentEntries, unit), [recentEntries, unit]);

  const weightChartData = useMemo(() => {
    if (!result || !entries) return [];
    return entries.map(e => ({
      day:    e.relDay,
      weight: e.wt,
      cal:    e.cal,
      trend:  parseFloat((result.reg.intercept + result.reg.slope * e.relDay).toFixed(2)),
      label:  e.label,
    }));
  }, [entries, result]);

  const combinedData = useMemo(() => result?.combined ?? [], [result]);

  const TABS = [
    ['weight',  'Weight + Trend'],
    ['rolling', 'TDEE Over Time'],
    ['cloud',   'MA Cloud'],
    ['consistency', 'Consistency'],
    ['intake',  'Calories vs Weight'],
    ['correl',  'Rolling Avg Overlap'],
  ];

  const handleData = (newEntries) => { setEntries(newEntries); setHasData(true); };
  const reset = () => { setEntries(null); setHasData(false); setTab('weight'); };

  const chartProps = { entries, showDates, T };

  const renderChart = (which, height, large) => {
    if (which === 'weight')  return <WeightChart        {...chartProps} data={weightChartData} height={height} large={large} />;
    if (which === 'rolling') return <TdeeChart          {...chartProps} data={combinedData} result={result} recentResult={recentResult} recentWeeks={recentWeeks} height={height} large={large} />;
    if (which === 'cloud')   return <MaCloudChart       {...chartProps} data={weightChartData} unit={unit} height={height} large={large} />;
    if (which === 'consistency') return <ConsistencyChart {...chartProps} height={height} large={large} />;
    if (which === 'intake')  return <CalIntakeChart      entries={entries} result={result} unit={unit} height={height} large={large} T={T} />;
    if (which === 'correl')  return <RollingCorrelChart {...chartProps} data={weightChartData} unit={unit} height={height} large={large} />;
  };

  const inlineHeights = { weight: 440, rolling: 490, cloud: 480, consistency: 460, intake: 480, correl: 480 };
  const modalHeights  = { weight: 700, rolling: 700, cloud: 780, consistency: 740, intake: 780, correl: 700 };
  const snapshotHeight = 360;

  const takeSnapshot = useCallback(async () => {
    setSnapshotting(true);
    await new Promise(r => setTimeout(r, 150));
    try {
      const el = snapshotRef.current;
      if (!el) return;
      const canvas = await html2canvas(el, {
        backgroundColor: T.bg,
        scale: 2,
        useCORS: true,
        logging: false,
      });
      const date = new Date().toISOString().slice(0, 10);
      const link = document.createElement('a');
      link.download = `tdee-snapshot-${date}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } finally {
      setSnapshotting(false);
    }
  }, [T]);

  return (
    <div style={{ fontFamily: FONT_MONO, background: T.bg, minHeight: '100vh', color: T.text, padding: '28px 32px', transition: 'background .3s, color .3s' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Montserrat:wght@600;800&family=Quicksand:wght@600;700&display=swap');
        * { box-sizing: border-box; }
        textarea, select { resize: vertical; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: ${T.scrollTrack}; }
        ::-webkit-scrollbar-thumb { background: ${T.scrollThumb}; border-radius: 3px; }
        button:disabled { opacity: 0.4; cursor: not-allowed; }
        .import-action-btn { transition: all .15s; }
        .import-action-btn:hover { border-color: ${T.blue} !important; color: ${T.blueSoft} !important; background: ${T.btnActive} !important; }
        .import-action-btn:disabled:hover { border-color: ${T.btnBorder} !important; color: ${T.textLabel} !important; background: none !important; }
        .import-data-btn { transition: all .15s; }
        .import-data-btn:hover:not(:disabled) { filter: brightness(0.8); background: ${T.green}33 !important; }
      `}</style>

      <div style={{ maxWidth: 1300, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 28, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: '.2em', color: T.blue, marginBottom: 6, textTransform: 'uppercase' }}>Regression-based</div>
            <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 30, fontWeight: 800, margin: 0, color: T.text }}>Personal TDEE Calculator</h1>
            <p style={{ fontSize: 12, color: T.textSec, marginTop: 6, lineHeight: 1.6, maxWidth: 560 }}>
              Upload your calorie and weight tracking data. Uses linear regression — not noisy window averages — to give you a statistically honest maintenance estimate.
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
            <div style={{ fontSize: 10, color: T.textMuted, letterSpacing: '.06em' }}>THEME</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {[['light', '☀️', 'Light'], ['dark', '🌙', 'Dark']].map(([key, icon, label]) => (
                <button key={key} style={TAB_STYLE(theme === key, T)} onClick={() => setTheme(key)}>{icon} {label}</button>
              ))}
            </div>
            <div style={{ fontSize: 10, color: T.textMuted, letterSpacing: '.06em' }}>WEIGHT UNIT</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {['kg', 'lbs'].map(u => (
                <button key={u} style={TAB_STYLE(unit === u, T)} onClick={() => setUnit(u)}>{u}</button>
              ))}
            </div>
            {hasData && (
              <button onClick={reset} style={{ background: 'none', border: `1px solid ${T.btnBorder}`, color: T.textMuted, padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontFamily: FONT_MONO, fontSize: 10 }}>
                ← load new data
              </button>
            )}
          </div>
        </div>

        {!hasData && (
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {[['sheets', '📊 Google Sheets'], ['upload', '📂 Upload'], ['manual', '✎ Manual']].map(([key, label]) => (
                <button key={key} className="import-action-btn" onClick={() => setImportMethod(key)} style={TAB_STYLE(importMethod === key, T)}>{label}</button>
              ))}
            </div>
            <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: '20px', marginBottom: 20, minHeight: 300 }}>
              {importMethod === 'sheets' ? (
                <GoogleSheetsImporter onData={handleData} T={T} />
              ) : (
                <CsvImporter key={importMethod} onData={handleData} T={T} mode={importMethod} />
              )}
            </div>
          </div>
        )}

        {!hasData && (
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: '16px 20px', fontSize: 12, color: T.textMuted, lineHeight: 1.8 }}>
            <div style={{ color: T.textLabel, marginBottom: 10, fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase' }}>How it works</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              {[
                ['📥 Import your data', 'CSV/TSV or public Google Sheet — from any tracker, spreadsheet, or custom source.'],
                ['🗂 Map your columns', 'Tell us which columns are date, calories, and weight. We auto-detect where possible.'],
                ['📈 Regression, not averages', 'We fit a line through all weight data to extract the true trend, then back-calculate real maintenance calories.'],
                ['🎯 Four chart views', 'Weight trend, TDEE drift, MA cloud, and calorie-vs-weight scatter — each showing a different angle on your data.'],
              ].map(([title, desc]) => (
                <div key={title}>
                  <div style={{ color: T.textLabel, marginBottom: 4 }}>{title}</div>
                  <div style={{ color: T.textFaint }}>{desc}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, color: T.textFaint, borderTop: `1px solid ${T.borderSubtle}`, paddingTop: 12 }}>
              <strong style={{ color: T.textMuted }}>Your data stays private.</strong> Everything runs locally in your browser — nothing is uploaded to any server.
            </div>
          </div>
        )}

        {result && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div style={{ flex: 1, height: 1, background: T.border }} />
              <div style={{ fontSize: 11, letterSpacing: '.15em', color: T.textMuted, textTransform: 'uppercase', fontFamily: FONT_MONO, whiteSpace: 'nowrap' }}>Summary</div>
              <div style={{ flex: 1, height: 1, background: T.border }} />
            </div>

            {(() => {
              const BLUE = T.blue;
              const GREEN = T.green;
              const fullWeightLost = entries[entries.length - 1].wt - entries[0].wt;
              const recentWeightLost = recentEntries.length >= 2 ? recentEntries[recentEntries.length - 1].wt - recentEntries[0].wt : null;

              const widget = (label, value, valueUnit, sub, accent) => (
                <div style={CARD_STYLE(accent, false, T)}>
                  <div style={{ fontSize: 11, letterSpacing: '.08em', color: T.textMuted, textTransform: 'uppercase', marginBottom: 4, fontWeight: 700 }}>{label}</div>
                  <div style={{ fontSize: 26, fontFamily: FONT_NUMERIC, fontWeight: 900, color: accent, lineHeight: 1.2 }}>
                    {value ?? '—'} <span style={{ fontSize: 13, fontWeight: 400, color: T.textMuted }}>{value != null ? valueUnit : ''}</span>
                  </div>
                  {sub && <div style={{ fontSize: 12, color: T.textMuted, marginTop: 3, opacity: 0.6 }}>{sub}</div>}
                </div>
              );

              const tdeeWidget = (value, ci, accent) => (
                <div style={CARD_STYLE(accent, false, T)}>
                  <div style={{ fontSize: 11, letterSpacing: '.08em', color: T.textMuted, textTransform: 'uppercase', marginBottom: 4, fontWeight: 700 }}>TDEE</div>
                  <div style={{ fontSize: 26, fontFamily: FONT_NUMERIC, fontWeight: 900, color: accent, letterSpacing: '.02em', lineHeight: 1.2 }}>
                    {formatThousands(value, unit)} <span style={{ fontSize: 13, fontWeight: 400, color: T.textMuted }}>kcal</span>
                  </div>
                  <div style={{ fontSize: 12, color: T.textMuted, marginTop: 3, opacity: 0.6 }}>±{formatThousands(ci, unit)} kcal (95% CI)</div>
                </div>
              );

              return (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr', gap: 12, marginBottom: 20 }}>
                    <div style={CARD_STYLE(BLUE, true, T)}>
                      {(() => {
                        const fullDays = entries.length;
                        const fullWeeksExact = fullDays / 7;
                        const fullWeeksRounded = Math.round(fullWeeksExact * 10) / 10;
                        const fullWeeksLabel = Number.isInteger(fullWeeksExact) ? `${fullWeeksExact}w` : `±${fullWeeksRounded}w`;
                        return (
                          <div style={{ fontSize: 11, letterSpacing: '.1em', color: T.textMuted, textTransform: 'uppercase', marginBottom: 10 }}>
                            FULL PERIOD · {fullDays} days · {fullWeeksLabel}
                          </div>
                        );
                      })()}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                        {tdeeWidget(result.tdee, result.tdeeCI95, BLUE)}
                        {widget('Avg. intake', formatThousands(result.avgCal, unit), 'kcal', null, BLUE)}
                        {widget('Avg. deficit', formatThousands(result.tdee - result.avgCal, unit), 'kcal', null, BLUE)}
                        {widget(
                          'Total lost',
                          fullWeightLost !== 0
                            ? `${fullWeightLost > 0 ? '+' : ''}${formatDecimal(fullWeightLost, 1, unit)}`
                            : '0',
                          unit,
                          fullWeightLost < 0 ? 'lost' : fullWeightLost > 0 ? 'gained' : 'no change',
                          BLUE,
                        )}
                        {widget(
                          'Weight trend',
                          `${result.weightChangePerDay > 0 ? '+' : ''}${formatDecimal(result.weightChangePerDay * 7, 2, unit)}`,
                          `${unit}/wk`,
                          `${formatDecimal(result.weightChangePerDay * 30, 2, unit)} ${unit}/mo`,
                          BLUE,
                        )}
                        {widget(
                          'Hourly burn',
                          Math.round(result.tdee / 24),
                          'kcal/h',
                          'average per hour',
                          BLUE,
                        )}
                      </div>
                    </div>

                    <div style={CARD_STYLE(GREEN, true, T)}>
                      <div style={{ fontSize: 11, letterSpacing: '.1em', color: T.textMuted, textTransform: 'uppercase', marginBottom: 10 }}>
                        SELECTED PERIOD · {recentWeeks}w · {recentEntries.length} days
                      </div>
                      {recentResult ? (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                          {tdeeWidget(recentResult.tdee, recentResult.tdeeCI95, GREEN)}
                          {widget('Avg. intake', formatThousands(recentResult.avgCal, unit), 'kcal', null, GREEN)}
                          {widget('Avg. deficit', formatThousands(recentResult.tdee - recentResult.avgCal, unit), 'kcal', null, GREEN)}
                          {widget(
                            'Total lost',
                            recentWeightLost !== 0
                              ? `${recentWeightLost > 0 ? '+' : ''}${formatDecimal(recentWeightLost, 1, unit)}`
                              : '0',
                            unit,
                            recentWeightLost != null ? (recentWeightLost < 0 ? 'lost' : recentWeightLost > 0 ? 'gained' : 'no change') : '',
                            GREEN,
                          )}
                          {widget(
                            'Weight trend',
                            `${recentResult.weightChangePerDay > 0 ? '+' : ''}${formatDecimal(recentResult.weightChangePerDay * 7, 2, unit)}`,
                            `${unit}/wk`,
                            `${formatDecimal(recentResult.weightChangePerDay * 30, 2, unit)} ${unit}/mo`,
                            GREEN,
                          )}
                          {widget(
                            'Hourly burn',
                            Math.round(recentResult.tdee / 24),
                            'kcal/h',
                            'average per hour',
                            GREEN,
                          )}
                        </div>
                      ) : (
                        <div style={{ fontSize: 13, color: T.textMuted, marginTop: 8 }}>not enough data for this window</div>
                      )}
                    </div>

                    <div style={CARD_STYLE(GREEN, true, T)}>
                      <div style={{ fontSize: 11, letterSpacing: '.1em', color: T.textMuted, textTransform: 'uppercase', marginBottom: 10 }}>Window selector</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {[4, 6, 8, 10].map(w => (
                          <button key={w} onClick={() => { setRecentWeeks(w); setWindowMode('preset'); }} style={{
                            background: windowMode === 'preset' && recentWeeks === w ? T.btnActive : 'none',
                            border: `1px solid ${windowMode === 'preset' && recentWeeks === w ? GREEN : T.btnBorder}`,
                            color: windowMode === 'preset' && recentWeeks === w ? GREEN : T.textMuted,
                            padding: '6px 8px', borderRadius: 3, cursor: 'pointer', fontFamily: FONT_MONO, fontSize: 10,
                            whiteSpace: 'nowrap',
                          }}>{w}w</button>
                        ))}
                        <div style={{ display: 'flex', gap: 2 }}>
                          <button onClick={() => { setCustomWeeks(w => Math.max(2, w - 1)); setRecentWeeks(w => Math.max(2, w - 1)); setWindowMode('custom'); }} style={{
                            background: windowMode === 'custom' ? T.btnActive : 'none',
                            border: `1px solid ${windowMode === 'custom' ? GREEN : T.btnBorder}`,
                            color: windowMode === 'custom' ? GREEN : T.textMuted,
                            flex: 1, padding: '4px 4px', borderRadius: 3, cursor: 'pointer', fontFamily: FONT_MONO, fontSize: 10,
                          }}>−</button>
                          <button onClick={() => { setRecentWeeks(customWeeks); setWindowMode('custom'); }} style={{
                            background: windowMode === 'custom' ? T.btnActive : 'none',
                            border: `1px solid ${windowMode === 'custom' ? GREEN : T.btnBorder}`,
                            color: windowMode === 'custom' ? GREEN : T.textMuted,
                            flex: 1.2, padding: '4px 4px', borderRadius: 3, cursor: 'pointer', fontFamily: FONT_MONO, fontSize: 10,
                            whiteSpace: 'nowrap',
                          }}>{customWeeks}w</button>
                          <button onClick={() => { setCustomWeeks(w => Math.min(52, w + 1)); setRecentWeeks(w => Math.min(52, w + 1)); setWindowMode('custom'); }} style={{
                            background: windowMode === 'custom' ? T.btnActive : 'none',
                            border: `1px solid ${windowMode === 'custom' ? GREEN : T.btnBorder}`,
                            color: windowMode === 'custom' ? GREEN : T.textMuted,
                            flex: 1, padding: '4px 4px', borderRadius: 3, cursor: 'pointer', fontFamily: FONT_MONO, fontSize: 10,
                          }}>+</button>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              );
            })()}

            {/* ── Analysis section ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div style={{ flex: 1, height: 1, background: T.border }} />
              <div style={{ fontSize: 11, letterSpacing: '.15em', color: T.textMuted, textTransform: 'uppercase', fontFamily: FONT_MONO, whiteSpace: 'nowrap' }}>Analysis</div>
              <div style={{ flex: 1, height: 1, background: T.border }} />
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              {TABS.map(([id, label]) => (
                <button key={id} style={TAB_STYLE(tab === id, T)} onClick={() => setTab(id)}>{label}</button>
              ))}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
                {tab !== 'intake' && <DateToggle showDates={showDates} onChange={setShowDates} T={T} />}
                <button
                  onClick={() => setExpandedChart(tab)}
                  style={{ background: 'none', border: `1px solid ${T.btnBorder}`, color: T.textMuted, padding: '5px 10px', borderRadius: 4, cursor: 'pointer', fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '.06em' }}
                >⛶ expand</button>
                <button
                  onClick={takeSnapshot}
                  disabled={snapshotting}
                  style={{ background: 'none', border: `1px solid ${T.btnBorder}`, color: T.textMuted, padding: '5px 10px', borderRadius: 4, cursor: snapshotting ? 'wait' : 'pointer', fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '.06em', opacity: snapshotting ? 0.5 : 1 }}
                >📸 {snapshotting ? 'Capturing…' : 'Snapshot'}</button>
              </div>
            </div>

            <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: '16px 8px 12px' }}>
              {renderChart(tab, inlineHeights[tab], false)}
            </div>

            {/* ── Body Composition Projections section ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 24, marginBottom: 16 }}>
              <div style={{ flex: 1, height: 1, background: T.border }} />
              <div style={{ fontSize: 11, letterSpacing: '.15em', color: T.textMuted, textTransform: 'uppercase', fontFamily: FONT_MONO, whiteSpace: 'nowrap' }}>Body Composition Projections</div>
              <div style={{ flex: 1, height: 1, background: T.border }} />
            </div>
            <BfProjections entries={entries} result={result} recentResult={recentResult} recentWeeks={recentWeeks} unit={unit} T={T} />

            <div style={{ marginTop: 4, fontSize: 11, color: T.textFaint, lineHeight: 1.7 }}>
              Method: linear regression on all weight datapoints → TDEE = avg calories − (slope × {unit === 'kg' ? '7,700' : '3,500'} kcal/{unit}).
              MA cloud: 7-day and 21-day simple moving averages. Calorie scatter: next-day weight change vs intake; zero-crossing = independent TDEE estimate.
            </div>
          </>
        )}
      </div>

      {/* Hidden snapshot container — renders all charts for capture */}
      {snapshotting && result && (
        <div ref={snapshotRef} style={{
          position: 'fixed', left: '-9999px', top: 0, zIndex: -1,
          width: 1200, background: T.bg, padding: '32px 24px',
          fontFamily: FONT_MONO, color: T.text,
        }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 24, fontWeight: 800, color: T.text }}>TDEE Analyzer — Snapshot</div>
            <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>{new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} · {entries.length} days · TDEE {formatThousands(result.tdee, unit)} kcal</div>
          </div>
          {TABS.map(([id]) => (
            <div key={id} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: '16px 8px 12px', marginBottom: 16 }}>
              {renderChart(id, snapshotHeight, true)}
            </div>
          ))}
        </div>
      )}

      {/* Fullscreen modal */}
      {expandedChart && result && (
        <div onClick={() => setExpandedChart(null)}
          style={{ position: 'fixed', inset: 0, background: T.overlay, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 12, padding: '24px 16px 20px', width: '100%', maxWidth: 1300, maxHeight: '92vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20, gap: 8, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {TABS.map(([id, label]) => (
                  <button key={id} style={{ ...TAB_STYLE(expandedChart === id, T), fontSize: 10 }} onClick={() => setExpandedChart(id)}>{label}</button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginLeft: 'auto' }}>
                {expandedChart !== 'intake' && <DateToggle showDates={showDates} onChange={setShowDates} T={T} />}
                <button onClick={() => setExpandedChart(null)}
                  style={{ background: 'none', border: `1px solid ${T.btnBorder}`, color: T.textLabel, padding: '5px 12px', borderRadius: 4, cursor: 'pointer', fontFamily: FONT_MONO, fontSize: 11 }}
                >✕ close</button>
              </div>
            </div>
            {renderChart(expandedChart, modalHeights[expandedChart], true)}
          </div>
        </div>
      )}
    </div>
  );
}
