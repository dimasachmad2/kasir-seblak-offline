# Kasir Seblak — PWA offline-first

Kasir sederhana untuk warung seblak à la carte. Jalan penuh **offline**, data
tersimpan di dalam perangkat (IndexedDB), tanpa server dan tanpa biaya bulanan.

## Fitur
- Input pesanan cepat: pilih topping → atur qty → set **level pedas 0–5** dan
  **penyajian (kuah/nyemek/kering)** per porsi. Satu nota bisa banyak porsi campur.
- Pembayaran **tunai** (auto-kembalian + tombol nominal cepat) dan **QRIS statis**
  (unggah gambar QR warung sendiri).
- **Laporan harian**: omzet, jumlah transaksi, porsi terjual, tunai vs QRIS, dan
  **topping terlaris**.
- **Kelola menu & harga** sendiri (tambah/ubah/nonaktifkan). Harga di-*snapshot* di
  tiap transaksi, jadi laporan lama tetap akurat walau harga diubah.
- **Cetak struk** ke printer thermal Bluetooth (ESC/POS) via Web Bluetooth.
- **Backup / pulihkan** semua data ke/dari file JSON.
- Installable ke home screen (tampak seperti aplikasi).

## Menu awal (seed)
19 topping sudah terisi otomatis saat pertama dibuka (Sosis Besar Rp3.000; Fish
Roll, Dumpling Ayam/Keju, Odeng, Kaki Gurita Rp2.000; sisanya Rp1.000). Semua bisa
diubah di tab **Menu**.

## Cara deploy (pilih salah satu, semua gratis + HTTPS)
Aplikasi ini file statis. **Harus diakses lewat HTTPS** agar service worker (offline)
dan Web Bluetooth (cetak struk) berfungsi — jangan dibuka langsung sebagai `file://`.

- **Netlify Drop**: buka app.netlify.com/drop, seret folder ini. Selesai.
- **Vercel**: `vercel` di folder ini, atau import repo.
- **GitHub Pages**: push folder ke repo, aktifkan Pages. (Semua path sudah relatif,
  jadi aman walau di subpath seperti `username.github.io/repo/`.)

Lalu buka URL-nya di **tablet Android + Chrome**, tekan menu ⋮ → *Install app*.

## Syarat cetak struk (penting)
- Wajib **Chrome/Edge di Android** (Web Bluetooth tidak ada di iOS/Safari).
- Wajib diakses via **HTTPS**.
- Buka tab **Setelan → Hubungkan printer**, pilih printer thermal Bluetooth-mu,
  lalu **Tes cetak**.
- Printer thermal murah punya UUID service berbeda-beda. Kode sudah mencoba beberapa
  UUID umum di `PRINT_SERVICES` (app.js). Kalau printer tidak terdeteksi, tambahkan
  UUID service printer-mu ke daftar itu.

## Catatan penyimpanan
Data hanya ada di perangkat ini. Kalau tablet rusak atau data browser terhapus,
transaksi ikut hilang. **Rutin tekan “Backup data”** (tab Laporan atau Setelan) dan
simpan file JSON-nya di tempat aman.

## Struktur file
- `index.html` — UI + gaya
- `app.js` — seluruh logika (IndexedDB, pesanan, bayar, laporan, menu, cetak, backup)
- `service-worker.js` — cache offline
- `manifest.json` + `icon-*.png` — konfigurasi PWA

## Pengembangan lanjutan
Skema sengaja dibuat ramah pertumbuhan. Untuk multi-user / multi-cabang nanti:
tambah `cabang_id` pada `transaksi` & `produk`, tambah store `pengguna`, dan pindahkan
sumber data dari IndexedDB lokal ke backend (mis. Laravel/Postgres) dengan lapisan
sinkronisasi — model data porsi/item + snapshot harga tetap sama.
