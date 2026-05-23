import { useState, useCallback } from 'react';
import Papa from 'papaparse';

// ── Helpers ───────────────────────────────────────────────────────────────────

// Try to parse a date string in many formats → JS Date
function tryParseDate(str) {
  if (!str) return null;
  const s = str.trim();

  // ISO: 2026-01-14
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    return isNaN(d) ? null : d;
  }
  // DD-MM-YY or DD-MM-YYYY (European)
  const euMatch = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (euMatch) {
    let [, d, m, y] = euMatch;
    if (y.length === 2) y = '20' + y;
    const dt = new Date(`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`);
    return isNaN(dt) ? null : dt;
  }
  // MM/DD/YYYY (US)
  const usMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (usMatch) {
    const [, m, d, y] = usMatch;
    const dt = new Date(`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`);
    return isNaN(dt) ? null : dt;
  }
  return null;
}

// Parse a number with either comma or period as decimal separator
function tryParseNumber(str) {
  if (!str && str !== 0) return NaN;
  const s = String(str).trim();
  // European: 1.234,56 or 1.234 (thousands sep = period)
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
    return parseFloat(s.replace(/\./g, '').replace(',', '.'));
  }
  // 1234,56
  if (/^\d+(,\d+)$/.test(s)) return parseFloat(s.replace(',', '.'));
  return parseFloat(s);
}

// Score a column header to guess its role
function guessRole(header) {
  const h = header.toLowerCase();
  if (/date|dag|datum|day/.test(h)) return 'date';
  if (/cal|kcal|energy|intake|food|eaten/.test(h)) return 'calories';
  if (/weight|wicht|gewicht|kg|lbs|mass/.test(h)) return 'weight';
  return null;
}

// Auto-detect roles from first data row when headers are ambiguous
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

// ── Main component ────────────────────────────────────────────────────────────

const STYLE = {
  label: { fontSize: 11, color: '#4a5066', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 4, display: 'block' },
  select: {
    background: '#070910', border: '1px solid #1a1f2e', borderRadius: 4,
    color: '#c9cfe0', padding: '5px 8px', fontFamily: 'inherit', fontSize: 12,
    width: '100%', outline: 'none', cursor: 'pointer',
  },
  btn: (active) => ({
    background: active ? '#1a1f2e' : 'none',
    border: `1px solid ${active ? '#3d7fff' : '#1e2130'}`,
    color: active ? '#7eb3ff' : '#5a607a',
    padding: '6px 14px', borderRadius: 4, cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 11, letterSpacing: '.08em',
  }),
  error: { fontSize: 11, color: '#ff6b6b', marginTop: 4 },
  dropZone: (hover) => ({
    border: `2px dashed ${hover ? '#3d7fff' : '#1e2130'}`,
    borderRadius: 8, padding: '28px 20px', textAlign: 'center',
    background: hover ? '#0d1220' : '#0c0e16',
    cursor: 'pointer', transition: 'all .15s',
  }),
};

