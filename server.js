const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static HTML, CSS, client scripts, and assets directly from the project root
app.use(express.static(__dirname));

// ====================================================
// 1. CONFIGURATION & STATE PERSISTENCE
// ====================================================
const HOST_PASSWORD = process.env.HOST_PASSWORD || "tigasan41";
const STATE_FILE = path.join(__dirname, 'gamestate.json');
const DEFAULT_TITLE = "Tagisan 41 Quiz Show";
const FALLBACK_SCHOOLS = [
    "University of the Philippines Diliman",
    "Ateneo de Manila University",
    "De La Salle University"
];

function createInitialGameState() {
    return {
        title: DEFAULT_TITLE,
        players: [],
        wrongAttempts: 0,
        failedTeamKeys: [],
        showScores: false
    };
}

// Restore the last saved match from disk if available so scores survive restarts
function loadGameState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const raw = fs.readFileSync(STATE_FILE, 'utf8');
            const parsed = JSON.parse(raw);

            if (parsed && Array.isArray(parsed.players)) {
                // Mark everyone offline on boot; reloading clients will flip themselves back to connected
                const players = parsed.players.map(p => ({
                    ...p,
                    number: String(p.number),
                    score: Number(p.score) || 0,
                    status: p.status || 'locked',
                    connected: false
                }));

                return {
                    title: parsed.title || DEFAULT_TITLE,
                    players,
                    wrongAttempts: Number(parsed.wrongAttempts) || 0,
                    failedTeamKeys: Array.isArray(parsed.failedTeamKeys) ? parsed.failedTeamKeys : [],
                    showScores: Boolean(parsed.showScores)
                };
            }
        }
    } catch (err) {
        console.error("Failed to load gamestate.json:", err);
    }

    return createInitialGameState();
}

function saveGameState() {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(gameState, null, 2), 'utf8');
    } catch (err) {
        console.error("Failed to save gamestate.json:", err);
    }
}

let gameState = loadGameState();

function lockAllUnlessBuzzed() {
    const anyoneBuzzed = gameState.players.some(p => p.status === 'buzzed');
    if (!anyoneBuzzed) {
        gameState.players.forEach(p => { p.status = 'locked'; });
    }
}

// ====================================================
// 2. SCHOOL & LOGO HELPERS
// ====================================================
function getTeamKey(player) {
    return `${player.school}::${String(player.number)}`;
}

function normalizeSchoolName(school) {
    return String(school || '').trim().toLowerCase();
}

// One active buzzer per school: checks whether another live socket already owns this school
function isSchoolActive(school, excludeSocketId = null) {
    const normalized = normalizeSchoolName(school);
    if (!normalized) return false;

    return gameState.players.some(
        p => p.connected && p.id !== excludeSocketId && normalizeSchoolName(p.school) === normalized
    );
}

// Read the school dropdown options from schools.txt (one school per line)
function getSchoolList() {
    try {
        const filePath = path.join(__dirname, 'schools.txt');
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            return data.split('\n').map(s => s.trim()).filter(Boolean);
        }
    } catch (err) {
        console.error("Error reading schools.txt:", err);
    }
    return FALLBACK_SCHOOLS;
}

// Map each filename slug in assets/logos to its real path so any image extension works on spectator.html
function getSchoolLogoMap() {
    const logoMap = {};
    const logosDir = path.join(__dirname, 'assets', 'logos');
    const imageExtRe = /\.(png|jpe?g|webp|jfif|svg|gif|avif|bmp|ico|tiff?)$/i;

    try {
        if (!fs.existsSync(logosDir)) return logoMap;

        for (const file of fs.readdirSync(logosDir)) {
            if (!imageExtRe.test(file)) continue;
            const ext = path.extname(file);
            const slug = path.basename(file, ext).toLowerCase();

            // Prefer lowercase .png if both a .png and another format share the same slug
            if (!logoMap[slug] || ext === '.png') {
                logoMap[slug] = `assets/logos/${encodeURIComponent(file)}`;
            }
        }
    } catch (err) {
        console.error("Error reading assets/logos:", err);
    }
    return logoMap;
}

