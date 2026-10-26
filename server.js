const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

let gameState = {
    title: "Tagisan Quiz Show",
    players: [],
    wrongAttempts: 0,
    failedPlayerIds: [] // Track who already got it wrong this question
};

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

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.emit('updateState', gameState);
    socket.emit('schoolList', getSchoolList());

    // When a player joins
    socket.on('playerJoin', (playerData) => {
        if (!playerData || !playerData.school) return;

        const playerNum = String(playerData.number);
        let existing = gameState.players.find(p => p.school === playerData.school && String(p.number) === playerNum);
        
        if (existing) {
            existing.id = socket.id;
        } else {
            gameState.players.push({
                id: socket.id,
                school: playerData.school,
                number: playerNum,
                score: 0,
                status: 'locked' 
            });
        }

        // Lock everyone unless someone is already buzzed in
        const anyoneBuzzed = gameState.players.some(p => p.status === 'buzzed');
        if (!anyoneBuzzed) {
            gameState.players.forEach(p => {
                p.status = 'locked';
            });
        }

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
                io.emit('updateState', gameState);
            }
        }
    });

    // Host controls
    socket.on('hostAction', (actionData) => {
        if (actionData.type === 'updateTitle') {
            gameState.title = actionData.title;
        } else if (actionData.type === 'lockAll') {
            gameState.players.forEach(p => p.status = 'locked');
        } else if (actionData.type === 'unlockAll') {
            gameState.wrongAttempts = 0;
            gameState.failedPlayerIds = []; // Clear failed list for new question
            gameState.players.forEach(p => p.status = 'ready');
        } else if (actionData.type === 'correct') {
            const buzzed = gameState.players.find(p => p.status === 'buzzed');
            if (buzzed) {
                buzzed.score += 1;
            }
            gameState.wrongAttempts = 0;
            gameState.failedPlayerIds = [];
            gameState.players.forEach(p => p.status = 'locked');
        } else if (actionData.type === 'wrong') {
            const buzzed = gameState.players.find(p => p.status === 'buzzed');
            if (buzzed) {
                buzzed.status = 'locked';
                gameState.failedPlayerIds.push(buzzed.id); // Add to permanent fail list for this round
                gameState.wrongAttempts += 1;
            }

            // If we've reached 3 wrong attempts (4 total tries), lock everyone out completely
            if (gameState.wrongAttempts >= 3) {
                gameState.players.forEach(p => p.status = 'locked');
            } else {
                // Unlock everyone EXCEPT those who already failed this round
                gameState.players.forEach(p => {
                    if (!gameState.failedPlayerIds.includes(p.id)) {
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
            gameState.players.forEach(p => p.score = 0);
        }
        io.emit('updateState', gameState);
    });

    // When a player disconnects
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        
        gameState.players = gameState.players.filter(p => p.id !== socket.id);

        // Lock everyone unless someone is already buzzed in
        const anyoneBuzzed = gameState.players.some(p => p.status === 'buzzed');
        if (!anyoneBuzzed) {
            gameState.players.forEach(p => {
                p.status = 'locked';
            });
        }

        io.emit('updateState', gameState);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Quiz server running!`);
    console.log(`  Host (this laptop):  http://localhost:${PORT}/index.html`);

    // Show the LAN addresses that players and the projector should open
    const nets = require('os').networkInterfaces();
    Object.values(nets).flat().forEach((n) => {
        if (n && n.family === 'IPv4' && !n.internal) {
            console.log(`  Players / Spectator: http://${n.address}:${PORT}/index.html`);
        }
    });
});
