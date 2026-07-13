'use strict';

/* ============================================================
   Kasir Seblak - offline-first PWA
   Data disimpan lokal di IndexedDB. Tidak ada server.
   ============================================================ */

const DB_NAME = 'kasirSeblak';
const DB_VER = 1;

const SEED_PRODUK = [
  ['Sosis Besar', 3000], ['Fish Roll', 2000], ['Dumpling Ayam', 2000],
  ['Dumpling Keju', 2000], ['Odeng', 2000], ['Kaki Gurita', 2000],
  ['Sosis Merah', 1000], ['Bakso', 1000], ['Tofu Tahu', 1000],
  ['Kembang Cumi', 1000], ['Sosis Bambu', 1000], ['Udang Gulung', 1000],
  ['Cilok', 1000], ['Cilok Tahu', 1000], ['Jamur Kuping', 1000],
  ['Jamur Enoki', 1000], ['Batagor', 1000], ['Cuanki Lidah', 1000],
  ['Pilus', 1000]
].map(([nama, harga], i) => ({ nama, harga, kategori: 'topping', aktif: true, urutan: i }));

const PENYAJIAN = ['kuah', 'nyemek', 'kering'];

/* ---------- IndexedDB helpers ---------- */
let db;
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('produk')) {
        d.createObjectStore('produk', { keyPath: 'id', autoIncrement: true });
      }
      if (!d.objectStoreNames.contains('transaksi')) {
        const t = d.createObjectStore('transaksi', { keyPath: 'id', autoIncrement: true });
        t.createIndex('waktu', 'waktu');
      }
      if (!d.objectStoreNames.contains('meta')) {
        d.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function tx(store, mode = 'readonly') { return db.transaction(store, mode).objectStore(store); }
function reqP(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
const getAll = (s) => reqP(tx(s).getAll());
const put = (s, v) => reqP(tx(s, 'readwrite').put(v));
const del = (s, k) => reqP(tx(s, 'readwrite').delete(k));
const clearStore = (s) => reqP(tx(s, 'readwrite').clear());
async function getMeta(key, dflt) { const v = await reqP(tx('meta').get(key)); return v ? v.value : dflt; }
const setMeta = (key, value) => put('meta', { key, value });

/* ---------- State ---------- */
let produkCache = [];
let porsi = { level: 1, penyajian: 'kuah', items: {} }; // items: {produkId: qty}
let nota = [];        // [{level, penyajian, items:[{id,nama,harga,qty}], subtotal}]
let printerChar = null;
let deferredPrompt = null;

/* ---------- Utils ---------- */
const rp = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID');
const fmt = (n) => Number(n || 0).toLocaleString('id-ID');
const el = (id) => document.getElementById(id);
const produkById = (id) => produkCache.find((p) => p.id === id);
function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

/* ---------- Boot ---------- */
async function boot() {
  db = await openDB();
  produkCache = await getAll('produk');
  if (produkCache.length === 0) {
    for (const p of SEED_PRODUK) await put('produk', p);
    produkCache = await getAll('produk');
  }
  const nama = await getMeta('nama', 'Kasir Seblak');
  el('brand-name').textContent = nama;
  setupNav();
  setupKasir();
  setupPayment();
  setupSettings();
  setupPWA();
  renderKasir();
  el('rep-date').value = todayStr();
}

/* ---------- Navigation ---------- */
function setupNav() {
  el('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('.tab'); if (!b) return;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === b));
    const view = b.dataset.view;
    ['kasir', 'laporan', 'menu', 'setelan'].forEach((v) => {
      el('view-' + v).hidden = (v !== view);
    });
    if (view === 'laporan') renderLaporan();
    if (view === 'menu') renderMenu();
    if (view === 'setelan') renderSettings();
  });
}

/* ============================================================
   KASIR
   ============================================================ */
function setupKasir() {
  // level pills 0..5
  const lvl = el('level-pills');
  lvl.innerHTML = '';
  for (let i = 0; i <= 5; i++) {
    const b = document.createElement('button');
    b.className = 'pill' + (i === porsi.level ? ' on' : '');
    b.textContent = i; b.dataset.level = i;
    lvl.appendChild(b);
  }
  lvl.addEventListener('click', (e) => {
    const b = e.target.closest('.pill'); if (!b) return;
    porsi.level = Number(b.dataset.level);
    lvl.querySelectorAll('.pill').forEach((p) => p.classList.toggle('on', Number(p.dataset.level) === porsi.level));
  });

  // penyajian pills
  const pen = el('penyajian-pills');
  pen.innerHTML = '';
  PENYAJIAN.forEach((v) => {
    const b = document.createElement('button');
    b.className = 'pill' + (v === porsi.penyajian ? ' on' : '');
    b.textContent = v.charAt(0).toUpperCase() + v.slice(1); b.dataset.pen = v;
    pen.appendChild(b);
  });
  pen.addEventListener('click', (e) => {
    const b = e.target.closest('.pill'); if (!b) return;
    porsi.penyajian = b.dataset.pen;
    pen.querySelectorAll('.pill').forEach((p) => p.classList.toggle('on', p.dataset.pen === porsi.penyajian));
  });

  el('topping-grid').addEventListener('click', (e) => {
    const c = e.target.closest('.item'); if (!c) return;
    const id = Number(c.dataset.id);
    porsi.items[id] = (porsi.items[id] || 0) + 1;
    renderPorsi();
  });

  el('porsi-items').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const id = Number(b.dataset.id);
    if (b.dataset.act === 'inc') porsi.items[id]++;
    else { porsi.items[id]--; if (porsi.items[id] <= 0) delete porsi.items[id]; }
    renderPorsi();
  });

  el('btn-add-porsi').addEventListener('click', addPorsiToNota);
  el('nota-list').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-rm]'); if (!b) return;
    nota.splice(Number(b.dataset.rm), 1); renderNota();
  });
  el('btn-clear').addEventListener('click', () => {
    if (!nota.length) return;
    nota = []; renderNota();
  });
  el('btn-bayar').addEventListener('click', openPayment);
}

