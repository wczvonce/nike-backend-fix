Desktop app (Electron)
======================

Ak nechces aplikaciu v beznom prehliadaci, mozes ju spustat ako desktop okno:

1) Dvojklik na `START_DESKTOP_APP.bat`

To:
- spusti backend na porte `3131`,
- otvori natvne okno aplikacie (Electron),
- pri zatvoreni appky ukonci aj backend.

Vytvorenie Windows instalatora (.exe)
------------------------------------

1) Dvojklik na `BUILD_DESKTOP_INSTALLER.bat`
2) Instalator sa vytvori do priecinka `dist-desktop`:
   - `Nike Tipsport Comparator Setup 1.1.0.exe`

================================================================================
  Nike / Flashscore backend – inštalácia a spustenie (Windows)
================================================================================

Účel:
  - škrabanie tipov z Nike Superkurzy (m.nike.sk / www.nike.sk)
  - škrabanie kurzov z Flashscore (vyhľadávanie zápasov, 2-way trhy)
  - REST API pre frontend (napr. Lovable)

Požiadavky:
  - Node.js 18+ (odporúčane LTS)
  - PowerShell alebo CMD

--------------------------------------------------------------------------------
KROK 1 – Inštalácia
--------------------------------------------------------------------------------

V priečinku projektu spustite:

  npm install
  npm run install:browsers

Druhý príkaz nainštaluje prehliadač pre Playwright (Chromium). Bez neho škrabanie nebude fungovať.

--------------------------------------------------------------------------------
KROK 2 – Konfigurácia (voliteľné)
--------------------------------------------------------------------------------

Skopírujte .env.example do .env a upravte podľa potreby:

  copy .env.example .env

Premenné v .env:
  PORT=3001              – port servera
  HEADLESS=true          – true = bez okna, false = zobrazí sa prehliadač
  REQUEST_TIMEOUT_MS=45000 – timeout pre načítanie stránok
  ALLOWED_ORIGIN=*       – CORS (pre frontend)
  STRICT_EXPECTED_SUPERPONUKA=false – false = dynamická Superponuka validácia (odporúčané), true = striktne 4 snapshot zápasy
  FLASHSCORE_ENABLE_NETWORK_FIRST=true – primárne čítanie z network payloadov / direct odds path
  FLASHSCORE_ENABLE_DOM_FALLBACK=true – bezpečný fallback na pôvodné DOM klikacie čítanie
  FLASHSCORE_FAIL_IF_FALLBACK_RATE_ABOVE= – voliteľný prah 0..1; keď je nastavený, QA failne pri vysokej fallback miere

--------------------------------------------------------------------------------
KROK 3 – Spustenie servera
--------------------------------------------------------------------------------

PowerShell / CMD:

  npm start

Alebo s automatickým reštartom pri zmene kódu:

  npm run dev

Server beží na:  http://localhost:3001

--------------------------------------------------------------------------------
KROK 4 – Rýchly test
--------------------------------------------------------------------------------

V prehliadači alebo cez curl / Invoke-WebRequest:

  http://localhost:3001/health

Očakávaná odpoveď:  {"ok":true,"service":"nike-flash-backend",...}

API endpointy:
  GET /api/nike-superkurzy          – Nike Superkurzy (zápasy + kurzy)
  GET /api/flashscore/search?homeTeam=...&awayTeam=...  – vyhľadanie zápasu na Flashscore
  GET /api/flashscore/double-chance?matchUrl=...        – double chance kurzy pre zápas
  GET /api/debug/nike                               – diagnostika Nike parsera (ukladá debug/nike-page.html|txt|png)
  GET /api/debug/flashscore                         – debug párovania Nike -> Flashscore + validácia
  GET /api/debug/compare                            – debug porovnania (ponechané/odmietnuté riadky + validácia)
  GET /api/pipeline/nike-vs-tipsport               – end-to-end pipeline (Nike Superponuka -> Flashscore -> porovnanie s Tipsport)
  GET /api/debug/full-check                         – jeden link na full QA súhrn (PASS/FAIL + všetky hlavné kontroly)
  GET /api/flashscore/market-2way?matchUrl=...&marketType=... – debug parser pre jednotlivé 2-way markety
  GET /api/ui/summary                             – UI súhrn (počty pre lokálny frontend)
  GET /api/ui/final-edges                         – finálne edge riadky (Nike > Tipsport)
  GET /api/ui/control-table                       – kontrolná tabuľka so status/reason
  (matchUrl môže byť relatívna cesta z search, napr. /match/abc, alebo plná URL)

Poznámka k reálnej end-to-end podpore:
  - v produkčnom porovnaní (Nike -> Flashscore/Tipsport -> finálny ranking) sú aktuálne aktívne:
    - double_chance
    - match_winner_2way
    - over_under_2way
    - asian_handicap_2way
    - both_teams_to_score
    - draw_no_bet_2way
  - zámerne vypnuté:
    - team_to_score_yes_no (team-scope ekvivalencia nie je ešte bezpečne zapojená end-to-end)
    - european_handicap_2way (2-way bezpečnosť tabuľky nie je konzistentne dokázaná)

Poznámka k architektúre Flashscore:
  - režim je network-first hybrid:
    1) network_graphql
    2) network_direct_html
    3) dom_fallback
  - fallback je predvolene zapnutý, aby sa nestratilo aktuálne fungujúce pokrytie výstupu

Jednotný normalizovaný model trhu:
  - pozri `src/markets/market-model.js`
  - compare flow vracia:
    - normalizedNikeMarket
    - normalizedTipsportMarket

Live smoke test (len orientačný, nie deterministický dôkaz):
  npm run smoke:live

Plný verifikačný reťazec (zlyhá pri akomkoľvek kritickom probléme):
  npm run verify:all

Lokálny vstavaný frontend:
  http://localhost:3001/

Frontend má presne 2 hlavné tabuľky:
  - Final Edges
  - Control Table

--------------------------------------------------------------------------------
Voliteľný pomocník start.ps1
--------------------------------------------------------------------------------

Môžete použiť skript start.ps1:

  .\start.ps1

Skript skontroluje node, npm a Playwright a spustí server.

--------------------------------------------------------------------------------
Riziká a obmedzenia
--------------------------------------------------------------------------------

- Nike a Flashscore môžu zmeniť HTML; potom bude treba upraviť škrabáky.
- Blokovanie IP / anti-bot: pri veľkom počte požiadaviek môže dôjsť k blokovaniu.
- Kurzy sa berú podľa poradia čísel na stránke; pri zmene rozloženia môže dôjsť k zámene stĺpcov.

================================================================================
