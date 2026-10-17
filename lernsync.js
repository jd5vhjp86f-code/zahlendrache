/**
 * lernsync.js – Client für den LernSync-Worker
 * Offline-first: Der Lernstand liegt immer zuerst im localStorage des Geräts.
 * Der Server ist nur der Abgleich zwischen Geräten. Fällt er aus, läuft die App normal weiter.
 *
 *   const sync = LernSync({ app: "10finger" });
 *   const stand = await sync.laden("moritz");     // neuester Stand (lokal oder Server) oder null
 *   sync.speichern("moritz", { lektion: 7, ... }); // speichert lokal sofort, Server gebündelt
 *   const liste = await sync.profile();             // [{ profil, updatedAt }]
 *   await sync.codeSetzen("…");                     // Familien-Code prüfen + merken → true/false
 *   sync.hatCode();  sync.status;                   // "aus" | "ok" | "offline" | "code-falsch"
 */
(function (global) {
  const SERVER = "https://lernsync.2n7vt787wn.workers.dev";
  const CODE_KEY = "lernsync.code";
  const PUSH_DELAY = 15000; // ms – bündelt viele kleine Änderungen zu einem Schreibvorgang

  function ls(fn) { try { return fn(); } catch { return null; } }

  function LernSync({ app, server = SERVER, onStatus } = {}) {
    if (!app) throw new Error("LernSync: app fehlt");
    const timers = {};
    const api = { status: "aus" };

    const setStatus = (s) => { if (api.status !== s) { api.status = s; onStatus && onStatus(s); } };
    const code = () => ls(() => localStorage.getItem(CODE_KEY)) || "";
    const lokalKey = (p) => `lernsync:${app}:${p}`;
    const norm = (p) => String(p).trim().toLowerCase().replace(/\s+/g, "-");
    const lokal = (p) => ls(() => JSON.parse(localStorage.getItem(lokalKey(p)))) || null;
    const lokalSchreiben = (p, rec) => ls(() => localStorage.setItem(lokalKey(p), JSON.stringify(rec)));

    async function req(method, path, body, keepalive) {
      if (!code()) { setStatus("aus"); return null; }
      try {
        const r = await fetch(server + path, {
          method, keepalive,
          headers: { "X-Familien-Code": code(), ...(body ? { "Content-Type": "application/json" } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        });
        if (r.status === 401) { setStatus("code-falsch"); return null; }
        setStatus("ok");
        return { status: r.status, body: await r.json().catch(() => null) };
      } catch { setStatus("offline"); return null; }
    }

    async function push(p, keepalive) {
      const rec = lokal(p);
      if (!rec || !rec.dirty) return;
      const r = await req("PUT", `/v1/${app}/profile/${encodeURIComponent(p)}`, { data: rec.data, updatedAt: rec.updatedAt }, keepalive);
      if (!r) return;
      if (r.status === 200) lokalSchreiben(p, { ...rec, dirty: false });
      else if (r.status === 409 && r.body) lokalSchreiben(p, { data: r.body.data, updatedAt: r.body.updatedAt, dirty: false });
    }

    api.hatCode = () => !!code();

    api.codeSetzen = async (neu) => {
      const alt = code();
      ls(() => localStorage.setItem(CODE_KEY, String(neu).trim()));
      const r = await req("GET", "/v1/check");
      if (r && r.status === 200) return true;
      ls(() => (alt ? localStorage.setItem(CODE_KEY, alt) : localStorage.removeItem(CODE_KEY)));
      return false;
    };

    api.codeEntfernen = () => { ls(() => localStorage.removeItem(CODE_KEY)); setStatus("aus"); };

    api.laden = async (profil) => {
      const p = norm(profil);
      let rec = lokal(p);
      if (rec && rec.dirty) await push(p);
      const r = await req("GET", `/v1/${app}/profile/${encodeURIComponent(p)}`);
      if (r && r.status === 200 && r.body && (!rec || r.body.updatedAt > rec.updatedAt)) {
        rec = { data: r.body.data, updatedAt: r.body.updatedAt, dirty: false };
        lokalSchreiben(p, rec);
      }
      return rec ? rec.data : null;
    };

    api.speichern = (profil, data) => {
      const p = norm(profil);
      lokalSchreiben(p, { data, updatedAt: Date.now(), dirty: true });
      clearTimeout(timers[p]);
      timers[p] = setTimeout(() => push(p), PUSH_DELAY);
    };

    api.jetztSenden = async () => {
      for (const p of Object.keys(timers)) { clearTimeout(timers[p]); await push(p); }
    };

    api.profile = async () => {
      const r = await req("GET", `/v1/${app}/profile`);
      const server = r && r.status === 200 ? r.body.profile : [];
      const lokalListe = ls(() => Object.keys(localStorage))?.filter((k) => k.startsWith(`lernsync:${app}:`))
        .map((k) => ({ profil: k.slice(`lernsync:${app}:`.length), updatedAt: lokal(k.slice(`lernsync:${app}:`.length))?.updatedAt ?? null })) || [];
      const m = new Map();
      for (const e of [...lokalListe, ...server]) if (!m.has(e.profil) || (e.updatedAt || 0) > (m.get(e.profil).updatedAt || 0)) m.set(e.profil, e);
      return [...m.values()].sort((a, b) => a.profil.localeCompare(b.profil, "de"));
    };

    // Beim Verlassen/Wegklicken der Seite ausstehende Änderungen sofort senden
    const flush = () => { for (const p of Object.keys(timers)) { clearTimeout(timers[p]); push(p, true); } };
    global.addEventListener?.("pagehide", flush);
    global.document?.addEventListener?.("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });

    return api;
  }

  global.LernSync = LernSync;
})(typeof window !== "undefined" ? window : globalThis);
