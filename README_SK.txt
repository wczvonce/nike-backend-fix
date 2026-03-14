================================================================================
  Nike / Flashscore backend – inštalácia a spustenie (Windows)
================================================================================

Účel:
  - škrabanie tipov z Nike Superkurzy (m.nike.sk / www.nike.sk)
  - škrabanie kurzov z Flashscore (vyhľadávanie zápasov, double chance kurzy)
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
  STRICT_EXPECTED_SUPERPONUKA=true – true = striktne 4 snapshot zápasy, false = dynamická Superponuka validácia

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
  (matchUrl môže byť relatívna cesta z search, napr. /match/abc, alebo plná URL)

Poznámka k reálnej end-to-end podpore:
  - v produkčnom porovnaní (Nike -> Flashscore/Tipsport -> finálny ranking) sú aktuálne aktívne:
    - double_chance
    - match_winner_2way
  - ostatné 2-way parsery (over_under, asian_handicap, BTTS, draw_no_bet, european_handicap) sú dostupné cez debug endpoint, ale nie sú zapnuté do finálneho compare flow, kým Nike spoľahlivo negeneruje ekvivalentné trhy.

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
