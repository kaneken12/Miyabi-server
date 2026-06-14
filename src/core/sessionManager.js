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

        // ── Events de connexion ──
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            // QR code reçu → envoyer au frontend
            if (qr) {
                console.log('QR code généré pour session:', sessionId);
                this.io.to(sessionId).emit('qr', { qr });
                this._updateStatus(sessionId, 'qr_ready');
            }

            if (connection === 'open') {
                this._updateStatus(sessionId, 'connected');
                this.io.to(sessionId).emit('connected', {
                    message: 'Miyabi est connectée !',
                    phone: phoneNumber
                });
                try {
                    await sock.sendMessage(`${phoneNumber}@s.whatsapp.net`, {
                        text: `...Je suis là. T'as payé pour ça alors je vais faire mon travail. Envoie-moi un message pour commencer.`
                    });
                } catch (e) {}
            }

            if (connection === 'close') {
                const statusCode = (lastDisconnect?.error instanceof Boom)
                    ? lastDisconnect.error.output?.statusCode : null;

                console.log('Connexion fermée, code:', statusCode);

                if (statusCode === DisconnectReason.loggedOut) {
                    this._updateStatus(sessionId, 'logged_out');
                    this.io.to(sessionId).emit('disconnected', { reason: 'logged_out' });
                    this.deleteSession(sessionId);
                } else {
                    this._updateStatus(sessionId, 'reconnecting');
                    this.io.to(sessionId).emit('reconnecting');
                    setTimeout(() => this.createSession(sessionId, phoneNumber), 5000);
                }
            }
        });

        // ── Messages entrants ──
        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;
            for (const msg of messages) {
                if (msg.key.fromMe) continue;
                const isGroup = msg.key.remoteJid?.endsWith('@g.us');
                await messageHandler.handleMessage(sock, msg, isGroup);
            }
        });

        // ── Nouveaux membres groupe ──
        sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
            if (action === 'add') {
                for (const participant of participants) {
                    const number = participant.split('@')[0];
                    try {
                        await sock.sendMessage(id, {
                            text: `@${number} a rejoint. ...Bienvenue, j'imagine.`,
                            mentions: [participant]
                        });
                    } catch (e) {}
                }
            }
        });

        sock.ev.on('creds.update', saveCreds);

        return { success: true };
    }

    deleteSession(sessionId) {
        const session = activeSessions.get(sessionId);
        if (session?.sock) {
            try { session.sock.end(); } catch (e) {}
        }
        activeSessions.delete(sessionId);
        if (session?.phone) this.phoneIndex.delete(session.phone);

        const sessionPath = path.join(SESSIONS_DIR, sessionId);
        if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
        }
    }

    getSession(sessionId) { return activeSessions.get(sessionId); }

    getStatus(sessionId) {
        return activeSessions.get(sessionId)?.status || 'not_found';
    }

    _updateStatus(sessionId, status) {
        const session = activeSessions.get(sessionId);
        if (session) {
            session.status = status;
            activeSessions.set(sessionId, session);
        }
    }

    cleanupStaleSessions() {
        const now = Date.now();
        for (const [id, session] of activeSessions.entries()) {
            if (session.status === 'pending' && now - session.createdAt > 600000) {
                this.deleteSession(id);
            }
        }
    }
}

module.exports = SessionManager;
