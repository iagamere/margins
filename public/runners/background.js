/* Margins — background check of followed shelves (runs inside @capacitor/background-runner, no DOM).
 * Events: config · watchSet · unwatch · checkLibraries (also the periodic event).
 * State (KV, strings): `cfg` texts + api key, `watch` = { friendId: { name, shelves: { shelfId: { name, seen: [hash] } } } }. */

async function kvGet(key) {
  try {
    const r = await CapacitorKV.get(key);
    return r && r.value ? JSON.parse(r.value) : null;
  } catch (e) {
    return null;
  }
}
async function kvSet(key, value) {
  await CapacitorKV.set(key, JSON.stringify(value));
}

async function readManifest(id, apiKey) {
  const url = apiKey
    ? 'https://www.googleapis.com/drive/v3/files/' + id + '?alt=media&key=' + apiKey
    : 'https://drive.usercontent.google.com/download?id=' + id + '&export=download&confirm=t';
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return await res.json();
}

function fill(tpl, vars) {
  return String(tpl).replace(/\{(\w+)\}/g, function (m, k) {
    return k in vars ? String(vars[k]) : m;
  });
}

function numId(s) {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 2000000;
  return h * 1000 + (Date.now() % 1000);
}

addEventListener('config', async (resolve, reject, args) => {
  try {
    await kvSet('cfg', args || {});
    resolve();
  } catch (e) {
    reject(e);
  }
});

// start (seen = hashes already known) or stop (seen = null) watching one shelf of one profile
addEventListener('watchSet', async (resolve, reject, args) => {
  try {
    const watch = (await kvGet('watch')) || {};
    const fr = watch[args.friend] || (watch[args.friend] = { name: args.fname, shelves: {} });
    fr.name = args.fname;
    if (args.seen === null) delete fr.shelves[args.shelf];
    else fr.shelves[args.shelf] = { name: args.sname, seen: args.seen || [] };
    if (!Object.keys(fr.shelves).length) delete watch[args.friend];
    await kvSet('watch', watch);
    resolve();
  } catch (e) {
    reject(e);
  }
});

addEventListener('unwatch', async (resolve, reject, args) => {
  try {
    const watch = (await kvGet('watch')) || {};
    delete watch[args.friend];
    await kvSet('watch', watch);
    resolve();
  } catch (e) {
    reject(e);
  }
});

addEventListener('checkLibraries', async (resolve, reject) => {
  try {
    const cfg = (await kvGet('cfg')) || {};
    const watch = (await kvGet('watch')) || {};
    let found = 0;
    const out = [];
    for (const friendId of Object.keys(watch)) {
      const fr = watch[friendId];
      let manifest;
      try {
        manifest = await readManifest(friendId, cfg.key);
      } catch (e) {
        continue; // offline or unreachable: try again at the next run
      }
      if (!manifest || !Array.isArray(manifest.books)) continue;
      const who = (manifest.profile && manifest.profile.n) || manifest.name || fr.name;
      for (const shelfId of Object.keys(fr.shelves)) {
        const w = fr.shelves[shelfId];
        const books = manifest.books.filter(function (b) { return b.sh === shelfId; });
        const fresh = books.filter(function (b) { return w.seen.indexOf(b.h) < 0; });
        if (!fresh.length) continue;
        for (const b of books) if (w.seen.indexOf(b.h) < 0) w.seen.push(b.h);
        found += fresh.length;
        const shelfName = ((manifest.shelves || []).filter(function (s) { return s.id === shelfId; })[0] || {}).n || w.name;
        w.name = shelfName;
        const body = fresh.length === 1
          ? fill(cfg.one || '{shelf}: {title}', { friend: who, shelf: shelfName, title: fresh[0].t })
          : fill(cfg.many || '{count} · {shelf}', { friend: who, shelf: shelfName, count: fresh.length });
        out.push({ id: numId(friendId + shelfId), title: who, body: body, scheduleAt: new Date(Date.now() + 1000), extra: { friend: friendId, shelf: shelfId } });
      }
    }
    await kvSet('watch', watch);
    if (out.length) CapacitorNotifications.schedule(out);
    resolve({ found: found });
  } catch (e) {
    reject(e);
  }
});
