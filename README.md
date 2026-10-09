# MZM Construction – landing oldal

Meta- és Instagram-hirdetésekből érkező látogatóknak készült, egyoldalas landing + `/mzm-admin` statisztika dashboard.
A landing külső függőség nélküli statikus oldal, a betűtípusok is helyben vannak (nincs Google Fonts hívás).

## GitHub Pages (ajánlott élesítés)

Az oldal teljesen statikus, a `docs/` mappából szolgálható ki, relatív útvonalakkal (almappából, pl. `/mzmlanding/` alól is működik).
A GitHub Pages-nek nincs szervere, ezért a látogatottság-mérés és az admin belépés egy **külön, ingyenes háttérszolgáltatást** igényel (lásd lent). Nélküle az oldal tökéletesen működik, csak nincs statisztika (az admin ilyenkor jelzi, hogy nincs beállítva).

### 1. Az oldal kitétele (egyszer)

GitHub → **Settings → Pages → Build and deployment → Source: „Deploy from a branch”**, ott:
**Branch: `main` (vagy a kipróbálandó ág), Folder: `/docs`** → Save.

> A mappa legyen `/docs`, ne `/ (root)` – a gyökeret kiválasztva csak a README jelenik meg.

Cím: `https://<felhasználó>.github.io/<repo>/` – admin: `https://<felhasználó>.github.io/<repo>/mzm-admin/`

### 2. Statisztika + admin háttér (Cloudflare Worker + D1, ingyenes csomag elég)

```bash
cd worker && npm install
npx wrangler login
npx wrangler d1 create mzm-stats          # a kiírt database_id-t másold a worker/wrangler.toml-ba
npm run db:init                           # táblák létrehozása
npx wrangler secret put ADMIN_PASSWORD    # az admin jelszava
npx wrangler secret put SESSION_SECRET    # tetszőleges, legalább 32 karakteres véletlen szöveg
# worker/wrangler.toml: ALLOWED_ORIGIN = az oldal címe útvonal nélkül (pl. https://peti303.github.io), ADMIN_USERNAME
npx wrangler deploy                       # kiírja a Worker címét (https://mzm-stats.<fiók>.workers.dev)
```

Végül írd be a Worker címét a `docs/js/config.js` fájlba, majd commit + push:

```js
window.MZM_CONFIG = { apiBase: "https://mzm-stats.<fiók>.workers.dev" };
```

Ettől fogva az oldal méri a látogatókat, és a `/mzm-admin/` oldalon be tudsz lépni. (A cím nem titok; a jelszó és a munkamenet-kulcs titokként a Cloudflare-nél van.)

Biztonság: a Worker csak az `ALLOWED_ORIGIN`-ről fogad kérést, a belépés 5 hibás próbálkozás után 15 percre zárol, a munkamenet 12 órás aláírt token (a böngészőfül bezárásakor törlődik).

## Oldalszerkesztő (`/mzm-admin/szerkeszto/`)

A vezérlőpulton az **Oldal szerkesztése** gomb új lapon nyitja meg. Elementor/Shopify-szerű: középen az élő oldal, bal oldalon a panel.

- **Szöveg:** kattints rá a kijelöléshez, dupla kattintással (vagy az „Szöveg átírása” gombbal) át lehet írni; félkövér és akcentszínű kiemelés; betűméret, vastagság, szín, igazítás, sormagasság, térközök.
- **Képek:** csere feltöltéssel (a szerkesztő automatikusan kicsinyít és tömörít), alt szöveg, szélesség, magasság, illesztés, lekerekítés, átlátszóság; a kép sarkát húzva átméretezhető. A nyitó rész háttérképe és a három előtte–utána képpár is cserélhető.
- **Szekciók és kártyák:** elrejtés, térköz, háttérszín; a **Szekciók** fülön sorrend és láthatóság.
- **Eszközönként külön:** az Asztali / Tablet / Mobil váltóval minden érték csak az adott eszközre vonatkozik, a többi az eredeti reszponzív megjelenést kapja.
- **Oldal fül:** akcentszín, hová vigyenek az „Ajánlatkérés” gombok (`https://…`, `tel:…`, `mailto:…`, vagy üresen az oldal tetejére), Facebook/Instagram link, böngészőfül címe, rövid leírás.
- Visszavonás/újra (Ctrl+Z / Ctrl+Shift+Z), Ctrl+S = közzététel. A **Közzététel** gomb azonnal élesíti a módosításokat.

Hogyan működik: a módosítások egy `content.json`-ba kerülnek (szerveren: `data/content.json`, feltöltések: `data/uploads/`; Workernél a D1 adatbázisban), az oldal betöltéskor ezt helyezi az eredeti HTML-re. Az elemeket a `docs/index.html`-ben a `data-e="…"` attribútum azonosítja – **új elem szerkeszthetővé tételéhez adj neki egyedi `data-e` kulcsot** (kisbetű, szám, pont, kötőjel).