// ====================================================
// 3. SOCKET.IO REAL-TIME GAME EVENTS
// ====================================================
io.on('connection', (socket) => {
    // Send logos before initial gameState so the spectator view resolves images immediately
    socket.emit('schoolLogos', getSchoolLogoMap());
    socket.emit('updateState', gameState);
    socket.emit('schoolList', getSchoolList());

    // Pre-flight check from index.html before redirecting a player to the buzzer screen
    socket.on('checkSchoolAvailability', (school, callback) => {
        if (typeof callback !== 'function') return;

        const schoolName = String(school || '').trim();
        if (!schoolName) {
            callback({ ok: false, message: 'Please enter a valid school name.' });
            return;
        }
        if (isSchoolActive(schoolName, socket.id)) {
            callback({ ok: false, message: `${schoolName} is already active in the game.` });
            return;
        }
        callback({ ok: true });
    });

    // Register a new player or restore a disconnected team's score and round status
    socket.on('playerJoin', (playerData) => {
        if (!playerData || !playerData.school) return;

        const schoolName = String(playerData.school).trim();
        if (!schoolName) return;

        if (isSchoolActive(schoolName, socket.id)) {
            socket.emit('joinError', { message: `${schoolName} is already active in the game.` });
            return;
        }

        const playerNum = String(playerData.number);
        const normalizedSchool = normalizeSchoolName(schoolName);

        const existing = gameState.players.find(p => normalizeSchoolName(p.school) === normalizedSchool);

        if (existing) {
            existing.id = socket.id;
            existing.school = schoolName;
            existing.number = playerNum;
            existing.connected = true;
            // Preserve 'buzzed' if the buzzed-in player reconnects; otherwise lock until host unlocks
            if (existing.status !== 'buzzed') {
                existing.status = 'locked';
            }
        } else {
            gameState.players.push({
                id: socket.id,
                school: schoolName,
                number: playerNum,
                score: 0,
                status: 'locked',
                connected: true
            });
        }

        // Lock everyone on join/reconnect unless someone is currently buzzed in
        lockAllUnlessBuzzed();

        io.emit('schoolLogos', getSchoolLogoMap());
        saveGameState();
        io.emit('updateState', gameState);
    });

    // First ready player to buzz locks everyone else out immediately
    socket.on('playerBuzz', () => {
        const alreadyBuzzed = gameState.players.some(p => p.status === 'buzzed');
        if (alreadyBuzzed) return;

        const player = gameState.players.find(p => p.id === socket.id);
        if (!player || player.status !== 'ready') return;

        player.status = 'buzzed';
        gameState.players.forEach(p => {
            if (p.status === 'ready') p.status = 'locked';
        });

        saveGameState();
        io.emit('updateState', gameState);
    });

    // Authenticate host session before allowing host.html access or host actions
    socket.on('verifyHost', (password, callback) => {
        const ok = password === HOST_PASSWORD;
        if (ok) socket.data.isHost = true;
        if (typeof callback === 'function') callback({ ok });
    });

    // Handle host panel actions (title, lock/unlock, judging, manual scores, reset)
    socket.on('hostAction', (actionData) => {
        if (!actionData) return;
        if (!socket.data.isHost && actionData.password !== HOST_PASSWORD) return;

        switch (actionData.type) {
            case 'updateTitle':
                gameState.title = actionData.title;
                break;

            case 'lockAll':
                gameState.players.forEach(p => { p.status = 'locked'; });
                break;

            case 'unlockAll':
                gameState.wrongAttempts = 0;
                gameState.failedTeamKeys = [];
                gameState.players.forEach(p => { p.status = 'ready'; });
                break;

            case 'correct': {
                const buzzed = gameState.players.find(p => p.status === 'buzzed');
                if (buzzed) buzzed.score += 1;
                gameState.wrongAttempts = 0;
                gameState.failedTeamKeys = [];
                gameState.players.forEach(p => { p.status = 'locked'; });
                break;
            }

            case 'wrong': {
                const buzzed = gameState.players.find(p => p.status === 'buzzed');
                if (buzzed) {
                    buzzed.status = 'locked';
                    const key = getTeamKey(buzzed);
                    if (!gameState.failedTeamKeys.includes(key)) {
                        gameState.failedTeamKeys.push(key);
                    }
                    gameState.wrongAttempts += 1;
                }

                // After 3 wrong attempts, lock everyone out; otherwise reopen for steals
                if (gameState.wrongAttempts >= 3) {
                    gameState.players.forEach(p => { p.status = 'locked'; });
                } else {
                    gameState.players.forEach(p => {
                        if (!gameState.failedTeamKeys.includes(getTeamKey(p))) {
                            p.status = 'ready';
                        }
                    });
                }
                break;
            }

            case 'adjustScore': {
                const player = gameState.players[actionData.index];
                if (player) {
                    const delta = actionData.delta > 0 ? 1 : -1;
                    player.score = Math.max(0, player.score + delta);
                }
                break;
            }

            case 'resetScores':
                gameState.wrongAttempts = 0;
                gameState.failedTeamKeys = [];
                // Prune disconnected players and reset active players without disconnecting anyone
                gameState.players = gameState.players
                    .filter(p => p.connected)
                    .map(p => ({
                        ...p,
                        score: 0,
                        status: 'locked'
                    }));
                break;

            case 'toggleScores':
                gameState.showScores = !gameState.showScores;
                break;

            default:
                return;
        }

        saveGameState();
        io.emit('updateState', gameState);
    });

    // Keep disconnected players in gameState so their scores survive page reloads and drops
    socket.on('disconnect', () => {
        const player = gameState.players.find(p => p.id === socket.id);
        if (!player) return;

        player.connected = false;
        // Lock everyone on player disconnect unless someone is currently buzzed in
        lockAllUnlessBuzzed();
        saveGameState();
        io.emit('updateState', gameState);
    });
});

// ====================================================
// 4. SERVER STARTUP
// ====================================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log('Tagisan Buzzer is running!');
    console.log(`  Host (this laptop):  http://localhost:${PORT}/index.html`);

    // Print local Wi-Fi/LAN IPv4 URLs for player phones and the projector laptop
    const nets = require('os').networkInterfaces();
    Object.values(nets).flat().forEach((n) => {
        if (n && n.family === 'IPv4' && !n.internal) {
            console.log(`  Players / Spectator: http://${n.address}:${PORT}/index.html`);
        }
    });
});
