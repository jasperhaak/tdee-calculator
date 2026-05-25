# TDEE Calculator

A regression-based Total Daily Energy Expenditure calculator. Upload your calorie and weight tracking data; get a statistically honest maintenance estimate with confidence intervals and a TDEE drift chart.

**Everything runs in the browser — no data is sent to any server.**

---

## Deploy to Vercel (step by step)

### 1. Put the project on GitHub

Option A — GitHub website:
1. Go to https://github.com/new
2. Name it `tdee-calculator`, keep it private if you prefer, click **Create repository**
3. On the next screen, click **uploading an existing file**
4. Drag the entire contents of this folder in, commit

Option B — terminal (if you have Git installed):
```bash
cd tdee-app
git init
git add .
git commit -m "initial commit"
gh repo create tdee-calculator --private --source=. --push
# (requires GitHub CLI — or push manually after creating the repo on github.com)
```

### 2. Deploy on Vercel

1. Go to https://vercel.com/new
2. Click **Import Git Repository** → select your `tdee-calculator` repo
3. Vercel auto-detects Vite. The settings should be:
   - **Framework preset:** Vite
   - **Build command:** `npm run build`
   - **Output directory:** `dist`
4. Click **Deploy** — done in ~30 seconds
5. Vercel gives you a URL like `tdee-calculator-xyz.vercel.app`

### 3. Custom domain (optional)

In your Vercel project → **Settings → Domains**, add any domain you own.

---

## Run locally

```bash
npm install
npm run dev
```
Opens at http://localhost:5173

---

## Data format

The importer accepts any CSV or TSV file with at least three columns:

| Column   | Examples |
|----------|---------|
| Date     | `2026-01-14`, `14-01-26`, `14/01/2026`, `01/14/2026` |
| Calories | `1902`, `1.902` (European thousands separator), `1,902` |
| Weight   | `82.5`, `82,5` (European decimal comma) |

The importer auto-detects column order and number formats. If it guesses wrong, you can reassign columns manually before importing.

---

## How the maths works

1. **Linear regression** is fitted through all weight measurements → gives the true rate of weight change per day (slope), removing day-to-day water retention noise.
2. **TDEE = avg daily calories − (slope × 7,700 kcal/kg)**
3. **95% confidence interval** is derived from the standard error of the regression slope.
4. **EWA smoothing** (α = 0.15, ~13-day half-life) is applied to weight before computing rolling TDEE estimates, suppressing acute water spikes.
5. **LOWESS** (bandwidth = 0.4) over the EWA-rolling estimates gives the drift trend — showing whether your TDEE has changed over time.

---

## Stack

- React 18 + Vite
- Recharts (charts)
- PapaParse (CSV parsing)
- Zero backend, zero tracking
