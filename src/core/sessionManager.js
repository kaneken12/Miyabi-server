const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const path = require('path');
const fs = require('fs');

const messageHandler = require('../../src/handlers/messageHandler');

const SESSIONS_DIR = path.join(__dirname, '../../sessions');
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

const activeSessions = new Map();

class SessionManager {
    constructor(io) {
        this.io = io;
        this.phoneIndex = new Map();
    }

    async createSession(sessionId, phoneNumber) {
        if (activeSessions.has(sessionId)) {
            var existing = activeSessions.get(sessionId);
            if (existing.status === 'connected') {
                return { success: false, error: 'already_connected' };
            }
        }

        var sessionPath = path.join(SESSIONS_DIR, sessionId);
        if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });

        var authData = await useMultiFileAuthState(sessionPath);
        var state = authData.state;
        var saveCreds = authData.saveCreds;

        var sock = makeWASocket({
            printQRInTerminal: false,
            auth: state,
            logger: pino({ level: 'silent' }),
            browser: ['Ubuntu', 'Chrome', '20.0.04']
        });

        activeSessions.set(sessionId, {
            sock: sock,
            status: 'pending',
            phone: phoneNumber,
            createdAt: Date.now()
        });

        this.phoneIndex.set(phoneNumber, sessionId);

        var self = this;
        var codeSent = false;

        // ── Pairing code : demander dès que Baileys commence à se connecter ──
        if (!sock.authState.creds.registered && phoneNumber) {
            sock.ev.on('connection.update', async function(update) {
                var connection = update.connection;
                var qr = update.qr;

                if ((connection === 'connecting' || qr) && !codeSent) {
                    codeSent = true;
                    await new Promise(function(r) { setTimeout(r, 3000); });
                    try {
                        var rawCode = await sock.requestPairingCode(
                            phoneNumber.replace(/\D/g, '')
                        );
                        var code = rawCode.match(/.{1,4}/g).join('-');
                        console.log('Code genere:', code);
                        self.io.to(sessionId).emit('pairing_code', { code: code });
                        self._updateStatus(sessionId, 'pairing');
                    } catch (error) {
                        console.error('PAIRING ERROR:', error.message);
                        self.io.to(sessionId).emit('error', {
                            message: 'Echec du code. Reessaie dans 30 secondes.'
                        });
                    }
                }
            });
        }

        // ── Events connexion ──
        sock.ev.on('connection.update', async function(update) {
            var connection = update.connection;
            var lastDisconnect = update.lastDisconnect;

            if (connection === 'open') {
                self._updateStatus(sessionId, 'connected');
                self.io.to(sessionId).emit('connected', {
                    message: 'Miyabi est connectee !',
                    phone: phoneNumber
                });
                try {
                    await sock.sendMessage(phoneNumber + '@s.whatsapp.net', {
                        text: "...Je suis la. Envoie-moi un message pour commencer."
                    });
                } catch (e) {
                    console.error('Message bienvenue echoue:', e.message);
                }
            }

            if (connection === 'close') {
                var statusCode = null;
                if (lastDisconnect && lastDisconnect.error && lastDisconnect.error instanceof Boom) {
                    statusCode = lastDisconnect.error.output.statusCode;
                }
                console.log('Connexion fermee, code:', statusCode);

                if (statusCode === DisconnectReason.loggedOut) {
                    self._updateStatus(sessionId, 'logged_out');
                    self.io.to(sessionId).emit('disconnected', { reason: 'logged_out' });
                    self.deleteSession(sessionId);
                } else {
                    self._updateStatus(sessionId, 'reconnecting');
                    self.io.to(sessionId).emit('reconnecting');
                    setTimeout(function() {
                        self.createSession(sessionId, phoneNumber);
                    }, 5000);
                }
            }
        });

        // ── Messages entrants ──
        sock.ev.on('messages.upsert', async function(data) {
            if (data.type !== 'notify') return;
            for (var i = 0; i < data.messages.length; i++) {
                var msg = data.messages[i];
                if (msg.key.fromMe) continue;
                var isGroup = msg.key.remoteJid && msg.key.remoteJid.endsWith('@g.us');
                await messageHandler.handleMessage(sock, msg, isGroup);
            }
        });

        // ── Nouveaux membres groupe ──
        sock.ev.on('group-participants.update', async function(data) {
            if (data.action !== 'add') return;
            for (var i = 0; i < data.participants.length; i++) {
                var participant = data.participants[i];
                var number = participant.split('@')[0];
                try {
                    await sock.sendMessage(data.id, {
                        text: '@' + number + " a rejoint. ...Bienvenue, j'imagine.",
                        mentions: [participant]
                    });
                } catch (e) {}
            }
        });

        sock.ev.on('creds.update', saveCreds);

        return { success: true };
    }

    deleteSession(sessionId) {
        var session = activeSessions.get(sessionId);
        if (session && session.sock) {
            try { session.sock.end(); } catch (e) {}
        }
        activeSessions.delete(sessionId);
        if (session && session.phone) {
            this.phoneIndex.delete(session.phone);
        }
        var sessionPath = path.join(SESSIONS_DIR, sessionId);
        if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
        }
    }

    getSession(sessionId) {
        return activeSessions.get(sessionId);
    }

    getStatus(sessionId) {
        var session = activeSessions.get(sessionId);
        return session ? session.status : 'not_found';
    }

    _updateStatus(sessionId, status) {
        var session = activeSessions.get(sessionId);
        if (session) {
            session.status = status;
            activeSessions.set(sessionId, session);
        }
    }

    cleanupStaleSessions() {
        var now = Date.now();
        for (var entry of activeSessions.entries()) {
            var id = entry[0];
            var session = entry[1];
            if (session.status === 'pending' && now - session.createdAt > 600000) {
                this.deleteSession(id);
            }
        }
    }
}

module.exports = SessionManager;
