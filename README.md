# ActoMind – Your Personal Acting Coach

**Learn your lines. Live your role.**

ActoMind to aplikacja PWA dla aktorów, nauczycieli, uczniów i teatrów amatorskich: trener pamięci, mentor aktorski i wirtualny partner sceniczny. Działa w przeglądarce na telefonie i komputerze, można ją zainstalować i używać offline. Domyślny język interfejsu: polski (dostępny też angielski).

---

## Spis treści
1. [Szybki start](#szybki-start)
2. [Co potrafi aplikacja](#co-potrafi-aplikacja)
3. [Audio Studio i Google Cloud Text-to-Speech](#audio-studio-i-google-cloud-text-to-speech)
4. [Wdrożenie na hostingu](#wdrożenie-na-hostingu)
5. [Prywatność i dane](#prywatność-i-dane)
6. [Testy](#testy)
7. [Struktura projektu](#struktura-projektu)
8. [Ograniczenia przeglądarek](#ograniczenia-przeglądarek)

---

## Szybki start

Wymagania: **Node.js 18.17+** (bez instalowania jakichkolwiek pakietów – projekt nie ma zależności npm).

```powershell
npm start
```

Otwórz <http://localhost:8080>. Przy pierwszym uruchomieniu pojawi się samouczek z przyciskiem „Wczytaj demo” (komedia „Wywiadówka nadzwyczajna” – matka kontra dyrektor szkoły).

Inny port:

```powershell
node server/server.js --port 3000
```

Serwer przy starcie odświeża listę plików do pracy offline (`sw-manifest.js`), więc po każdej zmianie kodu aplikacja pokaże komunikat „Dostępna jest nowa wersja”.

> Bez serwera Node: aplikację można też serwować dowolnym serwerem plików statycznych (zob. [Wdrożenie](#wdrożenie-na-hostingu)). Działa wtedy wszystko poza eksportem plików audio przez Google Cloud.

---

## Co potrafi aplikacja

| Obszar | Funkcje |
|---|---|
| **Import** | wklejanie tekstu, TXT (UTF‑8/UTF‑16/Windows‑1250), DOCX, PDF z warstwą tekstową, ręczne tworzenie, demo, kopia JSON. Wszystko przetwarzane lokalnie. |
| **Rozpoznawanie** | postacie, kwestie, didaskalia (samodzielne i wewnątrz kwestii), narrator, akty, sceny, lista „OSOBY:”. Formaty: `IMIĘ: tekst`, `IMIĘ:` + tekst w kolejnej linii, `IMIĘ (didaskalia):`, `IMIĘ. tekst`, `IMIĘ — tekst`, zapis scenariuszowy (imię wielkimi literami nad kwestią). Oryginalny tekst nigdy nie jest zmieniany. |
| **Edytor struktury** | zmiana typu elementu, przypisanie postaci, zaznaczenie fragmentu i przypisanie go innej postaci, dzielenie, łączenie, zmiana kolejności, nowe postacie, zmiana nazwy, łączenie postaci, kolory, cofanie zmian, podgląd oryginału, ponowne rozpoznanie. |
| **Role i głosy** | jedna lub kilka własnych ról; dla każdej postaci: kolor, głos, tempo, wysokość, głośność, pauzy przed/po. |
| **Panel główny** | scenariusze, ostatnia rola, % opanowania, liczba kwestii / opanowanych / trudnych / do powtórki, czas nauki, ukończone próby, data premiery, plan nauki, „Kontynuuj naukę”. |
| **Czytanie** | forma teatralna, wyróżnienie własnych kwestii, ukrywanie innych postaci / didaskaliów, tylko moje kwestie, czcionka, interlinia, autoprzewijanie, trudne fragmenty, notatki, słowa kluczowe, eksport TXT, druk. |
| **Słuchanie** | odczyt głosami postaci, play/pauza/stop, poprzednia/następna kwestia, powtarzanie kwestii, zapętlenie sceny, tempo, długość przerw, tylko moje kwestie, „partner → ja → czas na powtórzenie”. |
| **Znikające słowa** | 0/25/50/75/90/100% + suwak, deterministyczne (każdy wyższy poziom ukrywa nadzbiór), kliknięcie odsłania słowo i liczy się jako podpowiedź. |
| **Pierwsze litery** | pierwsza litera („N m n p, o c p m.”), pierwsza i ostatnia, pierwsza sylaba (automatycznie + ręczna edycja), dwa znaki, puste miejsca. |
| **Wirtualny partner** | aplikacja gra pozostałe role; rozpoznawanie mowy z automatycznym wykrywaniem końca wypowiedzi; 3 poziomy rygorystyczności; podpowiedź 1/3 słów/całość, powtórz partnera, cofnij próbę, przejdź dalej, scena od początku; komendy głosowe w osobnym trybie (opcjonalnie z prefiksem „komenda”); tryb bez patrzenia na ekran; ocena ręczna bez mikrofonu; wznowienie od ostatniej kwestii. |
| **Analiza wypowiedzi** | Levenshtein na tokenach, bez wielkości liter i interpunkcji, liczby ↔ słowa, kolory: zielony/czerwony/pomarańczowy/niebieski, % zgodności, pominięte słowa, fragmenty do powtórki, ręczna korekta każdego słowa. |
| **Fiszki** | przód: kwestia partnera; tył: moja kwestia z didaskaliami; 4 oceny; monologi → fiszki fragmentów. |
| **Inteligentne powtórki** | SM‑2 z modyfikacjami: poprawność, liczba prób, podpowiedzi, czas do rozpoczęcia odpowiedzi (gdy mierzalny), samoocena, czas od ostatniej powtórki, limit przed premierą. Czytanie nie zwiększa opanowania. |
| **Fragmenty monologów** | automatyczny podział, edycja granic, nauka A, B, A+B, C, A+B+C…, start z losowego miejsca. |
| **Losowe wejścia** | ze wszystkich scen / sceny / tylko trudnych / tylko nieopanowanych. |
| **Układanie tekstu** | pomieszane słowa, fragmenty, luki, właściwy początek, dopasowanie do kwestii partnera, wpisywanie całości, kolejność kwestii. |
| **Premiera już jutro** | sesje 5–90 min dobierane do poziomu opanowania, plan dzień po dniu, sen i poranna powtórka, rozgrzewka, timer bloków. Bez obietnic opanowania roli. |
| **Mentor aktorski** | cel, intencja, emocja, podtekst, słowo kluczowe, gest, ruch, pauza, intonacja, relacja; pytania pomocnicze; szablony; próby z intencjami i nagraniami. Bez udawania AI. |
| **Nagrania** | MediaRecorder, odsłuch, porównanie kolejnych prób, notatki, usuwanie, eksport ZIP – tylko lokalnie. |
| **Próba generalna** | ukryte kwestie, podpowiedzi tylko na żądanie, raport: zgodność, podpowiedzi, problematyczne kwestie, pominięte fragmenty, porównanie z poprzednią próbą, rekomendacje. |
| **Mapa i postępy** | oś kwestii w kolorach statusu (klik = nauka od miejsca), wykres opanowania w czasie, minuty nauki, mapa najtrudniejszych scen. |
| **Motywacja** | XP, poziomy, cel dzienny, serie, osiągnięcia, rekord kwestii bez podpowiedzi – do wyłączenia w Ustawieniach. |
| **Audio Studio** | patrz niżej. |

---

## Audio Studio i Google Cloud Text-to-Speech

Audio Studio przygotowuje **słuchowisko** i **nagranie treningowe z ciszą** na Twoje kwestie.

### Silniki mowy (trzy do wyboru)
| Silnik | Koszt / konto | Eksport MP3/WAV | Offline | Głosy |
|---|---|---|---|---|
| **Piper** (lokalne głosy neuronowe) | za darmo, bez konta | **tak** – generowane w przeglądarce | tak, po jednorazowym pobraniu głosu (~60 MB) | 5 polskich (gosia, darkman, mc_speech, bass, mls_6892), ~40 angielskich, część z wieloma mówcami (do 904) – oficjalny katalog `rhasspy/piper-voices` |
| **Web Speech** (głosy przeglądarki/systemu) | za darmo | **tak, przez nagranie** dźwięku (komputer: Chrome/Edge) | zależnie od głosu | lista z `speechSynthesis.getVoices()`; w Edge darmowe głosy naturalne (Zofia, Marek, Agnieszka…) |
| **Google Cloud TTS** | płatne po darmowym limicie, klucz na serwerze | tak | nie | dziesiątki głosów (Standard/WaveNet/Neural2/Chirp3‑HD) |

* **Piper** działa w Web Workerze (onnxruntime‑web + fonemizer espeak‑ng w WebAssembly, dołączone w `vendor/`). Tekst nie opuszcza urządzenia. Ustawienia na postać: głos, mówca (modele wielomówcowe), tempo, ekspresja, wzmocnienie. Brakujące głosy pobierają się automatycznie przed eksportem.
* **Nagrywanie głosów przeglądarki**: przeglądarki nie udostępniają syntezy jako pliku, więc ActoMind nagrywa to, co jest odtwarzane – Audio Studio → Eksport → „Rozpocznij nagrywanie dźwięku” → wybierz „Cały ekran” i zaznacz „Udostępnij dźwięk systemowy”. Każda kwestia jest nagrywana osobno, przycinana i normalizowana; cisza jest dodawana cyfrowo. Nie działa na telefonach (brak udostępniania ekranu z dźwiękiem) – tam użyj Piper.
* **Automatyczna obsada**: jeden przycisk przypisuje każdej postaci inny głos dopasowany do płci odgadniętej z nazwy roli (MATKA, SEKRETARKA → kobiecy; DYREKTOR → męski); gdy głosów jest za mało, zmienia wysokość/tempo/mówcę.
* **Google Cloud Text-to-Speech** – oficjalne REST API (v1) wywoływane przez backend ActoMind. Klucze nigdy nie trafiają do przeglądarki.

### Cisza na kwestie aktora
`Czas ciszy = czas wypowiedzi × współczynnik (domyślnie 1,5) + dodatkowa pauza (domyślnie 1 s)`
(2 s → 4 s, 4 s → 7 s, 10 s → 16 s, 20 s → 31 s – zweryfikowane w testach).

* Z Google Cloud: kwestia jest syntezowana Twoim głosem, mierzona i zastępowana **cyfrową ciszą** (testy sprawdzają, że próbki są dokładnie zerowe).
* Bez nagrania: oszacowanie z liczby sylab, tempa, przecinków, kropek, wielokropków, pytajników, wykrzykników, myślników i pauz „(pauza)” – oznaczone jako przybliżone.
* Profil tempa z kalibracji („Dostosuj pauzy do mojego tempa”) – przyciski Start/Stop lub automatyczny pomiar mikrofonem (lokalnie).
* Suwak 100–300% z presetami, dodatkowa pauza 0–10 s, ręczna długość dla każdej kwestii.

### Eksport
WAV (zawsze), **MP3** (lamejs w Web Workerze), OGG/Opus (WebCodecs, gdy przeglądarka obsługuje). Warianty: pełne słuchowisko, wersja treningowa, wersja z podpowiedziami, tylko moje kwestie; „Pobierz komplet nagrań do nauki” + opcjonalny ZIP. Zakres: całość, scena, akt, fragment, trudne kwestie z poprzedzającymi wypowiedziami. Każdy fragment jest generowany raz i buforowany (IndexedDB + dysk serwera) – zmiana jednej kwestii lub samej ciszy nie powoduje ponownego generowania pozostałych. Anulowane generowanie można wznowić. Pliki trafiają do **„Moje nagrania”** i działają offline (odtwarzacz z Media Session – sterowanie z ekranu blokady i słuchawek).

### Konfiguracja Google Cloud (ok. 10 minut)
1. W [Google Cloud Console](https://console.cloud.google.com/) utwórz projekt i włącz rozliczenia (billing).
2. Włącz **Cloud Text-to-Speech API** (APIs & Services → Library).
3. Wybierz **jedną** metodę uwierzytelnienia:
   * **Klucz API**: APIs & Services → Credentials → Create credentials → API key, następnie *Restrict key* → tylko „Cloud Text-to-Speech API”.
   * **Konto serwisowe**: IAM → Service Accounts → Create → Keys → Add key → JSON. Plik zapisz poza repozytorium (np. `secrets/`).
4. Skopiuj `.env.example` do `.env` i uzupełnij:
   ```ini
   GOOGLE_TTS_API_KEY=twój-klucz
   # albo
   GOOGLE_APPLICATION_CREDENTIALS=./secrets/actomind-tts.json
   ACTOMIND_ACCESS_CODE=dlugi-losowy-kod
   ```
5. Uruchom `npm start`. W aplikacji: **Ustawienia → Google Cloud** (status, kod dostępu, zgoda), następnie **Audio Studio → Google Cloud TTS → Obsada głosowa** (głosy pobierane z API: żeńskie/męskie, modele Standard/WaveNet/Neural2/Studio/Chirp…).

**Koszty:** Google nalicza opłaty za znaki po przekroczeniu darmowego limitu; ceny zależą od modelu głosu. Studio pokazuje liczbę znaków do syntezy i orientacyjny koszt – sprawdź [aktualny cennik](https://cloud.google.com/text-to-speech/pricing). Fragmenty z pamięci podręcznej są bezpłatne.

**Różnice modeli:** serwer pomija parametry nieobsługiwane przez dany model (np. wysokość głosu w Chirp/Journey/Studio), a jeśli API odrzuci parametr, ponawia żądanie bez niego i zapamiętuje to dla głosu.

**Bez konta Google** wybierz silnik **Piper** – eksport MP3/WAV działa również na GitHub Pages i na telefonie.

**Tryb testowy (dla deweloperów):** `node server/server.js --mock` lub `ACTOMIND_TTS_MOCK=1` – serwer zwraca sygnał testowy (tony) zamiast głosu, aby sprawdzić cały proces eksportu bez konta Google. Aplikacja wyraźnie oznacza ten tryb.

---

## Wdrożenie na hostingu

> PWA (instalacja, Service Worker, mikrofon) wymaga **HTTPS** – poza `localhost`.

### A. Pełna wersja (frontend + backend Google Cloud) – Node.js
Dowolny serwer/VPS/PaaS z Node 18+ (np. Render, Railway, Fly.io, własny VPS):
```powershell
npm start
```
Ustaw zmienne środowiskowe z `.env.example` w panelu hostingu (dla PaaS najwygodniej `GOOGLE_CREDENTIALS_JSON`). Za reverse proxy (Caddy/nginx) z HTTPS. **Ustaw `ACTOMIND_ACCESS_CODE`**, aby nikt obcy nie generował nagrań na Twój koszt. Serwer ma limit żądań na IP i ogranicza rozmiar tekstu.

Przykład nginx:
```nginx
server {
  listen 443 ssl http2;
  server_name actomind.example.com;
  location / { proxy_pass http://127.0.0.1:8080; proxy_set_header Host $host; }
}
```

### B. Docker
```powershell
docker build -t actomind .
```
```powershell
docker run -p 8080:8080 --env-file .env -v actomind-cache:/app/server/.cache actomind
```

### C. Tylko frontend (hosting statyczny: GitHub Pages, Netlify, Cloudflare Pages, Apache…)
1. `npm run build:sw` (aktualizuje listę plików offline i wersję).
2. Opublikuj: `index.html`, `manifest.webmanifest`, `sw.js`, `sw-manifest.js`, katalogi `css/`, `js/`, `vendor/`, `icons/`.
3. Działa nauka, próby, Web Speech, nagrania i import – bez eksportu MP3/WAV przez Google. Aplikacja działa też w podkatalogu (np. `https://user.github.io/ActoMind/`).

### D. Frontend statyczny + backend osobno
Uruchom backend (A) z `ALLOWED_ORIGINS=https://twoja-domena-frontendu`, a w aplikacji wpisz adres backendu w **Ustawienia → Google Cloud → Adres serwera**.

---

## Prywatność i dane
* Scenariusze, postępy, raporty, nagrania mikrofonu i wygenerowane pliki są przechowywane **lokalnie** (IndexedDB), ustawienia w LocalStorage.
* Nic nie jest wysyłane bez wyraźnej zgody: tekst kwestii trafia do Google Cloud TTS dopiero po zgodzie w Audio Studio; przed użyciem mikrofonu i rozpoznawania mowy aplikacja wyjaśnia zasady (Chrome/Edge przetwarzają mowę na serwerach Google/Microsoft).
* Każdy tryb nauki ma alternatywę bez mikrofonu (ocena ręczna, wpisywanie, samoocena).
* Ustawienia → Dane: eksport/import kopii JSON (opcjonalnie z nagraniami), archiwum projektów, usunięcie wszystkich danych, wycofanie zgód. Reset postępów konkretnej roli: ekran scenariusza.

---

## Testy
```powershell
npm test
```
Zestaw (bez zależności) obejmuje m.in.: parser (przykład ze specyfikacji, akty/sceny, didaskalia, formaty zapisu, fałszywe dwukropki, scenariusze demo), pierwsze litery, porównywanie tekstu (Levenshtein, bliskie dopasowania, poziomy rygoru, podpowiedzi, ręczna korekta, liczby), powtórki rozłożone w czasie, fragmenty monologów, wzór ciszy, plan premiery, budowanie programu audio i kolejność dialogów, renderowanie WAV z cyfrową ciszą, ponowne użycie fragmentów między wariantami, ZIP (weryfikowany Pythonem), DOCX, Windows‑1250, Ogg/Opus, kodowanie MP3, backend (fałszywy endpoint Google: cache, parametry modeli, kod dostępu, ochrona plików), kompletność tłumaczeń PL/EN, poprawność importów modułów i listy plików offline.

Ręczny test eksportu bez konta Google: `node server/server.js --mock`, następnie Audio Studio → Google Cloud TTS → przypisz głosy „TEST-…” → Eksport.

---

## Struktura projektu
```
index.html, manifest.webmanifest, sw.js, sw-manifest.js (generowany)
css/app.css                 – system wizualny (ciemny/jasny motyw, teatr i kino)
js/app.js                   – start, routing, nawigacja
js/core/                    – parser, tokenizacja, porównywanie, SRS, fragmenty, czasy, planer, importy, ZIP, IndexedDB, stan, mowa, nagrania, i18n
js/audio/                   – program audio, render WAV, MP3/Opus, Ogg, sygnały, Google Cloud, odtwarzacze, Media Session, eksport
js/ui/                      – komponenty interfejsu
js/views/                   – ekrany aplikacji
js/i18n/pl.js, en.js        – tłumaczenia
vendor/pdfjs, vendor/lamejs – biblioteki dołączone lokalnie (offline)
server/                     – backend Node (statyczne pliki + proxy Google Cloud TTS), bez zależności
tools/                      – generator listy offline, ikon, kluczy tłumaczeń
tests/                      – testy
```

Licencje bibliotek: PDF.js – Apache‑2.0 (Mozilla); lamejs – LGPL (projekt LAME, lame.sourceforge.net); onnxruntime‑web – MIT (Microsoft); piper_phonemize – MIT, dane espeak‑ng – GPL‑3.0. Modele głosów Piper pobierane są z `huggingface.co/rhasspy/piper-voices` (licencja każdego modelu w jego MODEL_CARD). Pliki licencji w `vendor/`.

---

## Ograniczenia przeglądarek
* **Rozpoznawanie mowy** (Web Speech) działa w Chrome, Edge i Safari; w Firefoksie nie jest dostępne – aplikacja przełącza się na ocenę ręczną. Zwykle wymaga internetu.
* **Głosy Web Speech** zależą od systemu; głosy „Google …” w Chrome są sieciowe. Więcej głosów: Microsoft Edge (głosy naturalne), pakiety mowy Windows/Android/iOS albo silnik Piper.
* **Piper** wymaga przeglądarki z WebAssembly SIMD (Chrome/Edge/Firefox, Safari 16.4+). Pierwsza kwestia generuje się kilka sekund (ładowanie modelu), kolejne ok. 0,5 s.
* **iOS/Safari**: synteza mowy wymaga gestu użytkownika (przycisk „Start”); OGG/Opus może być niedostępny – użyj MP3.
* **PDF**: tylko pliki z warstwą tekstową (skany wymagają OCR poza aplikacją).
