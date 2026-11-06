// Shared by both apps: a small on-device store (localStorage) and backup helpers.
// The store mimics the tiny API the apps already used: collection().add/doc().set/update/delete/onSnapshot.
(function () {
  const err = (code, msg) => { const e = new Error(msg); e.code = code; return e; };
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

  function openStore(key) {
    let available = true;
    try { localStorage.setItem("__t", "1"); localStorage.removeItem("__t"); } catch (_) { available = false; }

    let state = {};
    const read = () => {
      try { const raw = localStorage.getItem(key); state = raw ? JSON.parse(raw) : {}; } catch (_) { state = {}; }
      if (!state || typeof state !== "object") state = {};
    };
    read();

    const subs = new Set();
    const notify = () => subs.forEach((fn) => fn());
    // Change state, save it, and roll back if saving fails.
    function mutate(fn) {
      const before = JSON.stringify(state);
      fn();
      try { localStorage.setItem(key, JSON.stringify(state)); }
      catch (_) { state = JSON.parse(before); throw err("quota_exceeded", "Depolama dolu"); }
      notify();
    }
    window.addEventListener("storage", (e) => { if (e.key === key) { read(); notify(); } });

    const bucket = (c) => (state[c] && typeof state[c] === "object" ? state[c] : (state[c] = {}));

    function docRef(c, id) {
      return {
        id,
        async set(data) { mutate(() => { bucket(c)[id] = clone(data); }); },
        async update(data) {
          if (!state[c] || !state[c][id]) throw err("not_found", "Kayıt bulunamadı");
          mutate(() => { Object.assign(bucket(c)[id], clone(data)); });
        },
        async delete() { mutate(() => { delete bucket(c)[id]; }); },
        onSnapshot(cb) {
          const run = () => { const d = state[c] && state[c][id]; cb({ exists: !!d, data: () => clone(d) }); };
          subs.add(run); run(); return () => subs.delete(run);
        }
      };
    }
    function collection(c) {
      return {
        doc: (id) => docRef(c, id),
        async add(data) { const id = newId(); mutate(() => { bucket(c)[id] = clone(data); }); return docRef(c, id); },
        onSnapshot(cb) {
          const run = () => {
            const b = state[c] || {};
            cb({ docs: Object.keys(b).map((id) => ({ id, data: () => clone(b[id]) })) });
          };
          subs.add(run); run(); return () => subs.delete(run);
        }
      };
    }
    return {
      available,
      collection,
      doc(path) { const [c, id] = path.split("/"); return docRef(c, id); },
      replaceAll(next) { mutate(() => { state = clone(next); }); }
    };
  }

  // Ask the browser not to clear our data when space runs low.
  function askPersist() {
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (_) {}
  }

  // Hands the backup to the iPhone share sheet ("Dosyalar'a Kaydet"), or downloads it elsewhere.
  async function saveFile(filename, obj) {
    const text = JSON.stringify(obj, null, 2);
    const blob = new Blob([text], { type: "application/json" });
    let file = null;
    try { file = new File([blob], filename, { type: "application/json" }); } catch (_) {}
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return "shared"; }
      catch (e) { if (e && e.name === "AbortError") return "cancelled"; }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.style.display = "none";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return "downloaded";
  }

  // Opens the file picker and returns the parsed JSON (null if nothing was picked).
  function pickJson() {
    return new Promise((resolve, reject) => {
      const inp = document.createElement("input");
      inp.type = "file"; inp.style.display = "none";
      inp.addEventListener("change", async () => {
        const f = inp.files && inp.files[0];
        inp.remove();
        if (!f) return resolve(null);
        try { resolve(JSON.parse(await f.text())); }
        catch (_) { reject(err("bad_file", "Dosya okunamadı")); }
      });
      document.body.appendChild(inp);
      inp.click();
    });
  }

  const metaKey = (key) => key + ":sonYedek";
  function lastBackup(key) {
    try { const v = Number(localStorage.getItem(metaKey(key))); return v > 0 ? v : null; } catch (_) { return null; }
  }
  function setLastBackup(key, ms) {
    try { localStorage.setItem(metaKey(key), String(ms)); } catch (_) {}
  }
  const todayStamp = () => {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  };
  const fmtDate = (ms) => {
    const d = new Date(ms);
    return String(d.getDate()).padStart(2, "0") + "." + String(d.getMonth() + 1).padStart(2, "0") + "." + d.getFullYear();
  };

  function registerSW() {
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(() => {}); });
    }
  }

  window.Depo = { openStore, askPersist, saveFile, pickJson, lastBackup, setLastBackup, todayStamp, fmtDate, newId, registerSW };
})();
