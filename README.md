# MongoDB -> ClickHouse schema optimization agent

CLI lokal untuk dua hal:

1. `convert-mongo` - introspeksi collection MongoDB, propose DDL ClickHouse yang optimized.
2. `check-clickhouse` - assess apakah tabel ClickHouse existing sudah optimal.

Kedua command menghasilkan report markdown dengan 6 bagian: current structure,
proposed structure, column review matrix, partitioning (purpose & why),
engine (purpose & why), final recommendation.

**Tidak ada DDL yang dieksekusi otomatis.** Semua output adalah proposal untuk
direview manusia lalu dijalankan manual.

## Install

```bash
cd mongo_ch_agent
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # lalu isi MONGO_URI, CLICKHOUSE_*, ANTHROPIC_API_KEY
```

## Pemakaian

```bash
# Konversi MongoDB -> proposed ClickHouse DDL
python cli.py convert-mongo \
  --mongo-uri "mongodb://localhost:27017" \
  --mongo-db mydb \
  --collection events \
  --ch-database analytics \
  --ch-table events \
  --sample-size 2000

# Assess tabel ClickHouse existing
python cli.py check-clickhouse \
  --host localhost --port 8123 --user default --password "" \
  --database analytics --table events \
  --days 30
```

Report tersimpan di `./reports/<nama>_<timestamp>.md`.

## Yang perlu kamu tahu sebelum percaya hasilnya

Ini bukan disclaimer basa-basi - ini bagian penting dari cara membaca output-nya.

- **`confidence` di column review matrix bukan formalitas.** `high` berarti
  keputusan itu murni dari data terobservasi (tipe, range, cardinality).
  `needs_review` berarti itu masih asumsi soal workload (akses pattern,
  perilaku update) yang belum dikonfirmasi. Jangan treat keduanya sama saat
  approve DDL untuk production.

- **`convert-mongo` tidak punya query log** (tabel targetnya belum ada), jadi
  `ORDER BY` yang diusulkan berbasis index MongoDB existing sebagai *proxy* -
  bukan konfirmasi. Setelah data masuk ke ClickHouse dan ada beberapa minggu
  traffic query nyata, jalankan `check-clickhouse` untuk validasi ulang
  `ORDER BY` berdasarkan `system.query_log` yang sebenarnya.

- **`check-clickhouse` lebih kuat untuk `ORDER BY`** karena membaca
  `system.query_log` sungguhan - tapi ekstraksi kolom filter/group-by dari
  teks query dilakukan oleh Claude, bukan SQL parser penuh. Untuk query yang
  sangat kompleks (banyak subquery/CTE bersarang), verifikasi manual tetap
  disarankan sebelum mengubah `ORDER BY` tabel production (perubahan
  `ORDER BY` di ClickHouse butuh rebuild tabel, jadi mahal untuk dibatalkan).

- **Sampling MongoDB itu statistik, bukan exhaustive.** Kalau ada schema
  drift (field berubah tipe/arti seiring waktu, field per-tenant berbeda),
  hasil introspeksi bisa tidak merepresentasikan seluruh data. Naikkan
  `--sample-size` untuk collection besar/heterogen.

- **Nested document/array heterogen** ditandai `needs_review` dan
  diserahkan ke Claude untuk usulan strategi (flatten / Tuple / JSON type) -
  ini keputusan desain, bukan fakta objektif, jadi masih perlu judgment
  manusia terutama kalau struktur nested-nya bervariasi antar dokumen.

- **`get_cardinality_ratios` menjalankan satu query `uniq()` per kolom
  string.** Cepat untuk beberapa kolom kandidat, tapi untuk tabel dengan
  ratusan kolom string, pertimbangkan menambahkan `SAMPLE` clause di
  `agent/clickhouse_introspect.py` daripada full scan.

- **Rekomendasi engine (`ReplacingMergeTree` vs `MergeTree`) ditebak dari
  nama field** (`updated_at`, `version`, dst). Kalau collection kamu
  mutable tapi tidak punya field versi yang jelas, agent tidak akan
  mendeteksinya - override manual kalau perlu.

## Struktur project

```
cli.py                        entrypoint Typer
agent/
  config.py                   env/config loading
  mongo_introspect.py          sampling & type inference MongoDB
  clickhouse_introspect.py      DDL, compression, partition, query_log
  mapping_rules.py              rules engine deterministik (satu-satunya
                                 yang memutuskan tipe/codec/engine)
  llm_reasoning.py               satu-satunya modul yang manggil Claude -
                                 hanya untuk judgment call, bukan mapping tipe
  ddl_builder.py                 render keputusan jadi CREATE TABLE
  report.py                      assemble 6 bagian jadi markdown
```
