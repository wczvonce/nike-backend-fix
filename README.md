# Nike / Flashscore Scraper Backend

Backend for scraping **Nike Superkurzy** and **Flashscore** odds, with REST API for a frontend (e.g. Lovable).

## Requirements

- **Node.js** 18+ (LTS recommended)
- Windows, macOS, or Linux

## Quick start (Windows – PowerShell)

```powershell
cd c:\nike-backend-fix
npm install
npm run install:browsers
npm start
```

Or use the helper script (installs and starts):

```powershell
.\start.ps1
```

## Configuration

Copy `.env.example` to `.env` and adjust if needed:

- `PORT` – server port (default 3001)
- `HEADLESS` – `true` (no browser window) or `false` (show Chrome)
- `REQUEST_TIMEOUT_MS` – page load timeout (default 45000)
- `ALLOWED_ORIGIN` – CORS origin (e.g. `*` or your frontend URL)
- `STRICT_EXPECTED_SUPERPONUKA` – `true` keeps strict snapshot check for the known 4-match state; `false` allows dynamic Superponuka parsing while keeping parser safety checks

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/api/nike-superkurzy` | Scrape Nike tips (matches + markets) |
| GET | `/api/flashscore/search?homeTeam=...&awayTeam=...` | Search for a match on Flashscore |
| GET | `/api/flashscore/double-chance?matchUrl=...` | Scrape double chance odds for a match |
| GET | `/api/debug/nike` | Nike parser diagnostics + writes debug artifacts to `debug/` |
| GET | `/api/debug/flashscore` | Flashscore matching debug + validation |
| GET | `/api/debug/compare` | Comparison debug (kept/rejected rows + validation) |
| GET | `/api/pipeline/nike-vs-tipsport` | End-to-end pipeline (Nike Superponuka -> Flashscore -> 2-way Nike vs Tipsport ranking) |
| GET | `/api/debug/full-check` | One-link full QA summary (PASS/FAIL + all major checks) |
| GET | `/api/flashscore/market-2way?matchUrl=...&marketType=...` | Debug parser for supported Flashscore 2-way market families |

## Real End-to-End Market Scope

- End-to-end compare (Nike -> Flashscore/Tipsport -> ranked output) is currently enabled for:
  - `double_chance`
  - `match_winner_2way`
- Additional market parsers (`over_under_2way`, `asian_handicap_2way`, `both_teams_to_score`, `draw_no_bet_2way`, `european_handicap_2way`) are available via parser-debug endpoint, but are **not** enabled in final compare until Nike emits those markets with equivalent mapping certainty.

## Tests

Run parsing/normalization tests (no browser):

```powershell
npm test
```

After starting the server:

- **Health:** http://localhost:3001/health  
- **Nike:** http://localhost:3001/api/nike-superkurzy  
- **Slovak README:** see `README_SK.txt`
