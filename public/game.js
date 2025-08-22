document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    const playerGrid = document.getElementById('player-grid');
    const roomTitle = document.getElementById('room-title');
    const gameStatus = document.getElementById('game-status');

    const params = new URLSearchParams(window.location.search);
    const roomId = params.get('room');

    if (!roomId) {
        window.location.href = '/';
        return;
    }

    // Rejoindre le salon
    socket.emit('joinRoom', roomId);

    // Mettre à jour l'affichage du salon
    socket.on('updateRoom', (room) => {
        if (roomTitle) roomTitle.textContent = room.name;
        renderPlayerGrid(room);
    });

    // Gérer les erreurs
    socket.on('error', (message) => {
        alert(`Erreur: ${message}`);
        window.location.href = '/';
    });
    
    // Démarrage de la partie
    socket.on('gameStarted', (room) => {
        gameStatus.textContent = "La partie est en cours!";
        renderPlayerGrid(room); // Mettre à jour pour montrer les joueurs comme "vivants"
    });

    // Fin de la partie
    socket.on('gameOver', ({ winningTeam }) => {
        if (winningTeam) {
            gameStatus.textContent = `Partie terminée! L'équipe ${winningTeam} a gagné!`;
        } else {
            gameStatus.textContent = "Partie terminée! C'est un match nul.";
        }
        // Un timeout sur le serveur réinitialisera le salon
    });
    
    // Déconnexion forcée
    socket.on('forceDisconnect', (reason) => {
        alert(reason);
        window.location.href = '/';
    });


    function renderPlayerGrid(room) {
        if (!playerGrid) return;
        playerGrid.innerHTML = '';

        Object.values(room.players).forEach(player => {
            const playerThumb = document.createElement('div');
            playerThumb.classList.add('player-thumbnail');
            playerThumb.dataset.playerId = player.id;

            if (player.isReady) {
                playerThumb.classList.add('ready');
            }
            if (!player.isAlive) {
                playerThumb.classList.add('not-alive');
            }

            // Rendre sa propre miniature cliquable si le jeu n'a pas commencé
            if (player.id === socket.id && room.gameState === 'LOBBY_VOTING') {
                playerThumb.classList.add('clickable');
                playerThumb.onclick = () => {
                    socket.emit('playerReady');
                };
            }

            playerThumb.innerHTML = `
                <div class="player-id">${player.id.substring(0, 5)}...</div>
                <div class="player-team">Équipe ${player.team}</div>
                <div class="player-status">${player.isReady? 'Prêt' : 'Pas prêt'}</div>
            `;
            playerGrid.appendChild(playerThumb);
        });
    }

    // Logique d'inactivité
    let activityHeartbeat;

    function sendHeartbeat() {
        socket.emit('heartbeat');
    }

    function setupInactivityDetection() {
        // Envoyer un battement de cœur toutes les 30 secondes
        activityHeartbeat = setInterval(sendHeartbeat, 30 * 1000);

        // Réinitialiser sur l'activité de l'utilisateur
        const resetEvents = ['mousemove', 'mousedown', 'keypress', 'click', 'scroll'];
        resetEvents.forEach(event => {
            document.addEventListener(event, () => {
                // Pour éviter de surcharger le serveur, on ne fait rien ici,
                // le heartbeat périodique suffit à maintenir la session active
                // tant que l'onglet est ouvert et actif.
            });
        });

        // Gérer la visibilité de l'onglet
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                // L'onglet est inactif, on arrête d'envoyer les heartbeats
                clearInterval(activityHeartbeat);
            } else {
                // L'onglet est de nouveau actif, on envoie un heartbeat immédiatement
                // et on redémarre l'intervalle.
                sendHeartbeat();
                activityHeartbeat = setInterval(sendHeartbeat, 30 * 1000);
            }
        });
    }

    setupInactivityDetection();
});
