const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

const HOST_PASSWORD = process.env.HOST_PASSWORD || "tigasan41";
const STATE_FILE = path.join(__dirname, 'gamestate.json');

function getTeamKey(player) {
    return `${player.school}::${String(player.number)}`;
}

function normalizeSchoolName(school) {
    return String(school || '').trim().toLowerCase();
}

function isSchoolActive(school, excludeSocketId = null) {
    const normalized = normalizeSchoolName(school);
    if (!normalized) return false;
    return gameState.players.some(
        p => p.connected && p.id !== excludeSocketId && normalizeSchoolName(p.school) === normalized
    );
}

function loadGameState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const raw = fs.readFileSync(STATE_FILE, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.players)) {
                // Reset live socket connection flags on server boot so teams can reconnect cleanly
                const players = parsed.players.map(p => ({
                    ...p,
                    number: String(p.number),
                    score: Number(p.score) || 0,
                    status: p.status || 'locked',
                    connected: false
                }));
                return {
                    title: parsed.title || "Tagisan 41 Quiz Show",
                    players,
                    wrongAttempts: Number(parsed.wrongAttempts) || 0,
                    failedTeamKeys: Array.isArray(parsed.failedTeamKeys) ? parsed.failedTeamKeys : []
                };
            }
        }
    } catch (err) {
        console.error("Failed to load gamestate.json:", err);
    }

    return {
        title: "Tagisan 41 Quiz Show",
        players: [],
        wrongAttempts: 0,
        failedTeamKeys: []
    };
}

function saveGameState() {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(gameState, null, 2), 'utf8');
    } catch (err) {
        console.error("Failed to save gamestate.json:", err);
    }
}

let gameState = loadGameState();

// Function to read schools from schools.txt
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
    return ["University of the Philippines Diliman", "Ateneo de Manila University", "De La Salle University"];
}

// Build a slug -> logo path map from assets/logos so non-.png extensions resolve automatically
function getSchoolLogoMap() {
    const logoMap = {};
    const logosDir = path.join(__dirname, 'assets', 'logos');
    const imageExtRe = /\.(png|jpe?g|webp|jfif|svg|gif|avif|bmp|ico|tiff?)$/i;

    try {
        if (!fs.existsSync(logosDir)) return logoMap;
        const files = fs.readdirSync(logosDir);
        for (const file of files) {
            if (!imageExtRe.test(file)) continue;
            const ext = path.extname(file);
            const slug = path.basename(file, ext).toLowerCase();
            // Prefer exact lowercase .png if multiple files share the same slug
            if (!logoMap[slug] || ext === '.png') {
                logoMap[slug] = `assets/logos/${encodeURIComponent(file)}`;
            }
        }
    } catch (err) {
        console.error("Error reading assets/logos:", err);
    }
    return logoMap;
}

