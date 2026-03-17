# Ako funguje spúšťanie: prehliadač vs. ikona na ploche

## Kde sa robia úpravy kódu

Všetky zmeny sú v **zdrojovom kóde** v priečinku projektu:

- `c:\nike-backend-fix\src\server.js` – backend, validácia, API
- `c:\nike-backend-fix\src\scrapers\nike.js` – Nike parser, detekcia športu
- `c:\nike-backend-fix\public\app.js` – frontend (UI)

Keď niečo meníme tu, platí to len pre **spustenie z tohto priečinka**.

---

## Prehliadač (funguje správne)

1. Spustíš server z projektu: `npm start` alebo `node src/server.js` (v `c:\nike-backend-fix`).
2. V prehliadači otvoríš napr. `http://localhost:3201`.
3. Backend beží priamo z `src/server.js` v projekte = **vždy aktuálny kód** (vrátane opravy „unknown sport“).

---

## Ikonka na ploche (môže ísť starý kód)

Existujú dva spôsoby, ako môže ísť „desktop“ aplikácia:

### A) Shortcut spúšťa **inštalovanú** aplikáciu (NSIS z `dist-desktop`)

- Ikonka môže smerovať na program nainštalovaný z inštalátora (napr. „Nike Tipsport Comparator“).
- Ten program beží z **zabalenej kópie** kódu (súbor `app.asar` v inštalačnom priečinku).
- Ta kópia bola vytvorená v čase **posledného buildu** (`npm run desktop:build`).
- Ak si build robil pred opravou „unknown sport“, v inštalovanej verzii je stále **starý kód** → chyba „unknown sport for Partizan Belehrad vs BC Dubai“ sa stále zobrazí.

**Riešenie:** znova zostaviť inštalátor a preinštalovať:

```bat
cd c:\nike-backend-fix
BUILD_DESKTOP_INSTALLER.bat
```

Potom nainštalovať nový inštalátor z `dist-desktop`. Nová ikonka bude používať už opravený kód.

### B) Shortcut spúšťa aplikáciu **z projektu** (odporúčané)

- Ikonka by mala spúšťať napr. `START_DESKTOP_APP.bat` alebo `npm run desktop` s pracovným priečinkom **projekt** (`c:\nike-backend-fix`).
- Electron potom spustí backend z `c:\nike-backend-fix\src\server.js` = **vždy aktuálny kód**, rovnaký ako v prehliadači.

**Ako nastaviť správnu ikonku:**

1. Pravý klik na ploche → Nový → Zástupca.
2. Ako položku zadať napr.:
   - `c:\nike-backend-fix\START_DESKTOP_APP.bat`
   - alebo: `cmd.exe /c "cd /d c:\nike-backend-fix && npm run desktop"`
3. Pomenovať napr. „Nike Backend (dev)“ a dokončiť.
4. Táto ikonka vždy používa kód z `c:\nike-backend-fix` – po úpravách nemusíš nič inštalovať.

---

## Zhrnutie

| Spustenie              | Kód backendu                    | Po oprave v projekte      |
|------------------------|----------------------------------|----------------------------|
| Prehliadač (localhost) | Z projektu (`src/server.js`)     | Funguje hneď               |
| Ikonka → projekt (B)   | Z projektu                      | Funguje hneď               |
| Ikonka → inštalátor (A)| Zo zabalenej kópie (app.asar)   | Treba znova build + inštaláciu |

Chyba „unknown sport for Partizan Belehrad vs BC Dubai“ pri spustení cez ikonku znamená, že ikonka beží **inštalovanú (starú)** verziu. Buď prehoď shortcut na (B), alebo urob nový build a preinštaluj.
