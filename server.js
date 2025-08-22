const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Le port doit utiliser l'opérateur OU logique '||' sans espace.
const PORT = process.env.PORT || 3000;

// Servir les fichiers statiques du dossier 'public'
app.use(express.static('public'));

// --- Gestion de l'état du jeu ---
const rooms = {};
const INACTIVITY_TIMEOUT = 5 * 60 * 1000; // 5 minutes

// Initialiser 10 salons de jeu
for (let i = 1; i <= 10; i++) {
    const roomId = `room-${i}`;
    rooms[roomId] = {
        id: roomId,
        name: `Salon de Jeu ${i}`,
        players: {},
        playerCount: 0,
        maxPlayers: 10,
        gameState: 'LOBBY_VOTING' // États possibles: LOBBY_VOTING, IN_PROGRESS, GAME_OVER
    };
}

io.on('connection', (socket) => {
    console.log(`Un utilisateur s'est connecté: ${socket.id}`);
    socket.lastActivity = Date.now();

    // Envoyer la liste initiale des salons au nouveau client
    socket.emit('roomListUpdate', getRoomListData());

    // Gérer la demande de rejoindre un salon
    socket.on('joinRoom', (roomId) => {
        if (!rooms[roomId]) {
            socket.emit('error', 'Salon invalide.');
            return;
        }

        const room = rooms[roomId];
        if (room.playerCount >= room.maxPlayers) {
            socket.emit('error', 'Le salon est plein.');
            return;
        }

        socket.join(roomId);
        socket.roomId = roomId;

        room.players[socket.id] = {
            id: socket.id,
            isReady: false,
            isAlive: true,
            team: (room.playerCount % 2 === 0) ? 'A' : 'B' // Assignation simple aux équipes
        };
        room.playerCount++;

        console.log(`Joueur ${socket.id} a rejoint le salon ${roomId}`);

        // Mettre à jour tous les clients dans le salon et la liste des salons pour tout le monde
        io.to(roomId).emit('updateRoom', room);
        io.emit('roomListUpdate', getRoomListData());
    });

    // Gérer le statut "prêt" du joueur
    socket.on('playerReady', () => {
        const room = rooms[socket.roomId];
        if (room && room.players[socket.id]) {
            const player = room.players[socket.id];
            player.isReady = !player.isReady;

            io.to(socket.roomId).emit('updateRoom', room);
            checkGameStart(socket.roomId);
        }
    });

    // Gérer le "heartbeat" d'activité
    socket.on('heartbeat', () => {
        socket.lastActivity = Date.now();
    });

    // Gérer la déconnexion
    socket.on('disconnect', () => {
        console.log(`Un utilisateur s'est déconnecté: ${socket.id}`);
        const roomId = socket.roomId;
        if (roomId && rooms[roomId]) {
            const room = rooms[roomId];
            // S'assurer que le joueur existe avant de le supprimer
            if (room.players[socket.id]) {
                delete room.players[socket.id];
                room.playerCount--;

                // Si le jeu était en cours, vérifier la condition de victoire
                if (room.gameState === 'IN_PROGRESS') {
                    checkWinCondition(roomId);
                }

                // Mettre à jour les clients restants et la liste des salons
                io.to(roomId).emit('updateRoom', room);
                io.emit('roomListUpdate', getRoomListData());
            }
        }
    });
});

// --- Fonctions de logique de jeu ---

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
    // Correction de l'opérateur OU logique '||'
    if (!room || room.gameState !== 'LOBBY_VOTING') return;

    const readyPlayers = Object.values(room.players).filter(p => p.isReady).length;
    const totalPlayers = room.playerCount;

    // Démarrer si au moins 2 joueurs et la majorité est prête
    if (totalPlayers >= 2 && readyPlayers > totalPlayers / 2) {
        startGame(roomId);
    }
}

function startGame(roomId) {
    const room = rooms[roomId];
    room.gameState = 'IN_PROGRESS';
    
    // Initialiser l'état de jeu pour chaque joueur
    Object.values(room.players).forEach(player => {
        player.isAlive = true;
    });

    io.to(roomId).emit('gameStarted', room);
    console.log(`La partie commence dans le salon ${roomId}`);

    // Placeholder pour la logique de jeu (ex: élimination de joueurs)
    // Pour la démo, nous simulons une élimination après un certain temps
    setTimeout(() => simulatePlayerElimination(roomId), 10000);
}

function checkWinCondition(roomId) {
    const room = rooms[roomId];
    // Correction de l'opérateur OU logique '||'
    if (!room || room.gameState !== 'IN_PROGRESS') return;

    const activeTeams = new Set();
    Object.values(room.players).forEach(player => {
        if (player.isAlive) {
            activeTeams.add(player.team);
        }
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

    // Réinitialiser le salon après un délai pour retourner au vote
    setTimeout(() => {
        if (rooms[roomId]) { // Vérifier si le salon existe toujours
            room.gameState = 'LOBBY_VOTING';
            Object.values(room.players).forEach(player => {
                player.isReady = false;
                player.isAlive = true;
            });
            io.to(roomId).emit('updateRoom', room);
        }
    }, 10000); // 10 secondes avant de retourner au salon
}

// Fonction de simulation pour le test
function simulatePlayerElimination(roomId) {
    const room = rooms[roomId];
    if (!room || room.gameState !== 'IN_PROGRESS') return;

    const alivePlayers = Object.values(room.players).filter(p => p.isAlive);
    if (alivePlayers.length > 1) {
        // CORRECTION: Sélectionner un joueur au hasard à éliminer
        const playerToEliminate = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
        
        // S'assurer que le joueur existe toujours dans l'état du salon avant de le modifier
        if (room.players[playerToEliminate.id]) {
            room.players[playerToEliminate.id].isAlive = false;
            console.log(`Joueur ${playerToEliminate.id} éliminé dans le salon ${roomId}`);
            
            // On ne notifie l'élimination que si elle a bien eu lieu
            io.to(roomId).emit('playerEliminated', playerToEliminate.id);
            io.to(roomId).emit('updateRoom', room);
            checkWinCondition(roomId);
        }
    }
}


// Vérification de l'inactivité
setInterval(() => {
    const now = Date.now();
    io.sockets.sockets.forEach((socket) => {
        if (now - socket.lastActivity > INACTIVITY_TIMEOUT) {
            console.log(`Déconnexion du socket ${socket.id} pour inactivité.`);
            socket.emit('forceDisconnect', 'Vous avez été déconnecté pour inactivité.');
            socket.disconnect(true);
        }
    });
}, 30000); // Vérifier toutes les 30 secondes

server.listen(PORT, () => {
    console.log(`Le serveur écoute sur le port ${PORT}`);
});
