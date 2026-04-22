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
            const existing = activeSessions.get(sessionId);
            if (existing.status === 'connected') {
                return { success: false, error: 'already_connected' };
            }
        }

        const sessionPath = path.join(SESSIONS_DIR, sessionId);
        if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });

        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

        const sock = makeWASocket({
            printQRInTerminal: false,
            auth: state,
            logger: pino({ level: 'silent' }),
            browser: ['Ubuntu', 'Chrome', '20.0.04']
        });

        activeSessions.set(sessionId, {
            sock,
            status: 'pending',
            phone: phoneNumber,
            createdAt: Date.now()
        });

        this.phoneIndex.set(phoneNumber, sessionId);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                this.io.to(sessionId).emit('qr', { qr });
                this._updateStatus(sessionId, 'qr_ready');
            }

            if (connection === 'open') {
                this._updateStatus(sessionId, 'connected');
                this.io.to(sessionId).emit('connected', {
                    message: 'Miyabi est connectee !',
                    phone: phoneNumber
                });

                try {
                    await sock.sendMessage(phoneNumber + '@s.whatsapp.net', {
                        text: "...Je suis la. T'as paye pour ca alors je vais faire mon travail. Envoie-moi un message pour commencer."
                    });
                } catch (e) {}
            }

            if (connection === 'close') {
                var statusCode = null;
                if (lastDisconnect && lastDisconnect.error instanceof Boom) {
                    statusCode = lastDisconnect.error.output.statusCode;
                }

                if (statusCode === DisconnectReason.loggedOut) {
                    this._updateStatus(sessionId, 'logged_out');
                    this.io.to(sessionId).emit('disconnected', { reason: 'logged_out' });
                    this.deleteSession(sessionId);
                } else {
                    this._updateStatus(sessionId, 'reconnecting');
                    this.io.to(sessionId).emit('reconnecting');
                    var self = this;
                    setTimeout(function() {
                        self.createSession(sessionId, phoneNumber);
                    }, 5000);
                }
            }
        });

        sock.ev.on('messages.upsert', async function(data) {
            var messages = data.messages;
            var type = data.type;
            if (type !== 'notify') return;
            for (var i = 0; i < messages.length; i++) {
                var msg = messages[i];
                if (msg.key.fromMe) continue;
                var isGroup = msg.key.remoteJid && msg.key.remoteJid.endsWith('@g.us');
                await messageHandler.handleMessage(sock, msg, isGroup);
            }
        });

        sock.ev.on('group-participants.update', async function(data) {
            var id = data.id;
            var participants = data.participants;
            var action = data.action;
            if (action === 'add') {
                for (var i = 0; i < participants.length; i++) {
                    var participant = participants[i];
                    var number = participant.split('@')[0];
                    try {
                        await sock.sendMessage(id, {
                            text: '@' + number + ' a rejoint. ...Bienvenue, j\'imagine.',
                            mentions: [participant]
                        });
                    } catch (e) {}
                }
            }
        });

        sock.ev.on('creds.update', saveCreds);

        if (!sock.authState.creds.registered && phoneNumber) {
            await new Promise(function(r) { setTimeout(r, 5000); });
            try {
                var rawCode = await sock.requestPairingCode(phoneNumber.replace(/\D/g, ''));
                // Formater en XXXX-XXXX
                var code = rawCode.match(/.{1,4}/g).join('-');
                this.io.to(sessionId).emit('pairing_code', { code: code });
                this._updateStatus(sessionId, 'pairing');
                return { success: true, code: code };
            } catch (error) {
    console.error('PAIRING ERROR:', error);
    this.io.to(sessionId).emit('error', { message: error.message || 'Erreur inconnue' });
    return { success: false, error: error.message };
}
        }

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