export default function CsvImporter({ onData }) {
  const [step, setStep]           = useState('upload'); // upload | map | done
  const [fileName, setFileName]   = useState('');
  const [headers, setHeaders]     = useState([]);
  const [rows, setRows]           = useState([]);
  const [mapping, setMapping]     = useState({ date: '', calories: '', weight: '' });
  const [errors, setErrors]       = useState([]);
  const [dragOver, setDragOver]   = useState(false);
  const [inputMode, setInputMode] = useState('file'); // file | paste
  const [pasteText, setPasteText] = useState('');

  // ── Parse uploaded / pasted CSV ──────────────────────────────────────────
  const processCsv = useCallback((text, name = 'pasted') => {
    const result = Papa.parse(text.trim(), {
      skipEmptyLines: true,
      delimiter: '',      // auto-detect , or ; or tab
    });

    if (result.errors.length && result.data.length < 2) {
      setErrors(['Could not parse file. Make sure it is a CSV or tab-separated text file.']);
      return;
    }

    const data = result.data;
    // Detect if first row is headers (non-numeric first cell) or pure data
    const firstRowIsHeader = isNaN(tryParseNumber(data[0][0])) && !tryParseDate(String(data[0][0]));
    const hdrs = firstRowIsHeader ? data[0].map(String) : data[0].map((_, i) => `Column ${i + 1}`);
    const dataRows = firstRowIsHeader ? data.slice(1) : data;

    setFileName(name);
    setHeaders(hdrs);
    setRows(dataRows);
    setErrors([]);

    // Auto-assign mapping
    const autoRoles = {};
    hdrs.forEach((h, i) => {
      const role = guessRole(h);
      if (role && !autoRoles[role]) autoRoles[role] = String(i);
    });
    // Fall back to data-sniffing if headers gave nothing
    if (!autoRoles.date || !autoRoles.calories || !autoRoles.weight) {
      const detected = detectRolesFromData(hdrs, dataRows);
      if (!autoRoles.date     && detected.date     !== undefined) autoRoles.date     = String(detected.date);
      if (!autoRoles.calories && detected.calories !== undefined) autoRoles.calories = String(detected.calories);
      if (!autoRoles.weight   && detected.weight   !== undefined) autoRoles.weight   = String(detected.weight);
    }

    setMapping({ date: autoRoles.date || '', calories: autoRoles.calories || '', weight: autoRoles.weight || '' });
    setStep('map');
  }, []);

  const handleFile = useCallback((file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => processCsv(e.target.result, file.name);
    reader.readAsText(file);
  }, [processCsv]);

  // ── Convert mapped columns → canonical entries ───────────────────────────
  const applyMapping = useCallback(() => {
    const errs = [];
    const entries = [];
    const di = parseInt(mapping.date);
    const ci = parseInt(mapping.calories);
    const wi = parseInt(mapping.weight);

    rows.forEach((row, i) => {
      const dateVal = String(row[di] ?? '').trim();
      const calVal  = String(row[ci] ?? '').trim();
      const wtVal   = String(row[wi] ?? '').trim();

      const date = tryParseDate(dateVal);
      const cal  = tryParseNumber(calVal);
      const wt   = tryParseNumber(wtVal);

      if (!date) { errs.push(`Row ${i + 2}: unrecognised date "${dateVal}"`); return; }
      if (isNaN(cal) || cal <= 0) { errs.push(`Row ${i + 2}: invalid calories "${calVal}"`); return; }
      if (isNaN(wt)  || wt  <= 0) { errs.push(`Row ${i + 2}: invalid weight "${wtVal}"`);   return; }

      entries.push({
        date,
        dayNum: Math.floor(date.getTime() / 86400000),
        cal,
        wt,
        label: dateVal,
      });
    });

    if (errs.length > 5) {
      setErrors([...errs.slice(0, 5), `…and ${errs.length - 5} more errors. Check your column mapping.`]);
      return;
    }
    if (errs.length) { setErrors(errs); }

    if (entries.length < 5) {
      setErrors(e => [...e, 'Need at least 5 valid rows to calculate.']);
      return;
    }

    entries.sort((a, b) => a.dayNum - b.dayNum);
    const d0 = entries[0].dayNum;
    entries.forEach(e => { e.relDay = e.dayNum - d0; });

    setStep('done');
    onData(entries);
  }, [rows, mapping, onData]);

  // ── Render ────────────────────────────────────────────────────────────────
  if (step === 'done') return null;

  return (
    <div style={{ background: '#0c0e16', border: '1px solid #1a1f2e', borderRadius: 8, padding: 20, marginBottom: 24 }}>

      {/* Mode toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {[['file', '↑ Upload file'], ['paste', '✎ Paste data']].map(([m, label]) => (
          <button key={m} style={STYLE.btn(inputMode === m)} onClick={() => { setInputMode(m); setStep('upload'); setErrors([]); }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Step 1: Upload / Paste ── */}
      {step === 'upload' && inputMode === 'file' && (
        <div
          style={STYLE.dropZone(dragOver)}
          onClick={() => document.getElementById('csv-file-input').click()}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}
        >
          <div style={{ fontSize: 28, marginBottom: 8 }}>📂</div>
          <div style={{ fontSize: 13, color: '#5a607a' }}>Drop a CSV or TSV file here, or <span style={{ color: '#3d7fff', textDecoration: 'underline' }}>browse</span></div>
          <div style={{ fontSize: 11, color: '#2e3244', marginTop: 6 }}>Accepts .csv, .tsv, .txt — any delimiter</div>
          <input id="csv-file-input" type="file" accept=".csv,.tsv,.txt" style={{ display: 'none' }}
            onChange={e => handleFile(e.target.files[0])} />
        </div>
      )}

      {step === 'upload' && inputMode === 'paste' && (
        <div>
          <span style={STYLE.label}>Paste your data (CSV, TSV, or space-separated)</span>
          <textarea
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
            placeholder={"date,calories,weight\n2026-01-14,1902,87.6\n2026-01-15,1844,87.5\n..."}
            style={{ width: '100%', height: 160, background: '#070910', border: '1px solid #1a1f2e', borderRadius: 6, color: '#8891a8', fontSize: 12, padding: '10px 12px', fontFamily: 'inherit', lineHeight: 1.8, outline: 'none', resize: 'vertical' }}
          />
          <button
            style={{ ...STYLE.btn(true), marginTop: 10, padding: '8px 20px' }}
            onClick={() => pasteText.trim() && processCsv(pasteText, 'pasted data')}
          >
            Parse →
          </button>
        </div>
      )}

      {/* ── Step 2: Column mapper ── */}
      {step === 'map' && (
        <div>
          <div style={{ fontSize: 12, color: '#5a607a', marginBottom: 16 }}>
            <span style={{ color: '#7eb3ff' }}>{fileName}</span> — {rows.length} rows detected.
            Map the columns below (we've auto-guessed where possible).
          </div>

          {/* Preview table */}
          <div style={{ overflowX: 'auto', marginBottom: 16 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr>{headers.map((h, i) => (
                  <th key={i} style={{ padding: '4px 10px', borderBottom: '1px solid #1a1f2e', color: '#3a3f52', textAlign: 'left', whiteSpace: 'nowrap' }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {rows.slice(0, 3).map((row, i) => (
                  <tr key={i}>{headers.map((_, j) => (
                    <td key={j} style={{ padding: '3px 10px', borderBottom: '1px solid #0f1117', color: '#5a607a', whiteSpace: 'nowrap' }}>{String(row[j] ?? '')}</td>
                  ))}</tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Dropdowns */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
            {[
              { key: 'date',     label: '📅 Date column',     hint: 'YYYY-MM-DD, DD-MM-YY, etc.' },
              { key: 'calories', label: '🔥 Calories column',  hint: 'Total daily kcal' },
              { key: 'weight',   label: '⚖️ Weight column',    hint: 'Daily body weight' },
            ].map(({ key, label, hint }) => (
              <div key={key}>
                <span style={STYLE.label}>{label}</span>
                <select
                  value={mapping[key]}
                  onChange={e => setMapping(m => ({ ...m, [key]: e.target.value }))}
                  style={STYLE.select}
                >
                  <option value="">— select —</option>
                  {headers.map((h, i) => (
                    <option key={i} value={String(i)}>{h || `Column ${i + 1}`}</option>
                  ))}
                </select>
                <div style={{ fontSize: 10, color: '#2e3244', marginTop: 3 }}>{hint}</div>
              </div>
            ))}
          </div>

          {errors.map((e, i) => <div key={i} style={STYLE.error}>⚠ {e}</div>)}

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button style={{ ...STYLE.btn(true), padding: '8px 20px' }} onClick={applyMapping}
              disabled={!mapping.date || !mapping.calories || !mapping.weight}>
              Apply & Calculate →
            </button>
            <button style={{ ...STYLE.btn(false), padding: '8px 14px' }} onClick={() => { setStep('upload'); setErrors([]); }}>
              ← Back
            </button>
          </div>
        </div>
      )}

      {step === 'upload' && errors.map((e, i) => <div key={i} style={{ ...STYLE.error, marginTop: 8 }}>⚠ {e}</div>)}
    </div>
  );
}
