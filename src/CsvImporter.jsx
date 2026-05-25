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

// ── Main component ────────────────────────────────────────────────────────────

export default function CsvImporter({ onData, T, mode }) {
  const [step, setStep]           = useState('upload');
  const [fileName, setFileName]   = useState('');
  const [headers, setHeaders]     = useState([]);
  const [rows, setRows]           = useState([]);
  const [mapping, setMapping]     = useState({ date: '', calories: '', weight: '' });
  const [errors, setErrors]       = useState([]);
  const [dragOver, setDragOver]   = useState(false);
  const [pasteText, setPasteText] = useState('');

  const STYLE = {
    label: { fontSize: 11, color: T.textLabel, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 4, display: 'block' },
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

  const processCsv = useCallback((text, name = 'pasted') => {
    const result = Papa.parse(text.trim(), { skipEmptyLines: true, delimiter: '' });
    if (result.errors.length && result.data.length < 2) { setErrors(['Could not parse file. Make sure it is a CSV or tab-separated text file.']); return; }
    const data = result.data;
    const firstRowIsHeader = isNaN(tryParseNumber(data[0][0])) && !tryParseDate(String(data[0][0]));
    const hdrs = firstRowIsHeader ? data[0].map(String) : data[0].map((_, i) => `Column ${i + 1}`);
    const dataRows = firstRowIsHeader ? data.slice(1) : data;
    setFileName(name); setHeaders(hdrs); setRows(dataRows); setErrors([]);
    const autoRoles = {};
    hdrs.forEach((h, i) => { const role = guessRole(h); if (role && !autoRoles[role]) autoRoles[role] = String(i); });
    if (!autoRoles.date || !autoRoles.calories || !autoRoles.weight) {
      const detected = detectRolesFromData(hdrs, dataRows);
      if (!autoRoles.date && detected.date !== undefined) autoRoles.date = String(detected.date);
      if (!autoRoles.calories && detected.calories !== undefined) autoRoles.calories = String(detected.calories);
      if (!autoRoles.weight && detected.weight !== undefined) autoRoles.weight = String(detected.weight);
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

  const applyMapping = useCallback(() => {
    const errs = [], entries = [];
    const di = parseInt(mapping.date), ci = parseInt(mapping.calories), wi = parseInt(mapping.weight);
    rows.forEach((row, i) => {
      const dateVal = String(row[di] ?? '').trim(), calVal = String(row[ci] ?? '').trim(), wtVal = String(row[wi] ?? '').trim();
      const date = tryParseDate(dateVal), cal = tryParseNumber(calVal), wt = tryParseNumber(wtVal);
      if (!date) { errs.push(`Row ${i + 2}: unrecognised date "${dateVal}"`); return; }
      if (isNaN(cal) || cal <= 0) { errs.push(`Row ${i + 2}: invalid calories "${calVal}"`); return; }
      if (isNaN(wt) || wt <= 0) { errs.push(`Row ${i + 2}: invalid weight "${wtVal}"`); return; }
      entries.push({ date, dayNum: Math.floor(date.getTime() / 86400000), cal, wt, label: dateVal });
    });
    if (errs.length > 5) { setErrors([...errs.slice(0, 5), `…and ${errs.length - 5} more errors. Check your column mapping.`]); return; }
    if (errs.length) { setErrors(errs); }
    if (entries.length < 5) { setErrors(e => [...e, 'Need at least 5 valid rows to calculate.']); return; }
    entries.sort((a, b) => a.dayNum - b.dayNum);
    const d0 = entries[0].dayNum;
    entries.forEach(e => { e.relDay = e.dayNum - d0; });
    setStep('done'); onData(entries);
  }, [rows, mapping, onData]);

  if (step === 'done') return null;

  return (
    <div>
      {step === 'upload' && mode === 'upload' && (
        <div style={{
          border: `2px dashed ${dragOver ? T.blue : T.btnBorder}`, borderRadius: 8, padding: '28px 20px', textAlign: 'center',
          background: dragOver ? T.cardInner : T.bg, cursor: 'pointer', transition: 'all .15s',
        }}
          onClick={() => document.getElementById('csv-file-input').click()}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}
        >
          <div style={{ fontSize: 28, marginBottom: 8 }}>📂</div>
          <div style={{ fontSize: 13, color: T.textLabel }}>Drop a CSV or TSV file here, or <span style={{ color: T.blue, textDecoration: 'underline' }}>browse</span></div>
          <div style={{ fontSize: 11, color: T.textFaint, marginTop: 6 }}>Accepts .csv, .tsv, .txt — any delimiter</div>
          <input id="csv-file-input" type="file" accept=".csv,.tsv,.txt" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
        </div>
      )}

      {step === 'upload' && mode === 'manual' && (
        <div>
          <span style={STYLE.label}>Paste your data (CSV, TSV, or space-separated)</span>
          <textarea value={pasteText} onChange={e => setPasteText(e.target.value)}
            placeholder={"date,calories,weight\n2026-01-14,1902,87.6\n2026-01-15,1844,87.5\n..."}
            style={{ width: '100%', height: 160, background: T.inputBg, border: `1px solid ${T.border}`, borderRadius: 6, color: T.textLabel, fontSize: 12, padding: '10px 12px', fontFamily: 'inherit', lineHeight: 1.8, outline: 'none', resize: 'vertical' }}
          />
          <button className="import-action-btn" style={{ ...STYLE.btn(false), marginTop: 10, padding: '8px 20px' }}
            onClick={() => pasteText.trim() && processCsv(pasteText, 'pasted data')}>Parse →</button>
        </div>
      )}

      {step === 'map' && (
        <div>
          <div style={{ fontSize: 12, color: T.textLabel, marginBottom: 16 }}>
            <span style={{ color: T.blueSoft }}>{fileName}</span> — {rows.length} rows detected. Map the columns below (we've auto-guessed where possible).
          </div>
          <div style={{ overflowX: 'auto', marginBottom: 16 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead><tr>{headers.map((h, i) => (
                <th key={i} style={{ padding: '4px 10px', borderBottom: `1px solid ${T.border}`, color: T.textFaint, textAlign: 'left', whiteSpace: 'nowrap' }}>{h}</th>
              ))}</tr></thead>
              <tbody>{rows.slice(0, 3).map((row, i) => (
                <tr key={i}>{headers.map((_, j) => (
                  <td key={j} style={{ padding: '3px 10px', borderBottom: `1px solid ${T.borderSubtle}`, color: T.textLabel, whiteSpace: 'nowrap' }}>{String(row[j] ?? '')}</td>
                ))}</tr>
              ))}</tbody>
            </table>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
            {[
              { key: 'date', label: '📅 Date column', hint: 'YYYY-MM-DD, DD-MM-YY, etc.' },
              { key: 'calories', label: '🔥 Calories column', hint: 'Total daily kcal' },
              { key: 'weight', label: '⚖️ Weight column', hint: 'Daily body weight' },
            ].map(({ key, label, hint }) => (
              <div key={key}>
                <span style={STYLE.label}>{label}</span>
                <select value={mapping[key]} onChange={e => setMapping(m => ({ ...m, [key]: e.target.value }))} style={STYLE.select}>
                  <option value="">— select —</option>
                  {headers.map((h, i) => (<option key={i} value={String(i)}>{h || `Column ${i + 1}`}</option>))}
                </select>
                <div style={{ fontSize: 10, color: T.textFaint, marginTop: 3 }}>{hint}</div>
              </div>
            ))}
          </div>
          {errors.map((e, i) => <div key={i} style={STYLE.error}>⚠ {e}</div>)}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button style={{ ...STYLE.btn(true), padding: '8px 20px' }} onClick={applyMapping}
              disabled={!mapping.date || !mapping.calories || !mapping.weight}>Apply & Calculate →</button>
            <button style={{ ...STYLE.btn(false), padding: '8px 14px' }} onClick={() => { setStep('upload'); setErrors([]); }}>← Back</button>
          </div>
        </div>
      )}

      {step === 'upload' && errors.map((e, i) => <div key={i} style={{ ...STYLE.error, marginTop: 8 }}>⚠ {e}</div>)}
    </div>
  );
}