function renderKasir() { renderGrid(); renderPorsi(); renderNota(); }

function renderGrid() {
  const grid = el('topping-grid');
  const aktif = produkCache.filter((p) => p.aktif).sort((a, b) => (a.urutan || 0) - (b.urutan || 0));
  const cats = [...new Set(aktif.map((p) => p.kategori))];
  let html = '';
  cats.forEach((cat) => {
    if (cats.length > 1) html += `<div class="cat-head">${cat}</div>`;
    aktif.filter((p) => p.kategori === cat).forEach((p) => {
      const q = porsi.items[p.id] || 0;
      html += `<button class="item ${q ? 'picked' : ''}" data-id="${p.id}">
        ${q ? `<span class="qty">${q}</span>` : ''}
        <span class="nm">${escapeHtml(p.nama)}</span>
        <span class="pr">${rp(p.harga)}</span></button>`;
    });
  });
  grid.innerHTML = html || '<div class="empty">Belum ada menu aktif. Tambah di tab Menu.</div>';
}

function porsiSubtotal() {
  return Object.entries(porsi.items).reduce((s, [id, q]) => {
    const p = produkById(Number(id)); return s + (p ? p.harga * q : 0);
  }, 0);
}

function renderPorsi() {
  const box = el('porsi-items');
  const ids = Object.keys(porsi.items);
  if (!ids.length) {
    box.innerHTML = '<div class="empty">Belum ada topping dipilih</div>';
  } else {
    box.innerHTML = ids.map((id) => {
      const p = produkById(Number(id)); const q = porsi.items[id];
      return `<div class="line-item">
        <div class="grow"><div class="nm">${escapeHtml(p.nama)}</div>
          <div class="sub">${rp(p.harga)} × ${q} = ${rp(p.harga * q)}</div></div>
        <div class="stepper">
          <button data-act="dec" data-id="${id}">−</button>
          <span class="n">${q}</span>
          <button data-act="inc" data-id="${id}">+</button>
        </div></div>`;
    }).join('');
  }
  el('porsi-subtotal').textContent = rp(porsiSubtotal());
  el('btn-add-porsi').disabled = ids.length === 0;
  renderGrid();
}

function addPorsiToNota() {
  const items = Object.entries(porsi.items).map(([id, qty]) => {
    const p = produkById(Number(id));
    return { id: p.id, nama: p.nama, harga: p.harga, qty };
  });
  if (!items.length) return;
  const subtotal = items.reduce((s, it) => s + it.harga * it.qty, 0);
  nota.push({ level: porsi.level, penyajian: porsi.penyajian, items, subtotal });
  porsi.items = {}; // reset topping, pertahankan level & penyajian utk order berikutnya
  renderPorsi(); renderNota();
}

