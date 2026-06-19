require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const SessionManager = require('./src/core/sessionManager');
const { router: apiRouter, setSessionManager } = require('./src/routes/api');
const walletService = require('./src/services/walletService');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const sessionManager = new SessionManager(io);
setSessionManager(sessionManager);

setInterval(() => sessionManager.cleanupStaleSessions(), 300000);

app.use('/api', apiRouter);
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

io.on('connection', (socket) => {
    console.log(`🔌 Client connecté: ${socket.id}`);
    socket.on('join_session', (sessionId) => {
        socket.join(sessionId);
        console.log(`📡 Client ${socket.id} rejoint session: ${sessionId}`);
        const status = sessionManager.getStatus(sessionId);
        if (status !== 'not_found') {
            socket.emit('status_update', { status });
        }
    });
    socket.on('disconnect', () => {
        console.log(`🔌 Client déconnecté: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;

// Connecter MongoDB puis démarrer le serveur
walletService.connect().then(() => {
    server.listen(PORT, () => {
        console.log(`\n🎀 Miyabi Server démarré`);
        console.log(`🌐 Interface: http://localhost:${PORT}`);
        console.log(`📡 API: http://localhost:${PORT}/api\n`);
    });
}).catch(err => {
    console.error('Erreur MongoDB:', err.message);
    // Démarrer quand même sans MongoDB
    server.listen(PORT, () => {
        console.log(`\n🎀 Miyabi Server démarré (sans MongoDB)`);
        console.log(`🌐 Interface: http://localhost:${PORT}\n`);
    });
});
