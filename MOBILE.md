# Mobilná verzia

## Chyba „Backend nedostupný“

Táto chyba znamená, že aplikácia nevie dosiahnuť backend na zadanej URL. Bežné príčiny:

1. **Neúplná alebo stará ngrok URL**  
   Ngrok mení URL pri každom spustení. Ak máš v aplikácii uloženú starú URL (napr. `https://....ngrok-free.` bez `.dev`), ulož znova **celú** novú URL z ngrok (vrátane `.dev` alebo `.app`).  
   Ak ngrok nebeží, nepoužívaj ngrok URL – na rovnakej Wi‑Fi použi IP PC (pozri nižšie).

2. **Backend nebeží na PC**  
   Na PC musí bežať server: `npm start` v priečinku projektu. Port musí byť vo firewalli povolený (typicky 3201 alebo 3001).

3. **Nesprávna URL**  
   Na **fyzickom mobile** v rovnakej Wi‑Fi: zadaj `http://<IP_tvojej_PC>:<PORT>`, napr. `http://192.168.1.120:3201`.  
   Na **emulátore**: `http://10.0.2.2:3201`.

## Odporúčaný spôsob (vstupná stránka v tomto backende)

1. Na PC spusti backend: `npm start` (alebo cez `START_DESKTOP_APP.bat`).
2. Na mobile v prehliadači otvor: `http://<IP_PC>:3201/mobile`  
   (napr. `http://192.168.1.120:3201/mobile`).
3. Do poľa **Backend URL** zadaj tú istú adresu: `http://<IP_PC>:3201`.
4. Klikni **Uložiť URL** – ak je backend dostupný, uvidíš „Backend je dostupný“.
5. Klikni **Otvoriť appku** – otvorí sa hlavná aplikácia.
6. Ak chceš mať „ikonku na ploche“, v mobile v prehliadači zvoľ **Pridať na začiatok obrazovky** / **Add to Home screen**. Otvorí sa potom tá istá stránka; prvý krát môžeš znova nastaviť URL.

Server teraz počúva na `0.0.0.0`, takže je dostupný z LAN (IP PC) aj cez ngrok, ak ho máš zapnutý.