function notaTotal() { return nota.reduce((s, p) => s + p.subtotal, 0); }

function renderNota() {
  const box = el('nota-list');
  if (!nota.length) {
    box.innerHTML = '<div class="empty">Nota masih kosong</div>';
  } else {
    box.innerHTML = nota.map((p, i) => {
      const list = p.items.map((it) => `${it.qty}× ${escapeHtml(it.nama)}`).join(', ');
      return `<div class="porsi-card">
        <div class="head">
          <span class="tag">Lv ${p.level} · ${p.penyajian}</span>
          <span><b>${rp(p.subtotal)}</b> <button class="x" data-rm="${i}" title="hapus">✕</button></span>
        </div>
        <div class="list">${list}</div></div>`;
    }).join('');
  }
  el('nota-total').textContent = rp(notaTotal());
  el('btn-bayar').disabled = nota.length === 0;
}

/* ============================================================
   PEMBAYARAN
   ============================================================ */
let payMetode = 'tunai';
function setupPayment() { /* handlers dibuat saat modal dibuka */ }

async function openPayment() {
  if (!nota.length) return;
  const total = notaTotal();
  payMetode = 'tunai';
  const qris = await getMeta('qris', '');
  const root = el('modal-root');
  root.innerHTML = `
  <div class="modal-bg" id="pay-bg">
    <div class="modal">
      <h2>Pembayaran</h2>
      <div class="row"><span class="muted">Total</span><span class="big">${rp(total)}</span></div>
      <div class="pills" style="margin-top:12px" id="pay-metode">
        <button class="pill on" data-m="tunai">Tunai</button>
        <button class="pill" data-m="qris">QRIS</button>
      </div>
      <div id="pay-tunai">
        <div class="amount-grid" id="pay-quick">
          <button data-amt="${total}">Uang pas</button>
          <button data-amt="20000">20rb</button>
          <button data-amt="50000">50rb</button>
          <button data-amt="100000">100rb</button>
          <button data-amt="clear">Hapus</button>
          <button data-amt="add5">+5rb</button>
        </div>
        <div class="field"><label>Uang diterima</label>
          <input type="number" inputmode="numeric" id="pay-cash" placeholder="0"></div>
        <div class="row"><span class="muted">Kembalian</span>
          <span class="kembalian" id="pay-kembali">Rp0</span></div>
      </div>
      <div id="pay-qris" class="hidden" style="text-align:center">
        ${qris ? `<img src="${qris}" alt="QRIS" style="max-width:260px;width:100%;border-radius:12px;border:1px solid var(--line)">`
                : '<p class="muted">Belum ada gambar QRIS. Unggah di tab Setelan.</p>'}
        <p class="muted" style="font-size:14px">Pelanggan scan QRIS, lalu tekan Simpan.</p>
      </div>
      <button class="btn btn-primary" id="pay-save" style="margin-top:14px">Simpan</button>
      <button class="btn btn-add" id="pay-save-print" style="margin-top:8px">Simpan &amp; cetak struk</button>
      <button class="btn btn-ghost" id="pay-cancel">Batal</button>
    </div>
  </div>`;

  const cash = el('pay-cash');
  const updateKembali = () => {
    const bayar = Number(cash.value || 0);
    const k = bayar - total;
    const span = el('pay-kembali');
    span.textContent = (k < 0 ? '−' : '') + rp(Math.abs(k));
    span.classList.toggle('minus', k < 0);
  };
  cash.addEventListener('input', updateKembali);

  el('pay-metode').addEventListener('click', (e) => {
    const b = e.target.closest('.pill'); if (!b) return;
    payMetode = b.dataset.m;
    el('pay-metode').querySelectorAll('.pill').forEach((p) => p.classList.toggle('on', p.dataset.m === payMetode));
    el('pay-tunai').classList.toggle('hidden', payMetode !== 'tunai');
    el('pay-qris').classList.toggle('hidden', payMetode !== 'qris');
  });

  el('pay-quick').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const a = b.dataset.amt;
    if (a === 'clear') cash.value = '';
    else if (a === 'add5') cash.value = String(Number(cash.value || 0) + 5000);
    else cash.value = a;
    updateKembali();
  });

  el('pay-cancel').addEventListener('click', closeModal);
  el('pay-bg').addEventListener('click', (e) => { if (e.target.id === 'pay-bg') closeModal(); });
  el('pay-save').addEventListener('click', () => savePayment(total, false));
  el('pay-save-print').addEventListener('click', () => savePayment(total, true));
}

