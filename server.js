/*
 * UPS Servis Jurnalı — LOKAL ŞƏBƏKƏ SERVERİ (internetsiz işləmək üçün)
 *
 * Ofisdəki bir kompüterdə işləyir. Telefonlar və digər kompüterlər eyni Wi-Fi / şəbəkədə
 * bu kompüterin ünvanına (məs. http://192.168.1.10:8080/api) qoşulur. Bütün məlumat bu
 * kompüterin diskində, "data" qovluğunda saxlanılır. İnternet lazım deyil.
 *
 * İstəyə görə: data/config.json faylında "upstream" yazılsa (Google Apps Script ünvanı və
 * rəhbər açarı), hər hesabat internet olanda Google Drive-a da ehtiyat nüsxə kimi göndərilir.
 *
 * İşə salmaq: Server-baslat.bat (və ya: node server.js). Node.js 18+ lazımdır (pulsuz).
 * Heç bir əlavə paket tələb olunmur.
 */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');

const DATA = process.env.UPS_DATA || path.join(__dirname, 'data');
const APP = process.env.UPS_APP || path.join(__dirname, '..', 'app');
const D = (...p) => path.join(DATA, ...p);
['reports', 'history', 'photos', 'pdf'].forEach(d => fs.mkdirSync(D(d), { recursive: true }));

/* ---------- kiçik fayl bazası ---------- */
function readJSON(f, def) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return def; } }
function writeJSON(f, v) { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(v)); fs.renameSync(t, f); }
const hex = n => crypto.randomBytes(Math.ceil(n / 2)).toString('hex').slice(0, n);
const safe = s => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Adsız müştəri';
const okId = id => typeof id === 'string' && /^[A-Za-z0-9_.~:@+\-]+$/.test(id);

const cfg = readJSON(D('config.json'), {});
if (!cfg.apiKey) cfg.apiKey = hex(20);
if (!cfg.adminKey) cfg.adminKey = 'R' + hex(23);
if (!cfg.port) cfg.port = 8080;
if (cfg.upstream === undefined) cfg.upstream = { url: '', key: '' };
writeJSON(D('config.json'), cfg);

const db = {
  index: readJSON(D('index.json'), {}),        // id -> qısa məlumat (siyahı üçün)
  items: readJSON(D('items.json'), {}),        // id -> yararsız / dəyişdirilmiş detallar
  blocks: readJSON(D('blocks.json'), {}),      // id -> akkumulyator blokları
  deleted: readJSON(D('deleted.json'), []),
  settings: readJSON(D('settings.json'), null),
  workers: readJSON(D('workers.json'), []),
  tasks: readJSON(D('tasks.json'), []),
  ratings: readJSON(D('ratings.json'), {}),
  queue: readJSON(D('upstream-queue.json'), [])
};
const save = k => writeJSON(D({ index: 'index.json', items: 'items.json', blocks: 'blocks.json', deleted: 'deleted.json', settings: 'settings.json',
  workers: 'workers.json', tasks: 'tasks.json', ratings: 'ratings.json', queue: 'upstream-queue.json' }[k]), db[k]);
