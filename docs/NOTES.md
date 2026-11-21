# Cebulator — opis projektu, cel i architektura

Stan: 2026-11-22. MVP-probe działa end-to-end w GitHub Copilot App.

## Co chcemy osiągnąć

Oszczędzanie tokenów drogiego modelu w sesji IDE (tu, w VS Code) przez
delegację ciężkich zadań na kanał z nieograniczoną pulą tokenów
(Copilot w przeglądarce / aplikacja desktopowa).

Zasada podziału:

- ciężkie wejście / małe wyjście (analiza dużego fragmentu kodu, streszczanie,
  porównanie kilka alternatyw, brainstorm) => delegujemy do taniego kanału
- edycje plików, terminal, testy, iteracyjne poprawki => zostają tu (tanie
  narzędzia lokalne, model płacalny działa)

Efekt: do drogiego modelu wraca tylko rezultat (kilkaset tokenów
zamiast dziesiątek tysięcy za samo wejście).

## Co już zrobione

1. Repo, licencja Apache 2.0, publikacja na github.com/Pawe1/Cebulator.
2. `probe.mjs` — minimalny serwer MCP (transport stdio, Node) z narzędziem
   `cebulator_ping`.
3. Smoke test lokalny (`test/smoke.mjs`, `npm run smoke`) — zielony.
4. Weryfikacja w produkcji: GitHub Copilot App (desktop, okienkowa) przyjęła
   serwer lokalny z `~/.copilot/mcp-config.json`, agent wywołał
   `cebulator_ping`, odpowiedź `cebulator odbiera: desk-app-works`.
   Droga klient -> MCP -> Node -> odpowiedź działa.
5. Kill switch: `state/switch.txt` (on/off, domyślnie off) — będzie bramką
   narzędzi produkcyjnych: off = twardo nic się nie deleguje.

## Architektura

Jeden lokalny serwer MCP (stdio, Node), rejestrowany w dowolnym kliencie,
który wspiera MCP:

- GitHub Copilot App (desktop): `~/.copilot/mcp-config.json` (globalnie)
  albo `.mcp.json` / `.github/mcp.json` (per projekt)
- VS Code: `.vscode/mcp.json`
- potencjalnie: Copilot CLI, inne klienty

```
[klient z wsparciem MCP]
   GitHub Copilot App / VS Code / CLI
        |
        |  stdio (klient sam startuje i trzyma proces)
        v
┌──────────────────────────────┐
│  cebulator (Node, MCP server)│
│                              │
│  cebulator_ping              │  (diagnostyczne, istnieje)
│  cebulator_delegate(brief)   │  (GŁÓWNE — do zbudowania)
│  cebulator_followup(brief)   │  (wykorzystuje historię sesji — do zbudowania)
│  cebulator_status()          │
│                              │
│  switch: state/switch.txt    │  off = wszystkie narzędzia zwracają
│                              │  "cebulator is off" i niczego nie wywołują
└───────────────┬──────────────┘
                │
                │  Playwright (profile PWA, raz zalogowany
                │  przez człowieka, potem headless)
                v
        [copilot.cloud.microsoft/chat]
        (nieograniczona pula tokenów — ciężka inferencja dzieje się tam)
                │
                v
        wynik (proza / patch jako tekst) => kompaktowo do klienta
```

### Dlaczego taka budowa

- stdio znaczy: klient startuje i zabija serwer sam, nic się nie gubi
  w tle, nie ma stałego procesu do ogarniania (w odróżnieniu od wczesnej
  koncepcji huba z WebSocketem + rozszerzeniem przeglądarki).
- Rozszerzenie przeglądarki odrzucone z MVP: Playwright startowany z Node
  z zewnątrz steruje stroną równie dobrze i używa realnego, zalogowanego
  profilu Chrome (zalogowanie raz ręcznie, potem headless).
- Toggle "w pasku" schodzi na rolę drugoplanową: klienty mają natywne
  włącz/wyłącz serwera; twardy kill switch jest w `state/switch.txt`
  (później: ikona system tray lub rozszerzenie Chrome jako interfejs
  do tego samego pliku).

### Przetwarzanie zadania (cel)

1. Użytkownik mówi klientowi: "deleguj: analizuj X, wydaj w ≤ N punktach".
2. Klient wywołuje `cebulator_delegate(brief)`.
3. Serwer: switch on? => otwiera kartę web Copilocia (Playwright w profilu
   PWA), wkleja brief, czeka na odpowiedź, czyta wynik, zwraca tekst.
4. Klient (agent) waliduje wynik z kontekstem lokalnym (kompilacja / testy)
   i zwraca użytkownikowi.
5. `cebulator_followup(...)` = kontynuacja tej samej konwersacji na tej samej
   karcie (historia zostaje, zero przepisywania kontekstu).

### Konwencja briefu

- brief jest zwarty: agent lokalnie czyta potrzebne pliki (tanie narzędzia)
  i wstawia ich DISTYLAT, nie surowy kod.
- format briefu: CEL + ZAŁĄCZNIKI + KRYTERIUM JAKOŚCI
  (np. "wynik w max 10 punktach, bez kodu, tylko wnioski").

## Kanały — mapa statusów

| Kanał | Status |
|-------|--------|
| A. web Copilot przez Playwright | docelowy, do zbudowania |
| B. GitHub coding agent (issue + @copilot -> PR) | ZAMROŻONY — IT/security wyłączyło agentów w repo (security problems); moduł samodzielny, włączany po odmrożeniu |
| C. bezpośrednie CLI/API (własny model / API key) | odrzucone — koszty tokenów |

## Ograniczenia i ryzyka

- Kanał A to automatyzacja czyjegoś UI przez DOM — kruche selektory;
  wymagany fallback (snapshot karty + status "czeka na człowieka")
  zamiast cichego crasha.
- Automatyzacja zalogowanego konta to szara strefa TOS; zakres: własne
  konto, własne zadania, niska częstotliwość.
- Wynik z czatu to tekst bez gwarancji poprawności — ZAWSZE walidacja
  po stronie klienta (kompilacja / testy / diff lokalnie).
- Długi czas odpowiedzi (kilkanaście sekund do minuty) — narzędzie zwraca
  kompakt status zamiast blokować wieczność (timeout z komunikatem).

## Plan dalszych kroków

1. `cebulator_delegate` + `cebulator_followup` na Playwright (profil PWA,
   zalogowanie manualnie raz), gate od switcha.
2. Fallback DOM: snapshot + status "czeka na człowieka".
3. Test end-to-end: delegacja realnego zadania z aplikacji desktopowej.
4. (opcjonalnie) ikona w tray / rozszerzenie Chrome jako toggle.
5. (zamrożone) kanał B z GitHub API po odmrożeniu przez security.
