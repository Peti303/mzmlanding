# MZM Construction – landing oldal

Meta- és Instagram-hirdetésekből érkező látogatóknak készült, egyoldalas landing + `/mzm-admin` statisztika dashboard.
Külső függőség nélkül (csak Node.js ≥ 20), a betűtípusok is helyben vannak (nincs Google Fonts hívás).

## Indítás

```bash
npm start            # http://localhost:3000
```

- Oldal: `/`
- Admin: `/mzm-admin` (belépés után látható a dashboard)

### Admin belépés

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
| Cégadatok, számok (12+ év, 180+ projekt, 98 %…) – **helyőrzők** | `public/index.html` (`.stats`) |
| Ügyfélvélemények – **kitalált helyőrzők**, valós, engedéllyel idézett vélemények kellenek | `public/index.html` (`.reviews`) |
| Vállalások (fix ár, 5 év jótállás, kötbér, ingyenes felmérés, 24 órás válasz) | `public/index.html` – csak akkor maradjanak, ha a cég valóban vállalja |
| Előtte–utána képek – **generált helyőrzők**; valós látványterv + fotó párokra cserélendő (azonos kameraszög, 1600×1000) | `public/img/projects/*-render.jpg` / `*-real.jpg`, lista: `PAIRS` a `public/js/main.js`-ben |
| Facebook / Instagram link, kapcsolat, adatkezelési tájékoztató | lábléc a `public/index.html`-ben |
| Ajánlatkérés gombok: most az oldal tetejére ugranak (`data-cta` attribútum), a kattintást mérjük | `public/js/main.js` (`click` kezelő) |

## Struktúra

```
server.js            HTTP szerver (statikus fájlok, /api/track, /mzm-admin)
lib/                 tár, statisztika, hitelesítés, forrás-felismerés
public/              a landing oldal
admin/               a /mzm-admin felülete
scripts/seed-demo.js demo adatok
test/                node --test
```