function log(what, id, repno, client, who) {
  fs.appendFileSync(D('jurnal.csv'), [new Date().toISOString(), what, id || '', repno || '', client || '', who || ''].map(x => '"' + String(x).replace(/"/g, '""') + '"').join(';') + '\n');
}

/* ---------- giriş ---------- */
function role(k) {
  if (!k) return null;
  if (k === cfg.adminKey) return { role: 'admin' };
  const w = db.workers.find(x => x.key === k);
  if (w) return w.active === false ? null : { role: w.role === 'admin' ? 'admin' : 'worker', name: w.name, wid: w.id };
  if (k === cfg.apiKey && !cfg.sharedOff) return { role: 'worker' };
  return null;
}
const ADMIN_ONLY = new Set(['delete', 'restore', 'history', 'workers', 'worker_save', 'worker_newkey', 'shared_off', 'rate', 'ratings', 'task_save']);

/* ---------- əməliyyatlar ---------- */
const A = {
  ping: (b, who) => ({ ok: true, role: who.role, name: who.name || '', personal: !!who.wid, time: new Date().toISOString(), lan: true }),
  list: (b, who) => ({ ok: true, items: Object.values(db.index), settings: db.settings, role: who.role, name: who.name || '', personal: !!who.wid, deleted: db.deleted }),
  get: b => { const r = readJSON(D('reports', b.id + '.json'), null); return r ? { ok: true, report: r } : { ok: false, error: 'not_found' }; },
  save: (b, who) => {
    const r = b.report, s = b.summary || {};
    if (!r || !okId(r.id)) return { ok: false, error: 'bad_report' };
    if (db.deleted.includes(r.id)) return { ok: false, error: 'deleted' };
    const old = db.index[r.id];
    if (old && (old.updatedAt || 0) > (Number(r.updatedAt) || 0) && !b.force) return { ok: false, error: 'conflict', report: readJSON(D('reports', r.id + '.json'), null) };
    const f = D('reports', r.id + '.json');
    if (fs.existsSync(f)) archive(r.id, f, old && old.by);
    writeJSON(f, r);
    const creator = (old && old.creator) || (who.wid ? who.name : (s.creator || s.eng || b.worker || ''));
    db.index[r.id] = { id: r.id, repno: s.repno || '', date: s.date || '', client: s.client || '', obj: s.obj || '', brand: s.brand || '', model: s.model || '',
      sn: s.sn || '', kva: s.kva || '', eng: s.eng || '', overall: s.overall || '', tested: s.tested || 0, rep: s.rep || 0, att: s.att || 0, next: s.next || '',
      by: b.worker || r.by || '', pdf: old ? old.pdf || '' : '', updatedAt: Number(r.updatedAt) || Date.now(), type: s.type || '', devn: s.devn || 0,
      fill: s.fill === undefined ? null : s.fill, photos: s.photos || 0, creator };
    save('index');
    db.blocks[r.id] = b.blocks || []; save('blocks');
    if (Array.isArray(b.items)) { db.items[r.id] = b.items.map(x => [r.id, s.repno || '', s.date || '', s.client || '', s.obj || ''].concat(x)); save('items'); }
    if (r.taskId) markTask(r.taskId, b.worker || r.by || '', r.id, '');
    queueUp({ action: 'save', report: r, summary: s, blocks: b.blocks || [], items: b.items, force: true });
    return { ok: true, summary: db.index[r.id] };
  },
  delete: (b, who) => {
    const old = db.index[b.id], f = D('reports', b.id + '.json');
    if (fs.existsSync(f)) { archive(b.id, f, old && old.by); fs.unlinkSync(f); }
    delete db.index[b.id]; delete db.items[b.id]; delete db.blocks[b.id];
    if (!db.deleted.includes(b.id)) db.deleted.push(b.id);
    db.deleted = db.deleted.slice(-3000);
    ['index', 'items', 'blocks', 'deleted'].forEach(save);
    log('Silindi', b.id, old && old.repno, old && old.client, b.worker);
    queueUp({ action: 'delete', id: b.id });
    return { ok: true };
  },
  history: b => {
    const dir = D('history', b.id); if (!fs.existsSync(dir)) return { ok: true, items: [] };
    const items = fs.readdirSync(dir).filter(n => n.endsWith('.json')).map(n => { const m = /^(\d+)__(.*)\.json$/.exec(n) || [];
      return { rev: n, name: n, by: m[2] || '', at: new Date(Number(m[1]) || 0).toISOString() }; }).sort((a, b) => a.at < b.at ? 1 : -1);
    return { ok: true, items };
  },
  restore: (b) => {
    db.deleted = db.deleted.filter(x => x !== b.id); save('deleted');
    const r = readJSON(D('history', b.id, path.basename(String(b.rev || ''))), null);
    if (!r || r.id !== b.id) return { ok: false, error: 'bad_rev' };
    r.updatedAt = Date.now(); r.by = (b.worker || 'Rəhbər') + ' (bərpa)';
    return { ok: true, report: r };
  },
  settings: b => {
    if (b.settings && typeof b.settings === 'object') {
      const keep = {}; ['co', 'coaddr', 'cotel', 'notify', 'interval', 'warn', 'fail', 'vwarn', 'vfail', 'vhigh', 'life'].forEach(k => { if (b.settings[k] !== undefined) keep[k] = b.settings[k]; });
      db.settings = keep; save('settings');
    }
    return { ok: true, settings: db.settings };
  },
  pdf: (b, who, req) => {
    if (!b.data || !b.id) return { ok: false, error: 'bad_pdf' };
    const dir = D('pdf', safe(b.client)); fs.mkdirSync(dir, { recursive: true });
    const name = safe(b.name || 'hesabat').replace(/\.pdf$/i, '') + '.pdf';
    fs.writeFileSync(path.join(dir, name), Buffer.from(String(b.data).replace(/^data:[^,]*,/, ''), 'base64'));
    const url = 'http://' + (req.headers.host || 'localhost:' + cfg.port) + '/files/pdf/' + encodeURIComponent(safe(b.client)) + '/' + encodeURIComponent(name);
    if (db.index[b.id]) { db.index[b.id].pdf = url; save('index'); }
    return { ok: true, url };
  },
  translate: async b => {
    if (cfg.upstream && cfg.upstream.url) { try { return await callUp({ action: 'translate', texts: b.texts, to: b.to }); } catch (e) {} }
    return { ok: true, out: (b.texts || []).map(() => '') };
  },
  photo: b => {
    if (!b.data || !b.pid) return { ok: false, error: 'bad_photo' };
    const fid = 'L' + crypto.createHash('sha1').update(String(b.rid) + '|' + String(b.pid)).digest('hex').slice(0, 24);
    const f = D('photos', fid + '.jpg');
    if (!fs.existsSync(f)) fs.writeFileSync(f, Buffer.from(String(b.data), 'base64'));
    queueUp({ action: 'photo', rid: b.rid, pid: b.pid, client: b.client, repno: b.repno, data: b.data });
    return { ok: true, fid };
  },
  photo_get: b => { const f = D('photos', path.basename(String(b.fid || '')) + '.jpg'); return fs.existsSync(f) ? { ok: true, data: fs.readFileSync(f).toString('base64') } : { ok: false, error: 'not_found' }; },
  parts: () => ({ ok: true, rows: [].concat(...Object.values(db.items)) }),
  items: b => { if (!b.id || !Array.isArray(b.items)) return { ok: false, error: 'bad_items' }; const s = b.summary || {};
    db.items[b.id] = b.items.map(x => [b.id, s.repno || '', s.date || '', s.client || '', s.obj || ''].concat(x)); save('items'); return { ok: true }; },
  /* işçilər */
  workers: () => ({ ok: true, workers: db.workers, sharedOff: !!cfg.sharedOff }),
  worker_save: b => {
    const w = b.w || {}, name = String(w.name || '').trim().slice(0, 60);
    if (!name) return { ok: false, error: 'bad_name' };
    const cur = w.id && db.workers.find(x => x.id === w.id);
    if (cur) { cur.name = name; cur.role = w.role === 'admin' ? 'admin' : 'worker'; cur.active = w.active !== false; if (w.email !== undefined) cur.email = String(w.email || '').trim(); }
    else db.workers.push({ id: 'w' + hex(8), name, role: w.role === 'admin' ? 'admin' : 'worker', active: true, key: (w.role === 'admin' ? 'R' : 'W') + hex(21), email: String(w.email || ''), created: new Date().toISOString() });
    save('workers'); log(cur ? 'İşçi dəyişdi' : 'İşçi əlavə', '', '', name, b.worker);
    return { ok: true, workers: db.workers, sharedOff: !!cfg.sharedOff };
  },
  worker_newkey: b => { db.workers.forEach(x => { if (x.id === b.id) x.key = (x.role === 'admin' ? 'R' : 'W') + hex(21); }); save('workers'); return { ok: true, workers: db.workers, sharedOff: !!cfg.sharedOff }; },
  shared_off: b => { cfg.sharedOff = !!b.off; writeJSON(D('config.json'), cfg); return { ok: true, workers: db.workers, sharedOff: !!cfg.sharedOff }; },
  /* qiymətlər */
  rate: b => { if (b.score) db.ratings[b.id] = [b.id, b.repno || '', b.date || '', b.client || '', b.person || '', Number(b.score) || '', b.note || '', b.worker || '', new Date().toISOString()]; else delete db.ratings[b.id]; save('ratings'); return { ok: true }; },
  ratings: () => ({ ok: true, rows: Object.values(db.ratings) }),
  /* tapşırıqlar */
  tasks: (b, who) => ({ ok: true, tasks: db.tasks.filter(t => who.role === 'admin' || (who.wid && t.wids.includes(who.wid))), me: who.wid || '' }),
  task_save: (b, who) => {
    const t = b.task || {};
    if (b.remove) { db.tasks = db.tasks.filter(x => x.id !== t.id); save('tasks'); return A.tasks(b, who); }
    const wids = (t.wids || []).filter(id => db.workers.some(w => w.id === id));
    const names = wids.map(id => db.workers.find(w => w.id === id).name).join(', ');
    let cur = t.id && db.tasks.find(x => x.id === t.id);
    if (!cur) { cur = { id: 't' + hex(10), created: new Date().toISOString().slice(0, 10), by: b.worker || 'Rəhbər', status: 'Açıq', doneBy: '', doneAt: '', report: '', doneNote: '' }; db.tasks.push(cur); }
    Object.assign(cur, { title: String(t.title || '').slice(0, 200), client: t.client || '', obj: t.obj || '', addr: t.addr || '', date: t.date || '', prio: t.prio || 'Normal',
      wids, names, note: t.note || '', status: t.status || cur.status || 'Açıq', updatedAt: Date.now() });
    if (cur.status === 'Açıq') { cur.doneBy = ''; cur.doneAt = ''; }
    save('tasks'); return A.tasks(b, who);
  },
  task_done: (b, who) => {
    const t = db.tasks.find(x => x.id === b.id); if (!t) return { ok: false, error: 'not_found' };
    if (who.role !== 'admin' && !t.wids.includes(who.wid)) return { ok: false, error: 'forbidden' };
    if (b.undo) Object.assign(t, { status: 'Açıq', doneBy: '', doneAt: '' }); else markTask(b.id, b.worker || '', b.report || '', b.note || '');
    save('tasks'); return A.tasks(b, who);
  }
};
function markTask(id, name, reportId, note) {
  const t = db.tasks.find(x => x.id === id); if (!t || t.status === 'Ləğv') return;
  Object.assign(t, { status: 'Görülüb', doneBy: name || '', doneAt: new Date().toISOString().slice(0, 10), updatedAt: Date.now() });
  if (reportId) t.report = reportId; if (note) t.doneNote = note;
  save('tasks'); log('Tapşırıq görüldü', reportId, '', t.client, name);
}
function archive(id, file, by) {
  const dir = D('history', id); fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(file, path.join(dir, Date.now() + '__' + safe(by || 'naməlum') + '.json'));
  const L = fs.readdirSync(dir).sort(); while (L.length > 30) fs.unlinkSync(path.join(dir, L.shift()));
}

/* ---------- Google-a ehtiyat nüsxə (istəyə görə) ---------- */
function queueUp(job) { if (!cfg.upstream || !cfg.upstream.url) return; db.queue.push(job); if (db.queue.length > 5000) db.queue = db.queue.slice(-5000); save('queue'); }
async function callUp(body) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 60000);
  try { const r = await fetch(cfg.upstream.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ key: cfg.upstream.key, worker: 'LAN server', ...body }), signal: ctl.signal, redirect: 'follow' });
    return await r.json(); } finally { clearTimeout(t); }
}
let upBusy = false;
async function flushUp() {
  if (upBusy || !db.queue.length || !cfg.upstream || !cfg.upstream.url) return; upBusy = true;
  try { while (db.queue.length) { const job = db.queue[0]; const r = await callUp(job);
      if (!r || (!r.ok && !['deleted', 'not_found', 'conflict'].includes(r.error))) break; db.queue.shift(); save('queue'); } }
  catch (e) {} finally { upBusy = false; }
}
setInterval(flushUp, 60000);

