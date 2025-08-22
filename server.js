const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
app.use(express.static('public'));

// --- MARBLEOUS GAME LOGIC ON SERVER ---
const Config = {
    GRID_ROWS: 13, GRID_COLS: 8, GAME_OVER_ROW: 11,
    BUBBLE_COLORS: [
        { main: '#c62b39', shadow: '#69050d' }, { main: '#ffd304', shadow: '#957e18' }, { main: '#3bda0e', shadow: '#108209' },
        { main: '#3ee2ee', shadow: '#2babb4' }, { main: '#5c68de', shadow: '#18169b' }, { main: '#af00c1', shadow: '#860094' },
        { main: '#d8d6db', shadow: '#636b60' }
    ]
};

const GameLogic = {
    createEmptyGrid: () => Array.from({ length: Config.GRID_ROWS }, () => Array(Config.GRID_COLS).fill(null)),
    createBubble: (r, c) => ({ r, c, color: Config.BUBBLE_COLORS[Math.floor(Math.random() * Config.BUBBLE_COLORS.length)], isStatic: true }),
    createInitialGrid() {
        const grid = this.createEmptyGrid();
        for (let r = 0; r < 4; r++) for (let c = 0; c < Config.GRID_COLS; c++) if (Math.random() > 0.6) grid[r][c] = this.createBubble(r, c);
        return grid;
    },
    loadBubbles(player) {
        player.launcherBubble = player.nextBubble || this.createBubble(-1, -1);
        player.nextBubble = this.createBubble(-1, -1);
    },
    getBubbleCoords: (r, c, rad) => ({ x: rad + c * rad * 2 + (r % 2) * rad, y: rad + r * rad * 2 * 0.866 }),
    getNeighborCoords(r, c) {
        const odd = r % 2 !== 0, n = [];
        const dirs = [{ dr: -1, dc: odd ? 0 : -1 }, { dr: -1, dc: odd ? 1 : 0 }, { dr: 0, dc: -1 }, { dr: 0, dc: 1 }, { dr: 1, dc: odd ? 0 : -1 }, { dr: 1, dc: odd ? 1 : 0 }];
        for (const d of dirs) { const nr = r + d.dr, nc = c + d.dc; if (nr >= 0 && nr < Config.GRID_ROWS && nc >= 0 && nc < Config.GRID_COLS) n.push({ r: nr, c: nc }); }
        return n;
    },
    findMatches(grid, r, c) {
        const start = grid[r]?.[c]; if (!start) return []; const q = [start], visited = new Set([`${r},${c}`]), matches = [start];
        while (q.length > 0) { const curr = q.pop(); for (const n of this.getNeighborCoords(curr.r, curr.c)) {
            const neighbor = grid[n.r]?.[n.c]; if (neighbor && !visited.has(`${n.r},${n.c}`) && neighbor.color.main === start.color.main) {
                visited.add(`${n.r},${n.c}`); q.push(neighbor); matches.push(neighbor);
            } } } return matches;
    },
    findFloatingBubbles(grid) {
        const connected = new Set(), q = [];
        for (let c = 0; c < Config.GRID_COLS; c++) if (grid[0][c]) { q.push(grid[0][c]); connected.add(`0,${c}`); }
        let head = 0; while (head < q.length) { const curr = q[head++]; for (const n of this.getNeighborCoords(curr.r, curr.c)) {
            const neighbor = grid[n.r]?.[n.c]; if (neighbor && !connected.has(`${n.r},${n.c}`)) { connected.add(`${n.r},${n.c}`); q.push(neighbor); } } }
        const floating = [];
        for (let r = 0; r < Config.GRID_ROWS; r++) for (let c = 0; c < Config.GRID_COLS; c++) if (grid[r][c] && !connected.has(`${r},${c}`)) floating.push(grid[r][c]);
        return floating;
    },
    handleAvalanche(grid) {
        const floating = this.findFloatingBubbles(grid);
        floating.forEach(b => { grid[b.r][b.c] = null; });
        return floating.length;
    },
    findBestSnapSpot(grid, bubble, bubbleRadius) {
        let best = null, minD = Infinity;
        for (let r = 0; r < Config.GRID_ROWS; r++) for (let c = 0; c < Config.GRID_COLS; c++) if (!grid[r][c]) {
            // THIS IS THE CRITICAL FIX: Ensure the spot is connected to the ceiling or another bubble
            if (r === 0 || this.getNeighborCoords(r, c).some(n => grid[n.r]?.[n.c])) {
                const { x, y } = this.getBubbleCoords(r, c, bubbleRadius); const d = Math.hypot(bubble.x - x, bubble.y - y);
                if (d < minD) { minD = d; best = { r, c }; }
            }
        }
        return best;
    },
    snapBubble(player, bubbleRadius) {
        const bubbleToSnap = { ...player.shotBubble };
        const bestSpot = this.findBestSnapSpot(player.grid, bubbleToSnap, bubbleRadius);
        player.shotBubble = null;
        if (bestSpot) {
            const { r, c } = bestSpot;
            player.grid[r][c] = { r, c, color: bubbleToSnap.color, isStatic: true };
            const matches = this.findMatches(player.grid, r, c);
            if (matches.length >= 3) {
                matches.forEach(b => { player.grid[b.r][b.c] = null; });
                const avalanche = this.handleAvalanche(player.grid);
                player.score += (matches.length * 10) + (Math.pow(avalanche, 2) * 10);
            }
        }
        this.loadBubbles(player);
        this.checkGameOver(player);
    },
    checkGameOver(player) {
        if (player.isAlive) for (let c = 0; c < Config.GRID_COLS; c++) if (player.grid[Config.GAME_OVER_ROW][c]) {
            player.isAlive = false;
        }
    }
};

