const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const readline = require('readline');
const fs = require('fs');
const logger = require('../utils/logger');
const messageHandler = require('../handlers/messageHandler');
const personality = require('./personality');
const { inspectMessage } = require('../utils/messageSanitizer');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (q) => new Promise((res) => rl.question(q, res));

async function setupWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    const sock = makeWASocket({
        printQRInTerminal: false,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['Miyabi Bot', 'Chrome', '120.0.0'],
        generateHighQualityLinkPreview: true
    });

    // ── Connexion ──
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            logger.info('📱 QR Code disponible - utilise le code d\'appairage ci-dessous');
        }

        if (connection === 'open') {
            logger.info('✅ Miyabi connectée à WhatsApp!');
            logger.info(`🎭 Humeur actuelle: ${personality.getCurrentEmotion().name}`);

            // Message de démarrage à l'owner
            setTimeout(async () => {
                try {
                    await sock.sendMessage(`${process.env.OWNER_NUMBER}@s.whatsapp.net`, {
                        text: `...Je suis en ligne. T'as besoin de rien d'autre j'espère.`
                    });
                } catch (e) {
                    logger.warn('Message owner échoué:', e.message);
                }
            }, 3000);
        }

        if (connection === 'close') {
            const statusCode = (lastDisconnect?.error instanceof Boom)
                ? lastDisconnect.error.output?.statusCode
                : null;

            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            logger.info(`❌ Connexion fermée (code: ${statusCode})`);

            if (shouldReconnect) {
                logger.info('🔄 Reconnexion dans 5s...');
                setTimeout(() => setupWhatsApp(), 5000);
            } else {
                logger.info('🔐 Session expirée - suppression des credentials');
                fs.rmSync('./auth_info', { recursive: true, force: true });
                logger.info('Relance le bot pour te reconnecter.');
                process.exit(0);
            }
        }
    });

    // ── Messages entrants ──
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
            if (msg.key.fromMe) continue; // Ignorer nos propres messages

            // ── SANITISATION ──────────────────────────────────────
            const check = inspectMessage(msg);
            if (check.suspicious) {
                const from = msg.key.remoteJid;
                logger.warn(`⚠️  [SANITIZER] Message suspect bloqué — De: ${from} — Raison: ${check.reason}`);
                try {
                    await sock.chatModify(
                        {
                            delete: true,
                            lastMessages: [{
                                key: msg.key,
                                messageTimestamp: msg.messageTimestamp,
                            }],
                        },
                        from
                    );
                    logger.info(`🗑️  [SANITIZER] Message supprimé automatiquement.`);
                } catch (e) {
                    logger.error(`[SANITIZER] Echec suppression : ${e.message}`);
                }
                continue; // Ne pas traiter ce message
            }
            // ── FIN SANITISATION ──────────────────────────────────

            const isGroup = msg.key.remoteJid?.endsWith('@g.us');
            await messageHandler.handleMessage(sock, msg, isGroup);
        }
    });

    // ── Nouveaux membres dans un groupe ──
    sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
        if (action === 'add') {
            try {
                const metadata = await sock.groupMetadata(id);
                for (const participant of participants) {
                    const number = participant.split('@')[0];
                    await sock.sendMessage(id, {
                        text: `@${number} a rejoint le groupe. ...Bienvenue, j'imagine.`,
                        mentions: [participant]
                    });
                }
            } catch (e) {
                logger.warn('Erreur message bienvenue:', e.message);
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // ── Appairage si pas encore connecté ──
    if (!sock.authState.creds.registered) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const phone = await question('📱 Numéro WhatsApp (avec indicatif, ex: 237692798136): ');
        try {
            const code = await sock.requestPairingCode(phone.trim());
            logger.info(`\n🔐 ══════════════════════════`);
            logger.info(`   Code d'appairage: ${code}`);
            logger.info(`🔐 ══════════════════════════`);
            logger.info('⚠️  WhatsApp > Appareils liés > Connecter un appareil > Entrer le code');
        } catch (error) {
            logger.error('Erreur code appairage:', error.message);
        }
    }

    return sock;
}

module.exports = { setupWhatsApp };
