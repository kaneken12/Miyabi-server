require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const SessionManager = require('./src/core/sessionManager');
const { router: apiRouter, setSessionManager } = require('./src/routes/api');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

// ── Middleware ──
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Session Manager ──
const sessionManager = new SessionManager(io);
setSessionManager(sessionManager);

// Nettoyage des sessions inactives toutes les 5 min
setInterval(() => sessionManager.cleanupStaleSessions(), 300000);

// ── Routes API ──
app.use('/api', apiRouter);

// ── Route principale → page web ──
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Socket.io — Gestion des rooms par session ──
io.on('connection', (socket) => {
    console.log(`🔌 Client connecté: ${socket.id}`);

    // Le client rejoint sa room de session
    socket.on('join_session', (sessionId) => {
        socket.join(sessionId);
        console.log(`📡 Client ${socket.id} rejoint session: ${sessionId}`);

        // Envoyer le statut actuel si session existe déjà
        const status = sessionManager.getStatus(sessionId);
        if (status !== 'not_found') {
            socket.emit('status_update', { status });
        }
    });

    socket.on('disconnect', () => {
        console.log(`🔌 Client déconnecté: ${socket.id}`);
    });
});

// ── Démarrage ──
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n🎀 Miyabi Server démarré`);
    console.log(`🌐 Interface: http://localhost:${PORT}`);
    console.log(`📡 API: http://localhost:${PORT}/api\n`);
});