async function savePayment(total, doPrint) {
  let dibayar = total, kembalian = 0;
  if (payMetode === 'tunai') {
    dibayar = Number(el('pay-cash').value || 0);
    if (dibayar < total) { toast('Uang diterima kurang dari total'); return; }
    kembalian = dibayar - total;
  }
  const trx = {
    waktu: new Date().toISOString(),
    total, metode: payMetode, dibayar, kembalian,
    porsi: JSON.parse(JSON.stringify(nota))
  };
  try {
    const id = await put('transaksi', trx);
    trx.id = id;
  } catch (err) {
    toast('Gagal menyimpan transaksi'); return;
  }
  closeModal();
  nota = []; renderNota();
  toast('Transaksi tersimpan' + (kembalian ? ` · kembali ${rp(kembalian)}` : ''));
  if (doPrint) {
    try { await printReceipt(trx); }
    catch (err) { toast('Cetak gagal: ' + (err.message || 'periksa printer')); }
  }
}

function closeModal() { el('modal-root').innerHTML = ''; }

/* ============================================================
   LAPORAN
   ============================================================ */
function setupReportOnce() {
  if (setupReportOnce.done) return; setupReportOnce.done = true;
  el('rep-date').addEventListener('change', renderLaporan);
  el('rep-today').addEventListener('click', () => { el('rep-date').value = todayStr(); renderLaporan(); });
  el('btn-export').addEventListener('click', exportData);
}

async function renderLaporan() {
  setupReportOnce();
  const date = el('rep-date').value || todayStr();
  const all = await getAll('transaksi');
  const day = all.filter((t) => todayStr(new Date(t.waktu)) === date);

  const omzet = day.reduce((s, t) => s + t.total, 0);
  const tunai = day.filter((t) => t.metode === 'tunai').reduce((s, t) => s + t.total, 0);
  const qris = day.filter((t) => t.metode === 'qris').reduce((s, t) => s + t.total, 0);
  const jmlPorsi = day.reduce((s, t) => s + (t.porsi ? t.porsi.length : 0), 0);

  el('rep-stats').innerHTML = `
    <div class="stat"><div class="k">Omzet</div><div class="v">${rp(omzet)}</div></div>
    <div class="stat"><div class="k">Transaksi</div><div class="v">${day.length}</div></div>
    <div class="stat"><div class="k">Porsi terjual</div><div class="v">${jmlPorsi}</div></div>
    <div class="stat"><div class="k">Tunai / QRIS</div><div class="v" style="font-size:17px">${rp(tunai)} <span class="muted">/</span> ${rp(qris)}</div></div>`;

  // topping terlaris
  const agg = {};
  day.forEach((t) => (t.porsi || []).forEach((p) => p.items.forEach((it) => {
    if (!agg[it.nama]) agg[it.nama] = { qty: 0, total: 0 };
    agg[it.nama].qty += it.qty; agg[it.nama].total += it.harga * it.qty;
  })));
  const ranked = Object.entries(agg).sort((a, b) => b[1].qty - a[1].qty);
  el('rep-toplist').innerHTML = ranked.length
    ? `<table><thead><tr><th>Topping</th><th class="r">Terjual</th><th class="r">Nilai</th></tr></thead><tbody>${
        ranked.map(([nama, v]) => `<tr><td>${escapeHtml(nama)}</td><td class="r">${v.qty}×</td><td class="r">${rp(v.total)}</td></tr>`).join('')
      }</tbody></table>`
    : '<div class="empty">Belum ada penjualan pada tanggal ini</div>';

  // daftar transaksi
  el('rep-trx').innerHTML = day.length
    ? `<table><thead><tr><th>Jam</th><th>Porsi</th><th>Metode</th><th class="r">Total</th></tr></thead><tbody>${
        day.slice().reverse().map((t) => {
          const jam = new Date(t.waktu).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
          return `<tr><td>${jam}</td><td>${t.porsi ? t.porsi.length : 0}</td><td>${t.metode.toUpperCase()}</td><td class="r">${rp(t.total)}</td></tr>`;
        }).join('')
      }</tbody></table>`
    : '<div class="empty">—</div>';
}

