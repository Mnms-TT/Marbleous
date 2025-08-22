document.addEventListener('DOMContentLoaded', () => {
    const socket = io();
    const roomListContainer = document.getElementById('room-list');

    socket.on('roomListUpdate', (rooms) => {
        updateRoomList(rooms);
    });

    function updateRoomList(rooms) {
        if (!roomListContainer) return;
        roomListContainer.innerHTML = ''; // Vider la liste actuelle

        Object.values(rooms).forEach(room => {
            const roomElement = document.createElement('a');
            roomElement.classList.add('room-item');
            
            const isFull = room.playerCount >= room.maxPlayers;
            if (isFull) {
                roomElement.classList.add('full');
            } else {
                roomElement.href = `/game.html?room=${room.id}`;
            }

            roomElement.innerHTML = `
                <div class="room-name">${room.name}</div>
                <div class="room-players">Joueurs: ${room.playerCount} / ${room.maxPlayers}</div>
            `;
            roomListContainer.appendChild(roomElement);
        });
    }
});