io.on('connection', (socket) => {
    // console.log('A user connected:', socket.id);

    socket.emit('schoolLogos', getSchoolLogoMap());
    socket.emit('updateState', gameState);
    socket.emit('schoolList', getSchoolList());

    // Check whether a school already has an active connected player
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

    // When a player joins or reconnects
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
        const teamKey = getTeamKey({ school: schoolName, number: playerNum });
        const anyoneBuzzed = gameState.players.some(p => p.status === 'buzzed');
        const roundOpen = !anyoneBuzzed && gameState.players.some(p => p.connected && p.status === 'ready');
        const hasFailedThisRound = gameState.failedTeamKeys.includes(teamKey);

        let existing = gameState.players.find(p => normalizeSchoolName(p.school) === normalizedSchool);

        if (existing) {
            existing.id = socket.id;
            existing.school = schoolName;
            existing.number = playerNum;
            existing.connected = true;
            if (existing.status !== 'buzzed') {
                existing.status = (roundOpen && !hasFailedThisRound) ? 'ready' : 'locked';
            }
        } else {
            gameState.players.push({
                id: socket.id,
                school: schoolName,
                number: playerNum,
                score: 0,
                status: (roundOpen && !hasFailedThisRound) ? 'ready' : 'locked',
                connected: true
            });
        }

        io.emit('schoolLogos', getSchoolLogoMap());
        saveGameState();
        io.emit('updateState', gameState);
    });

    // When a player buzzes
    socket.on('playerBuzz', () => {
        const alreadyBuzzed = gameState.players.some(p => p.status === 'buzzed');
        if (!alreadyBuzzed) {
            const player = gameState.players.find(p => p.id === socket.id);
            if (player && player.status === 'ready') {
                player.status = 'buzzed';
                // Lock everyone else out instantly
                gameState.players.forEach(p => {
                    if (p.status === 'ready') p.status = 'locked';
                });
                saveGameState();
                io.emit('updateState', gameState);
            }
        }
    });

    // Verify host password before allowing access to host.html
    socket.on('verifyHost', (password, callback) => {
        if (password === HOST_PASSWORD) {
            socket.data.isHost = true;
            if (typeof callback === 'function') callback({ ok: true });
        } else {
            if (typeof callback === 'function') callback({ ok: false });
        }
    });

    // Host controls
    socket.on('hostAction', (actionData) => {
        if (!socket.data.isHost && actionData.password !== HOST_PASSWORD) {
            return;
        }

        if (actionData.type === 'updateTitle') {
            gameState.title = actionData.title;
        } else if (actionData.type === 'lockAll') {
            gameState.players.forEach(p => p.status = 'locked');
        } else if (actionData.type === 'unlockAll') {
            gameState.wrongAttempts = 0;
            gameState.failedTeamKeys = []; // Clear failed list for new question
            gameState.players.forEach(p => p.status = 'ready');
        } else if (actionData.type === 'correct') {
            const buzzed = gameState.players.find(p => p.status === 'buzzed');
            if (buzzed) {
                buzzed.score += 1;
            }
            gameState.wrongAttempts = 0;
            gameState.failedTeamKeys = [];
            gameState.players.forEach(p => p.status = 'locked');
        } else if (actionData.type === 'wrong') {
            const buzzed = gameState.players.find(p => p.status === 'buzzed');
            if (buzzed) {
                buzzed.status = 'locked';
                const key = getTeamKey(buzzed);
                if (!gameState.failedTeamKeys.includes(key)) {
                    gameState.failedTeamKeys.push(key); // Add to permanent fail list for this round
                }
                gameState.wrongAttempts += 1;
            }

            // If we've reached 3 wrong attempts (4 total tries), lock everyone out completely
            if (gameState.wrongAttempts >= 3) {
                gameState.players.forEach(p => p.status = 'locked');
            } else {
                // Unlock everyone EXCEPT those who already failed this round
                gameState.players.forEach(p => {
                    if (!gameState.failedTeamKeys.includes(getTeamKey(p))) {
                        p.status = 'ready'; // Open up for the steal!
                    }
                });
            }
        } else if (actionData.type === 'adjustScore') {
            const player = gameState.players[actionData.index];
            if (player) {
                const delta = actionData.delta > 0 ? 1 : -1;
                player.score = Math.max(0, player.score + delta);
            }
        } else if (actionData.type === 'resetScores') {
            gameState.wrongAttempts = 0;
            gameState.failedTeamKeys = [];
            // Remove disconnected players and reset active players' scores/status without disconnecting anyone
            gameState.players = gameState.players
                .filter(p => p.connected)
                .map(p => ({
                    ...p,
                    score: 0,
                    status: 'locked'
                }));
        }
        saveGameState();
        io.emit('updateState', gameState);
    });

    // When a socket disconnects, keep player scores/records in gameState for reconnection
    socket.on('disconnect', () => {
        const player = gameState.players.find(p => p.id === socket.id);
        if (!player) return;

        player.connected = false;
        saveGameState();
        io.emit('updateState', gameState);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Tagisan Buzzer is Running!`);
    console.log(`  Host (this laptop):  http://localhost:${PORT}/index.html`);

    // Show the LAN addresses that players and the projector should open
    const nets = require('os').networkInterfaces();
    Object.values(nets).flat().forEach((n) => {
        if (n && n.family === 'IPv4' && !n.internal) {
            console.log(`  Players / Spectator: http://${n.address}:${PORT}/index.html`);
        }
    });
});
