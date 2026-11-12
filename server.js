const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// =========================================================================
// [GARIS PEMBERITAHU: KONEKSI DATABASE / STORAGE FLAT-FILE]
// Lokasi: tasks.json digunakan sebagai database lokal berbasis file JSON.
// Di sini server mengecek apakah database sudah ada; jika belum, otomatis dibuat.
// =========================================================================
const DATA_FILE = path.join(__dirname, 'tasks.json');
const HTML_FILE = path.join(__dirname, 'index.html');

// Inisialisasi tasks.json jika belum ada
if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2), 'utf8');
}

// =========================================================================
// [GARIS PEMBERITAHU: SERVER HTTP NATIVE & PENANGANAN CORS]
// Server dibuat murni menggunakan modul bawaan 'http' Node.js tanpa framework Express.
// Mengatur CORS manual agar API bisa diakses lintas origin/port & menangani OPTIONS preflight.
// =========================================================================
const server = http.createServer((req, res) => {
    // Header CORS agar fleksibel jika diakses dari port lain
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    const pathname = parsedUrl.pathname;

    // =====================================================================
    // [GARIS PEMBERITAHU: ENDPOINT GET /api/tasks (BACA DARI DATABASE)]
    // Membaca file database tasks.json dan mengirimkannya sebagai format JSON ke client.
    // =====================================================================
    if (pathname === '/api/tasks' && req.method === 'GET') {
        fs.readFile(DATA_FILE, 'utf8', (err, data) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Gagal membaca data tugas' }));
                return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(data || '[]');
        });
        return;
    }

    // =====================================================================
    // [GARIS PEMBERITAHU: ENDPOINT POST /api/tasks (SIMPAN/UPDATE DATABASE)]
    // Menerima data stream JSON dari frontend, memvalidasi array, lalu menulis ulang
    // isi file tasks.json sebagai persistensi data.
    // =====================================================================
    if (pathname === '/api/tasks' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => {
            body += chunk;
        });

        req.on('end', () => {
            try {
                const tasks = JSON.parse(body);
                if (!Array.isArray(tasks)) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Data harus berupa array tugas' }));
                    return;
                }

                fs.writeFile(DATA_FILE, JSON.stringify(tasks, null, 2), 'utf8', err => {
                    if (err) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Gagal menyimpan ke file' }));
                        return;
                    }
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, count: tasks.length }));
                });
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Format JSON tidak valid' }));
            }
        });
        return;
    }

    // =====================================================================
    // [GARIS PEMBERITAHU: ROUTING STATIC FILE (index.html)]
    // Menyajikan file HTML frontend utama secara langsung ke browser.
    // =====================================================================
    if (pathname === '/' || pathname === '/index.html') {
        fs.readFile(HTML_FILE, 'utf8', (err, data) => {
            if (err) {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('File index.html tidak ditemukan');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(data);
        });
        return;
    }

    // Route tidak ditemukan
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
});

// =========================================================================
// [GARIS PEMBERITAHU: MENJALANKAN SERVER]
// Server mulai mendengarkan request pada port yang ditentukan (default: 3000).
// =========================================================================
server.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`🚀 Stash Server berhasil dijalankan!`);
    console.log(`📍 Buka di browser: http://localhost:${PORT}`);
    console.log(`💾 Data disimpan di: ${DATA_FILE}`);
    console.log(`========================================\n`);
});
