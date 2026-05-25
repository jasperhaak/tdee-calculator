import { useState, useCallback } from 'react';
import Papa from 'papaparse';

// ── Helpers ───────────────────────────────────────────────────────────────────

function tryParseDate(str) {
  if (!str) return null;
  const s = str.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) { const d = new Date(s); return isNaN(d) ? null : d; }
  const euMatch = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (euMatch) { let [, d, m, y] = euMatch; if (y.length === 2) y = '20' + y; const dt = new Date(`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`); return isNaN(dt) ? null : dt; }
  const usMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (usMatch) { const [, m, d, y] = usMatch; const dt = new Date(`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`); return isNaN(dt) ? null : dt; }
  return null;
}

function tryParseNumber(str) {
  if (!str && str !== 0) return NaN;
  const s = String(str).trim();
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) return parseFloat(s.replace(/\./g, '').replace(',', '.'));
  if (/^\d+(,\d+)$/.test(s)) return parseFloat(s.replace(',', '.'));
  return parseFloat(s);
}

function guessRole(header) {
  const h = header.toLowerCase();
  if (/date|dag|datum|day/.test(h)) return 'date';
  if (/cal|kcal|energy|intake|food|eaten/.test(h)) return 'calories';
  if (/weight|wicht|gewicht|kg|lbs|mass/.test(h)) return 'weight';
  return null;
}

function detectRolesFromData(headers, rows) {
  const first = rows[0] || [];
  const roles = {};
  headers.forEach((h, i) => {
    const val = String(first[i] || '').trim();
    if (!roles.date && tryParseDate(val)) { roles.date = i; return; }
    const num = tryParseNumber(val);
    if (!isNaN(num)) {
      if (!roles.calories && num > 500 && num < 10000) { roles.calories = i; return; }
      if (!roles.weight && num > 30 && num < 300) { roles.weight = i; return; }
    }
  });
  return roles;
}