/* ============================================================
   MENU (kelola produk & harga)
   ============================================================ */
function setupMenuOnce() {
  if (setupMenuOnce.done) return; setupMenuOnce.done = true;
  el('btn-add-produk').addEventListener('click', () => openProdukModal(null));
  el('menu-list').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-edit]');
    if (b) { openProdukModal(Number(b.dataset.edit)); return; }
    const t = e.target.closest('button[data-toggle]');
    if (t) toggleAktif(Number(t.dataset.toggle));
  });
}

async function toggleAktif(id) {
  const p = produkById(id); if (!p) return;
  p.aktif = !p.aktif; await put('produk', p);
  produkCache = await getAll('produk'); renderMenu(); renderGrid();
}

function renderMenu() {
  setupMenuOnce();
  const list = produkCache.slice().sort((a, b) => (a.urutan || 0) - (b.urutan || 0));
  el('menu-list').innerHTML = `<table><thead><tr><th>Menu</th><th>Kategori</th><th class="r">Harga</th><th class="r">Status</th><th></th></tr></thead><tbody>${
    list.map((p) => `<tr>
      <td>${escapeHtml(p.nama)}</td>
      <td class="muted">${p.kategori}</td>
      <td class="r">${rp(p.harga)}</td>
      <td class="r"><button class="pill ${p.aktif ? 'on' : ''}" data-toggle="${p.id}" style="min-height:34px;padding:5px 10px">${p.aktif ? 'Aktif' : 'Nonaktif'}</button></td>
      <td class="r"><button class="btn-install" data-edit="${p.id}" style="padding:6px 12px">Ubah</button></td>
    </tr>`).join('')
  }</tbody></table>`;
}

function openProdukModal(id) {
  const p = id ? produkById(id) : { nama: '', harga: 1000, kategori: 'topping', aktif: true };
  el('modal-root').innerHTML = `
  <div class="modal-bg" id="pm-bg"><div class="modal">
    <h2>${id ? 'Ubah menu' : 'Tambah menu'}</h2>
    <div class="field"><label>Nama</label><input type="text" id="pm-nama" value="${escapeAttr(p.nama)}"></div>
    <div class="field"><label>Harga</label><input type="number" inputmode="numeric" id="pm-harga" value="${p.harga}"></div>
    <div class="field"><label>Kategori</label>
      <div class="pills" id="pm-kat">
        ${['topping', 'minuman', 'lain'].map((k) => `<button class="pill ${p.kategori === k ? 'on' : ''}" data-k="${k}">${k}</button>`).join('')}
      </div></div>
    <button class="btn btn-primary" id="pm-save" style="margin-top:8px">Simpan</button>
    ${id ? '<button class="btn btn-ghost" id="pm-del">Hapus menu</button>' : ''}
    <button class="btn btn-ghost" id="pm-cancel">Batal</button>
  </div></div>`;
  let kat = p.kategori;
  el('pm-kat').addEventListener('click', (e) => {
    const b = e.target.closest('.pill'); if (!b) return;
    kat = b.dataset.k;
    el('pm-kat').querySelectorAll('.pill').forEach((x) => x.classList.toggle('on', x.dataset.k === kat));
  });
  el('pm-cancel').addEventListener('click', closeModal);
  el('pm-bg').addEventListener('click', (e) => { if (e.target.id === 'pm-bg') closeModal(); });
  el('pm-save').addEventListener('click', async () => {
    const nama = el('pm-nama').value.trim();
    const harga = Number(el('pm-harga').value || 0);
    if (!nama) { toast('Nama menu wajib diisi'); return; }
    if (harga < 0) { toast('Harga tidak valid'); return; }
    const rec = id
      ? { ...p, nama, harga, kategori: kat }
      : { nama, harga, kategori: kat, aktif: true, urutan: produkCache.length };
    await put('produk', rec);
    produkCache = await getAll('produk');
    closeModal(); renderMenu(); renderGrid();
    toast('Menu tersimpan');
  });
  if (id) el('pm-del').addEventListener('click', async () => {
    if (!confirm(`Hapus "${p.nama}"? Transaksi lama tetap aman.`)) return;
    await del('produk', id);
    produkCache = await getAll('produk');
    closeModal(); renderMenu(); renderGrid();
    toast('Menu dihapus');
  });
}