const rooms = {};
const globalPlayers = {};
for (let i = 1; i <= 10; i++) {
    rooms[`room-${i}`] = { id: `room-${i}`, name: `Salon ${i}`, players: {}, playerCount: 0, maxPlayers: 10, state: 'LOBBY_VOTING', gameLoopInterval: null };
}

io.on('connection', (socket) => {
    globalPlayers[socket.id] = { id: socket.id };
    io.emit('updatePlayerList', Object.values(globalPlayers));
    socket.emit('roomListUpdate', rooms);

    socket.on('joinRoom', (roomId) => {
        const room = rooms[roomId]; if (!room || room.playerCount >= room.maxPlayers) return;
        socket.join(roomId); socket.roomId = roomId;
        room.players[socket.id] = {
            id: socket.id, name: `Joueur_${socket.id.substring(0, 4)}`, isReady: false, isAlive: true,
            score: 0, level: 1, grid: GameLogic.createEmptyGrid(), launcherBubble: null, nextBubble: null, shotBubble: null
        };
        room.playerCount++;
        io.to(roomId).emit('updateRoom', room); io.emit('roomListUpdate', rooms);
    });
    socket.on('playerReady', () => {
        const room = rooms[socket.roomId];
        if (room && room.players[socket.id]) {
            room.players[socket.id].isReady = !room.players[socket.id].isReady;
            io.to(socket.roomId).emit('updateRoom', room);
            checkGameStart(socket.roomId);
        }
    });
    socket.on('playerAction', (action) => {
        const room = rooms[socket.roomId]; const player = room?.players[socket.id];
        if (!room || !player || room.state !== 'IN_PROGRESS' || !player.isAlive || player.shotBubble) return;
        if (action.type === 'shoot' && player.launcherBubble) {
            player.shotBubble = player.launcherBubble;
            player.launcherBubble = null;
            const bubbleRadius = 300 / (Config.GRID_COLS * 2 + 1) * 0.95;
            const speed = bubbleRadius * 1.2;
            player.shotBubble.vx = Math.cos(action.angle) * speed;
            player.shotBubble.vy = Math.sin(action.angle) * speed;
            player.shotBubble.x = 300 / 2;
            player.shotBubble.y = (300 * 11 / 8) - bubbleRadius * 2;
        }
    });
    socket.on('disconnect', () => {
        delete globalPlayers[socket.id];
        io.emit('updatePlayerList', Object.values(globalPlayers));
        const roomId = socket.roomId;
        if (roomId && rooms[roomId]) {
            const room = rooms[roomId];
            if (room.players[socket.id]) {
                delete room.players[socket.id]; room.playerCount--;
                if(room.playerCount === 0 && room.gameLoopInterval) {
                    clearInterval(room.gameLoopInterval);
                    room.state = 'LOBBY_VOTING';
                }
                io.to(roomId).emit('updateRoom', room); io.emit('roomListUpdate', rooms);
            }
        }
    });
});

