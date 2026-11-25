/**
 * Stash Server - Backend HTTP & REST API lokal untuk mengelola daftar tugas
 * dilengkapi sistem autentikasi pengguna (Sign In & Sign Up) mandiri.
 * Menggunakan modul bawaan Node.js tanpa dependensi eksternal.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'tasks.json');
const USERS_FILE = path.join(__dirname, 'users.json');
const SESSIONS_FILE = path.join(__dirname, 'sessions.json');
const HTML_FILE = path.join(__dirname, 'index.html');

// Helper untuk membaca file JSON secara aman
function readJsonFile(filePath, fallback = []) {
    if (!fs.existsSync(filePath)) {
        try {
            fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2), 'utf8');
        } catch (_) {}
        return fallback;
    }
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        if (!raw || !raw.trim()) return fallback;
        return JSON.parse(raw);
    } catch (_) {
        return fallback;
    }
}

// Helper untuk menulis file JSON
function writeJsonFile(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (err) {
        console.error(`Gagal menulis ke ${filePath}:`, err);
        return false;
    }
}

// Inisialisasi file-file database
readJsonFile(DATA_FILE, []);
readJsonFile(USERS_FILE, []);

// In-memory Session Store dengan persistensi sessions.json
const sessions = new Map();
const initialSessions = readJsonFile(SESSIONS_FILE, []);
const now = Date.now();
if (Array.isArray(initialSessions)) {
    for (const s of initialSessions) {
        if (s && s.token && s.expiresAt > now) {
            sessions.set(s.token, {
                userId: s.userId,
                username: s.username,
                expiresAt: s.expiresAt
            });
        }
    }
}

function persistSessions() {
    const list = [];
    const currentTime = Date.now();
    for (const [token, data] of sessions.entries()) {
        if (data.expiresAt > currentTime) {
            list.push({ token, ...data });
        }
    }
    writeJsonFile(SESSIONS_FILE, list);
}

// Fungsi hashing password menggunakan scrypt bawaan Node.js
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return { hash, salt };
}

function verifyPassword(password, hash, salt) {
    try {
        const verifyHash = crypto.scryptSync(password, salt, 64).toString('hex');
        return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(verifyHash, 'hex'));
    } catch (_) {
        return false;
    }
}

function createSession(user) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // Aktif 30 hari
    sessions.set(token, {
        userId: user.id,
        username: user.username,
        expiresAt
    });
    persistSessions();
    return token;
}

function getAuthUser(req) {
    const authHeader = req.headers['authorization'] || req.headers['x-auth-token'] || '';
    let token = '';
    if (authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7).trim();
    } else {
        token = authHeader.trim();
    }
    if (!token) return null;

    const session = sessions.get(token);
    if (!session) return null;

    if (Date.now() > session.expiresAt) {
        sessions.delete(token);
        persistSessions();
        return null;
    }

    return session;
}

function deleteSession(req) {
    const authHeader = req.headers['authorization'] || req.headers['x-auth-token'] || '';
    let token = '';
    if (authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7).trim();
    } else {
        token = authHeader.trim();
    }
    if (token && sessions.has(token)) {
        sessions.delete(token);
        persistSessions();
    }
}

// Helper parsing JSON body
function parseJsonBody(req, limit = 5 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk;
            if (body.length > limit) {
                req.destroy();
                reject(new Error('PAYLOAD_TOO_LARGE'));
            }
        });
        req.on('error', err => reject(err));
        req.on('end', () => {
            if (!body || !body.trim()) {
                return resolve({});
            }
            try {
                const parsed = JSON.parse(body);
                resolve(parsed);
            } catch (err) {
                reject(new Error('INVALID_JSON'));
            }
        });
    });
}

function sendJson(res, statusCode, data) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

// Inisialisasi HTTP server
const server = http.createServer(async (req, res) => {
    // Pengaturan header CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-auth-token');

    // Tangani preflight request OPTIONS
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // Parsing URL
    const host = req.headers.host || 'localhost';
    let pathname = '/';
    try {
        const parsedUrl = new URL(req.url, `http://${host}`);
        pathname = parsedUrl.pathname;
    } catch (_) {
        sendJson(res, 400, { error: 'URL tidak valid' });
        return;
    }

    // ==========================================
    // AUTH ROUTE: POST /api/auth/register
    // ==========================================
    if (pathname === '/api/auth/register' && req.method === 'POST') {
        try {
            const body = await parseJsonBody(req);
            const rawUsername = typeof body.username === 'string' ? body.username.trim() : '';
            const password = typeof body.password === 'string' ? body.password : '';

            // Validasi nama pengguna (3-30 karakter, alfanumerik & underscore)
            if (!/^[a-zA-Z0-9_]{3,30}$/.test(rawUsername)) {
                sendJson(res, 400, {
                    error: 'Nama pengguna harus 3-30 karakter dan hanya boleh berisi huruf, angka, atau garis bawah (_).'
                });
                return;
            }

            // Validasi kata sandi (minimal 6 karakter)
            if (!password || password.length < 6) {
                sendJson(res, 400, {
                    error: 'Kata sandi minimal harus 6 karakter.'
                });
                return;
            }

            const users = readJsonFile(USERS_FILE, []);
            const userExists = users.some(u => u.username.toLowerCase() === rawUsername.toLowerCase());
            if (userExists) {
                sendJson(res, 409, {
                    error: 'Nama pengguna sudah digunakan. Silakan pilih nama lain.'
                });
                return;
            }

            const { hash, salt } = hashPassword(password);
            const newUser = {
                id: crypto.randomUUID(),
                username: rawUsername,
                passwordHash: hash,
                salt: salt,
                createdAt: new Date().toISOString()
            };

            users.push(newUser);
            writeJsonFile(USERS_FILE, users);

            const token = createSession(newUser);
            sendJson(res, 201, {
                success: true,
                token,
                user: { id: newUser.id, username: newUser.username }
            });
        } catch (err) {
            if (err.message === 'PAYLOAD_TOO_LARGE') {
                sendJson(res, 413, { error: 'Payload terlalu besar' });
            } else {
                sendJson(res, 400, { error: 'Permintaan tidak valid' });
            }
        }
        return;
    }

    // ==========================================
    // AUTH ROUTE: POST /api/auth/login
    // ==========================================
    if (pathname === '/api/auth/login' && req.method === 'POST') {
        try {
            const body = await parseJsonBody(req);
            const rawUsername = typeof body.username === 'string' ? body.username.trim() : '';
            const password = typeof body.password === 'string' ? body.password : '';

            if (!rawUsername || !password) {
                sendJson(res, 400, { error: 'Nama pengguna dan kata sandi wajib diisi.' });
                return;
            }

            const users = readJsonFile(USERS_FILE, []);
            const user = users.find(u => u.username.toLowerCase() === rawUsername.toLowerCase());

            if (!user || !verifyPassword(password, user.passwordHash, user.salt)) {
                sendJson(res, 401, { error: 'Nama pengguna atau kata sandi tidak cocok.' });
                return;
            }

            const token = createSession(user);
            sendJson(res, 200, {
                success: true,
                token,
                user: { id: user.id, username: user.username }
            });
        } catch (err) {
            sendJson(res, 400, { error: 'Permintaan tidak valid' });
        }
        return;
    }

    // ==========================================
    // AUTH ROUTE: GET /api/auth/me
    // ==========================================
    if (pathname === '/api/auth/me' && req.method === 'GET') {
        const auth = getAuthUser(req);
        if (!auth) {
            sendJson(res, 401, { error: 'Sesi belum aktif atau telah berakhir.' });
            return;
        }
        sendJson(res, 200, {
            user: { id: auth.userId, username: auth.username }
        });
        return;
    }

    // ==========================================
    // AUTH ROUTE: POST /api/auth/logout
    // ==========================================
    if (pathname === '/api/auth/logout' && req.method === 'POST') {
        deleteSession(req);
        sendJson(res, 200, { success: true });
        return;
    }

    // ==========================================
    // TASKS ROUTE: GET /api/tasks
    // ==========================================
    if (pathname === '/api/tasks' && req.method === 'GET') {
        const auth = getAuthUser(req);
        if (!auth) {
            sendJson(res, 401, { error: 'Harap masuk terlebih dahulu untuk mengakses daftar tugas.' });
            return;
        }

        const allTasks = readJsonFile(DATA_FILE, []);
        // Filter hanya tugas milik pengguna yang sedang terautentikasi
        const userTasks = Array.isArray(allTasks) ? allTasks.filter(t => t.userId === auth.userId) : [];
        sendJson(res, 200, userTasks);
        return;
    }

    // ==========================================
    // TASKS ROUTE: POST /api/tasks
    // ==========================================
    if (pathname === '/api/tasks' && req.method === 'POST') {
        const auth = getAuthUser(req);
        if (!auth) {
            sendJson(res, 401, { error: 'Harap masuk terlebih dahulu untuk menyimpan tugas.' });
            return;
        }

        try {
            const incomingTasks = await parseJsonBody(req);
            if (!Array.isArray(incomingTasks)) {
                sendJson(res, 400, { error: 'Data harus berupa array tugas.' });
                return;
            }

            const allTasks = readJsonFile(DATA_FILE, []);
            // Pertahankan tugas milik user lain tanpa mengubahnya
            const otherUsersTasks = Array.isArray(allTasks) ? allTasks.filter(t => t.userId !== auth.userId) : [];
            // Pastikan setiap tugas user memiliki userId yang sesuai
            const userTasks = incomingTasks.map(t => ({
                ...t,
                userId: auth.userId
            }));

            const updatedTasks = [...otherUsersTasks, ...userTasks];
            const saved = writeJsonFile(DATA_FILE, updatedTasks);

            if (!saved) {
                sendJson(res, 500, { error: 'Gagal menyimpan ke berkas tugas.' });
                return;
            }

            sendJson(res, 200, { success: true, count: userTasks.length });
        } catch (err) {
            if (err.message === 'PAYLOAD_TOO_LARGE') {
                sendJson(res, 413, { error: 'Payload terlalu besar' });
            } else {
                sendJson(res, 400, { error: 'Format JSON tidak valid' });
            }
        }
        return;
    }

    // ==========================================
    // STATIC ROUTE: Menyajikan index.html
    // ==========================================
    if (pathname === '/' || pathname === '/index.html') {
        fs.readFile(HTML_FILE, 'utf8', (err, data) => {
            if (err) {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Berkas index.html tidak ditemukan');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(data);
        });
        return;
    }

    // Rute tidak dikenal (404 Not Found)
    sendJson(res, 404, { error: 'Endpoint tidak ditemukan' });
});

// Menjalankan server pada port yang ditentukan
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