function extractSheetId(url) {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match?.[1] || null;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function GoogleSheetsImporter({ onData, T }) {
  const [step, setStep]         = useState('url');
  const [sheetUrl, setSheetUrl] = useState('');
  const [sheets, setSheets]     = useState([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [headers, setHeaders]   = useState([]);
  const [data, setData]         = useState([]);
  const [roles, setRoles]       = useState({});
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const STYLE = {
    label: { fontSize: 11, color: T.textLabel, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 4, display: 'block' },
    input: {
      background: T.inputBg, border: `1px solid ${T.border}`, borderRadius: 4,
      color: T.text, padding: '8px 10px', fontFamily: 'inherit', fontSize: 12,
      width: '100%', outline: 'none', boxSizing: 'border-box',
    },
    select: {
      background: T.inputBg, border: `1px solid ${T.border}`, borderRadius: 4,
      color: T.text, padding: '5px 8px', fontFamily: 'inherit', fontSize: 12,
      width: '100%', outline: 'none', cursor: 'pointer',
    },
    btn: (active) => ({
      background: active ? T.btnActive : 'none',
      border: `1px solid ${active ? T.blue : T.btnBorder}`,
      color: active ? T.blueSoft : T.textLabel,
      padding: '6px 14px', borderRadius: 4, cursor: 'pointer',
      fontFamily: 'inherit', fontSize: 11, letterSpacing: '.08em',
    }),
    error: { fontSize: 11, color: T.error, marginTop: 4 },
  };

  const handleFetchSheets = useCallback(async () => {
    setError(''); setLoading(true);
    try {
      const sheetId = extractSheetId(sheetUrl);
      if (!sheetId) throw new Error('Invalid Google Sheets URL. Please paste the full sharing link.');
      const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
      const response = await fetch(csvUrl);
      if (!response.ok) throw new Error('Could not fetch sheet. Make sure it\'s publicly shared.');
      const csv = await response.text();
      Papa.parse(csv, {
        header: false, skipEmptyLines: true,
        complete: (results) => {
          if (!results.data.length) throw new Error('Sheet appears to be empty');
          const [headerRow, ...dataRows] = results.data;
          setHeaders(headerRow); setData(dataRows);
          const detected = {};
          headerRow.forEach((h, i) => { const role = guessRole(h); if (role) detected[i] = role; });
          if (!detected.date || !detected.calories || !detected.weight) {
            const fromData = detectRolesFromData(headerRow, dataRows);
            Object.assign(detected, fromData);
          }
          setRoles(detected); setSheets([{ name: 'Sheet 1', id: sheetId }]); setActiveSheet(0); setStep('map');
        },
      });
    } catch (err) { setError(err.message || 'Failed to fetch sheet'); } finally { setLoading(false); }
  }, [sheetUrl]);

  const handleRoleChange = useCallback((colIndex, role) => {
    setRoles((prev) => ({ ...prev, [colIndex]: role || undefined }));
  }, []);

  const handleImport = useCallback(() => {
    const dateCol = Object.entries(roles).find(([_, r]) => r === 'date')?.[0];
    const caloriesCol = Object.entries(roles).find(([_, r]) => r === 'calories')?.[0];
    const weightCol = Object.entries(roles).find(([_, r]) => r === 'weight')?.[0];
    if (!dateCol || !caloriesCol || !weightCol) { setError('Please map all three required columns: date, calories, and weight'); return; }
    const entries = [], parseErrors = [];
    data.forEach((row, i) => {
      const dateStr = String(row[dateCol] ?? '').trim(), calStr = String(row[caloriesCol] ?? '').trim(), wtStr = String(row[weightCol] ?? '').trim();
      const date = tryParseDate(dateStr), cal = tryParseNumber(calStr), wt = tryParseNumber(wtStr);
      if (!date) { parseErrors.push(`Row ${i + 2}: unrecognised date "${dateStr}"`); return; }
      if (isNaN(cal) || cal <= 0) { parseErrors.push(`Row ${i + 2}: invalid calories "${calStr}"`); return; }
      if (isNaN(wt) || wt <= 0) { parseErrors.push(`Row ${i + 2}: invalid weight "${wtStr}"`); return; }
      entries.push({ date, dayNum: Math.floor(date.getTime() / 86400000), cal, wt, label: dateStr });
    });
    if (parseErrors.length > 5) { setError([...parseErrors.slice(0, 5), `…and ${parseErrors.length - 5} more errors. Check your column mapping.`].join('\n')); return; }
    if (parseErrors.length) { setError(parseErrors.join('\n')); return; }
    if (entries.length < 5) { setError('Need at least 5 valid rows to calculate. Currently have ' + entries.length + '.'); return; }
    entries.sort((a, b) => a.dayNum - b.dayNum);
    const d0 = entries[0].dayNum;
    entries.forEach(e => { e.relDay = e.dayNum - d0; });
    onData(entries); setStep('done');
  }, [data, roles, onData]);

  const handleReset = useCallback(() => {
    setStep('url'); setSheetUrl(''); setHeaders([]); setData([]); setRoles({}); setError(''); setSheets([]);
  }, []);

  if (step === 'url') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={STYLE.label}>Google Sheets Link</label>
          <input type="text" placeholder="https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit..."
            value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} style={STYLE.input} />
          <div style={{ fontSize: 10, color: T.textFaint, marginTop: 6 }}>
            ⓘ Share your sheet publicly (anyone with link can view), then paste the link above.
          </div>
        </div>
        <button className="import-action-btn" onClick={handleFetchSheets} disabled={!sheetUrl.trim() || loading}
          style={{ ...STYLE.btn(false), opacity: loading ? 0.6 : 1, cursor: loading ? 'wait' : 'pointer' }}>
          {loading ? 'Fetching...' : 'Load Sheet'}
        </button>
        {error && <div style={STYLE.error}>⚠ {error}</div>}
      </div>
    );
  }

  if (step === 'map') {
    const missingRoles = ['date', 'calories', 'weight'].filter(r => !Object.values(roles).includes(r));
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={STYLE.label}>Column Mapping</label>
          <div style={{ fontSize: 12, color: T.textLabel, marginBottom: 8 }}>
            Found {headers.length} columns. Map them to the required fields:
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {headers.map((h, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ flex: 1, fontSize: 12, color: T.text, wordBreak: 'break-word' }}>{h}</div>
                <select value={roles[i] || ''} onChange={(e) => handleRoleChange(i, e.target.value)}
                  style={{ ...STYLE.select, flex: 1, minWidth: 120 }}>
                  <option value="">— Skip —</option>
                  <option value="date">Date</option>
                  <option value="calories">Calories</option>
                  <option value="weight">Weight</option>
                </select>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleReset} style={STYLE.btn(false)}>Back</button>
          <button onClick={handleImport} disabled={missingRoles.length > 0}
            style={{ ...STYLE.btn(missingRoles.length === 0), flex: 1, opacity: missingRoles.length > 0 ? 0.5 : 1, cursor: missingRoles.length > 0 ? 'not-allowed' : 'pointer' }}>
            Import Data
          </button>
        </div>
        {missingRoles.length > 0 && <div style={STYLE.error}>⚠ Missing: {missingRoles.join(', ')}</div>}
        {error && <div style={STYLE.error}>⚠ {error}</div>}
      </div>
    );
  }

  if (step === 'done') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'center' }}>
        <div style={{ fontSize: 14, color: T.blueSoft }}>✓ Data imported successfully!</div>
        <button onClick={handleReset} style={STYLE.btn(true)}>Import Another Sheet</button>
      </div>
    );
  }

  return null;
}