/* ============================================================
   SETELAN
   ============================================================ */
function setupSettings() {
  el('btn-save-set').addEventListener('click', async () => {
    await setMeta('nama', el('set-nama').value.trim() || 'Kasir Seblak');
    await setMeta('alamat', el('set-alamat').value.trim());
    el('brand-name').textContent = el('set-nama').value.trim() || 'Kasir Seblak';
    toast('Setelan disimpan');
  });
  el('qris-file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const dataURL = await fileToDataURL(f);
    await setMeta('qris', dataURL);
    renderQrisPreview(dataURL);
    toast('QRIS tersimpan');
  });
  el('btn-connect-printer').addEventListener('click', connectPrinter);
  el('btn-test-print').addEventListener('click', testPrint);
  el('btn-export2').addEventListener('click', exportData);
  el('import-file').addEventListener('change', importData);
}

async function renderSettings() {
  el('set-nama').value = await getMeta('nama', '');
  el('set-alamat').value = await getMeta('alamat', '');
  renderQrisPreview(await getMeta('qris', ''));
}
function renderQrisPreview(dataURL) {
  el('qris-preview').innerHTML = dataURL
    ? `<img src="${dataURL}" style="max-width:220px;width:100%;border-radius:12px;border:1px solid var(--line)">`
    : '<span class="muted" style="font-size:14px">Belum ada QRIS.</span>';
}
function fileToDataURL(f) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
}

/* ---------- Backup / restore ---------- */
async function exportData() {
  const data = {
    _app: 'kasir-seblak', _ver: 1, _exportedAt: new Date().toISOString(),
    produk: await getAll('produk'),
    transaksi: await getAll('transaksi'),
    meta: await getAll('meta')
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `backup-kasir-seblak-${todayStr()}.json`;
  a.click(); URL.revokeObjectURL(a.href);
  toast('Backup terunduh');
}
async function importData(e) {
  const f = e.target.files[0]; if (!f) return;
  e.target.value = '';
  if (!confirm('Pulihkan data dari file ini? Semua data saat ini akan diganti.')) return;
  try {
    const data = JSON.parse(await f.text());
    if (data._app !== 'kasir-seblak') throw new Error('File bukan backup yang valid');
    await clearStore('produk'); await clearStore('transaksi'); await clearStore('meta');
    for (const p of data.produk || []) await put('produk', p);
    for (const t of data.transaksi || []) await put('transaksi', t);
    for (const m of data.meta || []) await put('meta', m);
    produkCache = await getAll('produk');
    el('brand-name').textContent = await getMeta('nama', 'Kasir Seblak');
    renderKasir(); renderSettings();
    toast('Data berhasil dipulihkan');
  } catch (err) { toast('Gagal memulihkan: ' + err.message); }
}

/* ============================================================
   CETAK STRUK - Web Bluetooth (ESC/POS)
   ============================================================ */
const PRINT_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2'
];

async function connectPrinter() {
  if (!navigator.bluetooth) { toast('Perangkat/ browser ini tidak mendukung Web Bluetooth'); return; }
  try {
    el('printer-status').textContent = 'Mencari...';
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true, optionalServices: PRINT_SERVICES
    });
    const server = await device.gatt.connect();
    const services = await server.getPrimaryServices();
    let found = null;
    for (const s of services) {
      const chars = await s.getCharacteristics();
      for (const c of chars) {
        if (c.properties.write || c.properties.writeWithoutResponse) { found = c; break; }
      }
      if (found) break;
    }
    if (!found) throw new Error('karakteristik tulis tidak ditemukan');
    printerChar = found;
    device.addEventListener('gattserverdisconnected', () => {
      printerChar = null;
      const s = el('printer-status'); if (s) s.textContent = 'Terputus';
    });
    el('printer-status').textContent = 'Terhubung: ' + (device.name || 'printer');
    toast('Printer terhubung');
  } catch (err) {
    el('printer-status').textContent = 'Gagal terhubung';
    toast('Gagal: ' + (err.message || 'batal'));
  }
}

async function ensurePrinter() {
  if (printerChar) return true;
  await connectPrinter();
  return !!printerChar;
}

