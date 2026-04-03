# Nike Tipsport Comparator

## O projekte
Express.js backend porovnavajuci kurzy Nike.sk Superkurzy vs Tipsport (cez Flashscore.sk). Playwright scraping, hybrid network-first/DOM-fallback.

## Klucove subory
- `src/server.js` — Express app, pipeline, vsetky endpointy
- `src/scrapers/nike.js` — Nike.sk Superkurzy scraper
- `src/scrapers/flashscore.js` — Flashscore/Tipsport hybrid scraper
- `src/utils/pipeline-logic.js` — Porovnavacia logika, validacia, swap
- `src/markets/handlers.js` — Definicie market typov
- `public/mobile-app.html` — Mobilna PWA (5 tabov)
- `public/app.js` — Desktop frontend

## Dve kopie kodu!
- **DEV**: `C:\Users\Ivlik\.cursor\worktrees\nike-backend-fix\fhr\` (port 3001)
- **PRODUKCIA/MOBIL**: `C:\ProgramData\claude tipsport nike comparator\` (port 3202)
- Po zmene kodu VZDY skopirovat do oboch + rebuildovat Electron (`npm run desktop:build` z fhr)
- Kopirovat do dalsich instancii: ila, otx, rjq, sdt, smt, uje

## Spustanie
```bash
# Mobilna verzia
cd "C:\ProgramData\claude tipsport nike comparator" && npm start  # port 3202
# + ngrok cez desktopovu ikonku "Nike Tipsport MOBIL"

# Dev verzia
cd "C:\Users\Ivlik\.cursor\worktrees\nike-backend-fix\fhr" && npm start  # port 3001

# Desktop Electron
npm run desktop:build  # z fhr adresara, potom instalovat .exe
```

## Po kazdom update kodu
1. Skopirovat zmeny do ProgramData aj fhr
2. Restartovat server (`kill port + npm start`)
3. Ak sa menil server.js/flashscore.js/nike.js — rebuildovat Electron
4. Spustit testy: `node scripts/test-dc-swap-fix.js && node scripts/test-odds-accuracy.js && node scripts/test-pipeline-logic.js`

## Pipeline flow
1. Nike scrape (len section=super_ponuka, max 3-5 zapasov)
2. Flashscore search per zapas (similarity + kickoff bonus)
3. Market scrape: GraphQL → Direct HTML → DOM fallback
4. Porovnanie: Nike sel → mapSelectionForSwap → selectionOdds lookup
5. Filter: len Nike > Tipsport
6. Sort: podla probabilityEdgePp DESC

## Zname problemy a fixy (2026-03-28)
- DC swap: pouziva participantDomOrder namiesto search-level team names
- HDA verification: API participant ordering overena cez DOM — ak inverted, homeId/awayId sa prehodia
- Superkurzy filter: pipeline len super_ponuka, NIE super_sanca
- DNB dedup: 1 riadok per selection (nie 4x z handicap linii)
- Sport detection: handball, volleyball pridane
- DOM trend sipky: arrowUp/arrowDown z SVG ikon

## Testovanie
```bash
node scripts/test-dc-swap-fix.js           # DC swap regression
node scripts/test-odds-accuracy.js         # Michalovce DNB fixture
node scripts/test-flashscore-network-parser.js
node scripts/test-parser-fixtures.js
node scripts/test-pipeline-logic.js
```