/* ---------- HTTP ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.svg': 'image/svg+xml' };
function send(res, code, body, type) { res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Cache-Control': 'no-store' }); res.end(body); }
function sendFile(res, f) { fs.readFile(f, (e, b) => e ? send(res, 404, 'Tapılmadı', 'text/plain; charset=utf-8') : send(res, 200, b, MIME[path.extname(f).toLowerCase()] || 'application/octet-stream')); }
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), p = decodeURIComponent(u.pathname);
  if (req.method === 'OPTIONS') return send(res, 204, '');
  if (req.method === 'POST' && (p === '/api' || p === '/')) {
    let raw = ''; req.on('data', d => { raw += d; if (raw.length > 60e6) req.destroy(); });
    req.on('end', async () => {
      let b; try { b = JSON.parse(raw); } catch (e) { return send(res, 200, JSON.stringify({ ok: false, error: 'bad_json' })); }
      const who = role(b.key); if (!who) return send(res, 200, JSON.stringify({ ok: false, error: 'auth' }));
      if (who.name) b.worker = who.name;
      if (ADMIN_ONLY.has(b.action) || (b.action === 'settings' && b.settings)) { if (who.role !== 'admin') return send(res, 200, JSON.stringify({ ok: false, error: 'forbidden' })); }
      const fn = A[b.action];
      if (!fn) return send(res, 200, JSON.stringify({ ok: false, error: 'unknown_action' }));
      try { send(res, 200, JSON.stringify(await fn(b, who, req))); } catch (e) { send(res, 200, JSON.stringify({ ok: false, error: String(e && e.message || e) })); }
    });
    return;
  }
  if (req.method !== 'GET') return send(res, 405, '');
  if (p === '/config.js') return send(res, 200, 'window.UPS_CONFIG={serverUrl:location.origin+"/api",apiKey:""};', MIME['.js']);
  if (p.startsWith('/files/pdf/')) { const f = path.join(D('pdf'), path.normalize(p.slice(11)).replace(/^(\.\.[\\/])+/, '')); return sendFile(res, f); }
  const rel = p === '/' ? 'index.html' : path.normalize(p).replace(/^([\\/]|\.\.[\\/])+/, '');
  return sendFile(res, path.join(APP, rel));
});
server.listen(cfg.port, '0.0.0.0', () => {
  const ips = []; Object.values(os.networkInterfaces()).forEach(L => (L || []).forEach(a => { if (a.family === 'IPv4' && !a.internal) ips.push(a.address); }));
  console.log('\n  UPS Servis Jurnalı — lokal server işləyir\n');
  console.log('  Bu kompüterdə açmaq:        http://localhost:' + cfg.port);
  ips.forEach(ip => console.log('  Telefonlar və digər PC-lər: http://' + ip + ':' + cfg.port + '    (server ünvanı: http://' + ip + ':' + cfg.port + '/api)'));
  console.log('\n  İŞÇİ açarı (ortaq):  ' + cfg.apiKey);
  console.log('  RƏHBƏR açarı:        ' + cfg.adminKey);
  console.log('  Məlumat qovluğu:     ' + DATA);
  console.log((cfg.upstream && cfg.upstream.url) ? '  Google ehtiyat nüsxəsi: aktivdir' : '  Google ehtiyat nüsxəsi: söndürülüb (data\\config.json → upstream)');
  console.log('\n  Bu pəncərəni BAĞLAMAYIN — server işləyir.\n');
  flushUp();
});