function encoder(str) {
  // ESC/POS umumnya ASCII/codepage; ganti karakter non-ASCII agar aman.
  const out = [];
  for (const ch of str) {
    const code = ch.charCodeAt(0);
    out.push(code < 128 ? code : 63); // '?'
  }
  return out;
}
function padLine(left, right, width = 32) {
  left = String(left); right = String(right);
  const space = width - left.length - right.length;
  if (space < 1) return (left + ' ' + right).slice(0, width) + '\n';
  return left + ' '.repeat(space) + right + '\n';
}

function buildReceipt(trx, nama, alamat) {
  const ESC = 0x1B, GS = 0x1D;
  let bytes = [];
  const push = (arr) => { bytes = bytes.concat(arr); };
  const text = (s) => push(encoder(s));

  push([ESC, 0x40]);            // init
  push([ESC, 0x61, 0x01]);      // center
  push([ESC, 0x21, 0x30]);      // double width+height
  text(nama + '\n');
  push([ESC, 0x21, 0x00]);      // normal
  if (alamat) text(alamat + '\n');
  const d = new Date(trx.waktu);
  text(d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) + '\n');
  push([ESC, 0x61, 0x00]);      // left
  text('--------------------------------\n');

  (trx.porsi || []).forEach((p, i) => {
    text(`Porsi ${i + 1}  [Lv ${p.level} - ${p.penyajian}]\n`);
    p.items.forEach((it) => {
      text(padLine(`  ${it.qty}x ${it.nama}`, fmt(it.harga * it.qty)));
    });
    text(padLine('  Subtotal', fmt(p.subtotal)));
  });

  text('--------------------------------\n');
  push([ESC, 0x21, 0x10]);      // double height
  text(padLine('TOTAL', 'Rp' + fmt(trx.total), 32));
  push([ESC, 0x21, 0x00]);
  text(padLine('Metode', trx.metode.toUpperCase()));
  if (trx.metode === 'tunai') {
    text(padLine('Tunai', fmt(trx.dibayar)));
    text(padLine('Kembali', fmt(trx.kembalian)));
  }
  text('--------------------------------\n');
  push([ESC, 0x61, 0x01]);      // center
  text('Terima kasih :)\n');
  text('\n\n\n');
  push([GS, 0x56, 0x00]);       // cut (diabaikan printer tanpa cutter)
  return new Uint8Array(bytes);
}

async function writeChunks(data) {
  const size = 180;
  for (let i = 0; i < data.length; i += size) {
    const chunk = data.slice(i, i + size);
    if (printerChar.properties.writeWithoutResponse && printerChar.writeValueWithoutResponse)
      await printerChar.writeValueWithoutResponse(chunk);
    else
      await printerChar.writeValue(chunk);
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function printReceipt(trx) {
  if (!(await ensurePrinter())) throw new Error('printer belum terhubung');
  const nama = await getMeta('nama', 'Kasir Seblak');
  const alamat = await getMeta('alamat', '');
  await writeChunks(buildReceipt(trx, nama, alamat));
}

async function testPrint() {
  const demo = {
    waktu: new Date().toISOString(), total: 5000, metode: 'tunai', dibayar: 10000, kembalian: 5000,
    porsi: [{ level: 3, penyajian: 'kuah', items: [{ nama: 'Cilok', harga: 1000, qty: 2 }, { nama: 'Bakso', harga: 1000, qty: 3 }], subtotal: 5000 }]
  };
  try { await printReceipt(demo); toast('Tes cetak terkirim'); }
  catch (err) { toast('Gagal: ' + err.message); }
}

/* ============================================================
   PWA: service worker, install prompt, status koneksi
   ============================================================ */
function setupPWA() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); deferredPrompt = e;
    el('btn-install').classList.remove('hidden');
  });
  el('btn-install').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt(); await deferredPrompt.userChoice;
    deferredPrompt = null; el('btn-install').classList.add('hidden');
  });
  const setNet = () => {
    const d = el('netdot');
    d.classList.toggle('off', !navigator.onLine);
    d.title = navigator.onLine ? 'online' : 'offline (kasir tetap jalan)';
  };
  window.addEventListener('online', setNet);
  window.addEventListener('offline', setNet);
  setNet();
}

/* ---------- escaping ---------- */
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function escapeAttr(s) { return escapeHtml(s); }

boot().catch((err) => {
  document.body.innerHTML = '<p style="padding:24px">Gagal memuat aplikasi: ' + escapeHtml(err.message) + '</p>';
});