function checkGameStart(roomId) {
    const room = rooms[roomId];
    if (!room || room.state !== 'LOBBY_VOTING') return;
    const readyPlayers = Object.values(room.players).filter(p => p.isReady).length;
    const totalPlayers = room.playerCount;
    if (totalPlayers > 0 && readyPlayers === totalPlayers) {
        startGame(roomId);
    }
}

function startGame(roomId) {
    const room = rooms[roomId]; room.state = 'IN_PROGRESS';
    Object.values(room.players).forEach(p => {
        p.isAlive = true; p.score = 0; p.level = 1; p.grid = GameLogic.createInitialGrid();
        GameLogic.loadBubbles(p);
    });
    io.to(roomId).emit('gameStarted', room);
    room.gameLoopInterval = setInterval(() => gameLoop(roomId), 1000 / 60);
}

function gameLoop(roomId) {
    const room = rooms[roomId]; if (!room || room.state !== 'IN_PROGRESS') { if(room) clearInterval(room.gameLoopInterval); return; }
    const bubbleRadius = 300 / (Config.GRID_COLS * 2 + 1) * 0.95;
    const canvasWidth = 300;

    Object.values(room.players).forEach(player => {
        if (player.shotBubble) {
            const b = player.shotBubble;
            b.x += b.vx; b.y += b.vy;
            let collided = b.y - bubbleRadius < 0;
            if (!collided) for (let r = 0; r < Config.GRID_ROWS; r++) for (let c = 0; c < Config.GRID_COLS; c++) if (player.grid[r][c]) {
                const coords = GameLogic.getBubbleCoords(r, c, bubbleRadius);
                if (Math.hypot(b.x - coords.x, b.y - coords.y) < bubbleRadius * 1.8) { collided = true; break; }
            }
            if (collided) GameLogic.snapBubble(player, bubbleRadius);
            else if (b.x - bubbleRadius < 0 || b.x + bubbleRadius > canvasWidth) b.vx *= -1;
        }
    });

    const alivePlayers = Object.values(room.players).filter(p => p.isAlive).length;
    if (room.playerCount > 1 && alivePlayers <= 1) {
        endGame(roomId);
    } else if (room.playerCount === 1 && alivePlayers === 0) {
        endGame(roomId);
    }
    io.to(roomId).emit('gameStateUpdate', room);
}

function endGame(roomId) {
    const room = rooms[roomId]; if (!room) return;
    clearInterval(room.gameLoopInterval);
    room.gameLoopInterval = null;
    room.state = 'GAME_OVER';
    io.to(roomId).emit('gameOver');
    setTimeout(() => {
        if(rooms[roomId]) {
            room.state = 'LOBBY_VOTING';
            Object.values(room.players).forEach(p => { p.isReady = false; });
            io.to(roomId).emit('updateRoom', room);
        }
    }, 5000);
}

server.listen(PORT, () => console.log(`Serveur démarré sur le port ${PORT}`));