> Ingyenes Render-csomagon a fájlrendszer törlődik újraindításkor/újratelepítéskor, ezért a mentett módosítások és feltöltések is elvesznek. Tartós használathoz Render „Disk” (és `DATA_DIR` ráállítása), a Cloudflare Worker + D1 változat, vagy saját szerver kell. A „Letöltés (site.json)” gombbal bármikor kimentheted a szövegek/beállítások állapotát.
>
> Cloudflare Workernél a szerkesztő bevezetése után futtasd újra: `cd worker && npm run db:init` (új táblák), majd `npx wrangler deploy`.

## Saját szerveren (Node, alternatíva)

```bash
npm start            # http://localhost:3000
```

- Oldal: `/`
- Admin: `/mzm-admin` (belépés után látható a dashboard)

### Admin belépés

Teszteléshez: `npm run start:test` – belépés: **teszt / 123** (a `.env.test` fájlból; csak tesztre való, élesben ne használd).

Élesben:

Állítsd be környezeti változóként (vagy `.env` fájlban, lásd `.env.example`):

```
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<erős jelszó>
```

Ha az `ADMIN_PASSWORD` nincs megadva, az első indulásnál véletlen jelszó készül (hash-elve a `data/admin.json`-ban),
és **egyszer** kiíródik a konzolra. 5 hibás próbálkozás után az IP 15 percre kizárásra kerül.
HTTPS mögött (proxy/CDN) állítsd be: `TRUST_PROXY=1`.

### Dashboard

Hét / Hónap kapcsoló (a nyilakkal visszalapozhatsz), mutatja: látogatók, oldalmegtekintések, ajánlatkérés-gombnyomások,
a gombra kattintók aránya, napi bontás, forrás (Facebook / Instagram / Google …), eszköz, melyik gomb hozza a kattintást,
óránkénti eloszlás, hirdetési kampányok (`utm_campaign`).

A hirdetéseknél használj UTM-paramétereket, pl.:
`https://oldalad.hu/?utm_source=instagram&utm_medium=paid&utm_campaign=Tavaszi_felujitas`
(UTM nélkül is felismerjük a Facebook/Instagram forgalmat a `fbclid`, a referrer és az appon belüli böngésző alapján.)

Adatvédelem: nincs süti és nincs localStorage. A látogatót IP+böngésző alapú, havonta változó, visszafejthetetlen hash azonosítja;
a botokat és a „Do Not Track” böngészőket nem számoljuk. Az adatok a `DATA_DIR` (alapból `./data`) alatt, `events.jsonl`-ben vannak –
**tartós tárhelyet/volume-ot állíts be**, különben újratelepítéskor elvesznek.

Demo adatokkal kipróbálás: `DATA_DIR=./data-demo node scripts/seed-demo.js && DATA_DIR=./data-demo ADMIN_PASSWORD=teszt npm start`

## Mit kell kicserélni élesítés előtt

| Mi | Hol |
|---|---|
| Cégadatok, számok (12+ év, 180+ projekt, 98 %…) – **helyőrzők** | `docs/index.html` (`.stats`) |
| Ügyfélvélemények – **kitalált helyőrzők**, valós, engedéllyel idézett vélemények kellenek | `docs/index.html` (`.reviews`) |
| Vállalások (fix ár, 5 év jótállás, kötbér, ingyenes felmérés, 24 órás válasz) | `docs/index.html` – csak akkor maradjanak, ha a cég valóban vállalja |
| Előtte–utána képek – **generált helyőrzők**; valós látványterv + fotó párokra cserélendő (azonos kameraszög, 1600×1000) | `docs/img/projects/*-render.jpg` / `*-real.jpg`, lista: `PAIRS` a `docs/js/main.js`-ben |
| Facebook / Instagram link, kapcsolat, adatkezelési tájékoztató | lábléc a `docs/index.html`-ben |
| Ajánlatkérés gombok: most az oldal tetejére ugranak (`data-cta` attribútum), a kattintást mérjük | `docs/js/main.js` (`click` kezelő) |

## Struktúra

```
docs/                a statikus oldal (ezt teszi ki a GitHub Pages)
docs/mzm-admin/      az admin felület (belépés + dashboard)
docs/mzm-admin/szerkeszto/  az oldalszerkesztő
docs/js/content*.js  a mentett tartalom ráhelyezése az oldalra (közös logika a szerverrel)
docs/js/config.js    statisztika-szerver címe
worker/              Cloudflare Worker + D1: statisztika-, admin- és szerkesztő-API Pages mellé
server.js, lib/      Node szerver ugyanazzal az API-val (saját tárhelyre)
scripts/seed-demo.js demo adatok a Node szerverhez
test/                node --test
.github/workflows/   tesztek
```
