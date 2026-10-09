// Statisztika-szerver beállítása.
//   apiBase: ""        -> ugyanarról a szerverről szolgált oldal (a Node szerver ezt automatikusan így adja)
//   apiBase: "https://…workers.dev" -> külön API (pl. GitHub Pages + Cloudflare Worker)
//   apiBase: null      -> nincs szerver: a látogatottság-mérés kikapcsol, az admin jelzi, hogy nincs beállítva
// GitHub Pages-en ide kerül a Worker címe (lásd README).
window.MZM_CONFIG = { apiBase: null };
