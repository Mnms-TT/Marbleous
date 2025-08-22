const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

// --- Gestion de l'état du jeu ---
const rooms = {};
const globalPlayers = {}; // NOUVEAU: Suit tous les joueurs connectés
const INACTIVITY_TIMEOUT = 5 * 60 * 1000; // 5 minutes

// Initialiser 10 salons de jeu
for (let i = 1; i <= 10; i++) {
    const roomId = `room-${i}`;
    rooms[roomId] = {
        id: roomId,
        name: `Salon ${i}`, // Nom plus court pour l'affichage
        players: {},
        playerCount: 0,
        maxPlayers: 10,
        gameState: 'LOBBY_VOTING'
    };
}

io.on('connection', (socket) => {
    console.log(`Un utilisateur s'est connecté: ${socket.id}`);
    socket.lastActivity = Date.now();

    // NOUVEAU: Ajouter le joueur à la liste globale et notifier tout le monde
    globalPlayers[socket.id] = { id: socket.id };
    io.emit('updatePlayerList', Object.values(globalPlayers));

    socket.emit('roomListUpdate', getRoomListData());

    // NOUVEAU: Gérer les messages du chat global
    socket.on('sendMessage', (message) => {
        // Empêcher les messages vides ou trop longs
        if (typeof message === 'string' && message.trim().length > 0 && message.length < 200) {
            io.emit('chatMessage', {
                senderId: socket.id,
                message: message.trim()
            });
        }
    });

    socket.on('joinRoom', (roomId) => {
        if (!rooms[roomId]) {
            return socket.emit('error', 'Salon invalide.');
        }
        const room = rooms[roomId];
        if (room.playerCount >= room.maxPlayers) {
            return socket.emit('error', 'Le salon est plein.');
        }

        socket.join(roomId);
        socket.roomId = roomId;

        room.players[socket.id] = {
            id: socket.id,
            isReady: false,
            isAlive: true,
            team: (room.playerCount % 2 === 0) ? 'A' : 'B'
        };
        room.playerCount++;
        
        // Mettre à jour le nom du joueur dans la liste globale
        globalPlayers[socket.id].roomId = roomId;
        io.emit('updatePlayerList', Object.values(globalPlayers));

        console.log(`Joueur ${socket.id} a rejoint le salon ${roomId}`);
        io.to(roomId).emit('updateRoom', room);
        io.emit('roomListUpdate', getRoomListData());
    });

    socket.on('playerReady', () => {
        const room = rooms[socket.roomId];
        if (room && room.players[socket.id]) {
            const player = room.players[socket.id];
            player.isReady = !player.isReady;
            io.to(socket.roomId).emit('updateRoom', room);
            checkGameStart(socket.roomId);
        }
    });

    socket.on('heartbeat', () => {
        socket.lastActivity = Date.now();
    });

    socket.on('disconnect', () => {
        console.log(`Un utilisateur s'est déconnecté: ${socket.id}`);
        
        // NOUVEAU: Retirer le joueur de la liste globale et notifier tout le monde
        delete globalPlayers[socket.id];
        io.emit('updatePlayerList', Object.values(globalPlayers));

        const roomId = socket.roomId;
        if (roomId && rooms[roomId]) {
            const room = rooms[roomId];
            if (room.players[socket.id]) {
                delete room.players[socket.id];
                room.playerCount--;
                if (room.gameState === 'IN_PROGRESS') {
                    checkWinCondition(roomId);
                }
                io.to(roomId).emit('updateRoom', room);
                io.emit('roomListUpdate', getRoomListData());
            }
        }
    });
});

// --- Fonctions utilitaires (inchangées pour la plupart) ---
function getRoomListData() {
    const roomList = {};
    for (const roomId in rooms) {
        roomList[roomId] = {
            id: rooms[roomId].id,
            name: rooms[roomId].name,
            playerCount: rooms[roomId].playerCount,
            maxPlayers: rooms[roomId].maxPlayers
        };
    }
    return roomList;
}

function checkGameStart(roomId) {
    const room = rooms[roomId];
    if (!room || room.gameState !== 'LOBBY_VOTING') return;
    const readyPlayers = Object.values(room.players).filter(p => p.isReady).length;
    const totalPlayers = room.playerCount;
    if (totalPlayers >= 2 && readyPlayers > totalPlayers / 2) {
        startGame(roomId);
    }
}

function startGame(roomId) {
    const room = rooms[roomId];
    room.gameState = 'IN_PROGRESS';
    Object.values(room.players).forEach(player => { player.isAlive = true; });
    io.to(roomId).emit('gameStarted', room);
    console.log(`La partie commence dans le salon ${roomId}`);
    setTimeout(() => simulatePlayerElimination(roomId), 10000);
}

function checkWinCondition(roomId) {
    const room = rooms[roomId];
    if (!room || room.gameState !== 'IN_PROGRESS') return;
    const activeTeams = new Set();
    Object.values(room.players).forEach(player => {
        if (player.isAlive) activeTeams.add(player.team);
    });
    if (activeTeams.size <= 1) {
        const winningTeam = activeTeams.size === 1 ? activeTeams.values().next().value : null;
        endGame(roomId, winningTeam);
    }
}

function endGame(roomId, winningTeam) {
    const room = rooms[roomId];
    if (!room) return;
    room.gameState = 'GAME_OVER';
    io.to(roomId).emit('gameOver', { winningTeam });
    console.log(`Partie terminée dans le salon ${roomId}. Équipe gagnante: ${winningTeam}`);
    setTimeout(() => {
        if (rooms[roomId]) {
            room.gameState = 'LOBBY_VOTING';
            Object.values(room.players).forEach(player => {
                player.isReady = false;
                player.isAlive = true;
            });
            io.to(roomId).emit('updateRoom', room);
        }
    }, 10000);
}

function simulatePlayerElimination(roomId) {
    const room = rooms[roomId];
    if (!room || room.gameState !== 'IN_PROGRESS') return;
    const alivePlayers = Object.values(room.players).filter(p => p.isAlive);
    if (alivePlayers.length > 1) {
        const playerToEliminate = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
        if (room.players[playerToEliminate.id]) {
            room.players[playerToEliminate.id].isAlive = false;
            console.log(`Joueur ${playerToEliminate.id} éliminé`);
            io.to(roomId).emit('updateRoom', room);
            checkWinCondition(roomId);
        }
    }
}

setInterval(() => {
    const now = Date.now();
    io.sockets.sockets.forEach((socket) => {
        if (now - socket.lastActivity > INACTIVITY_TIMEOUT) {
            socket.emit('forceDisconnect', 'Vous avez été déconnecté pour inactivité.');
            socket.disconnect(true);
        }
    });
}, 30000);

server.listen(PORT, () => {
    console.log(`Le serveur écoute sur le port ${PORT}`);
});
