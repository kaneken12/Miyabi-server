const personality = require('../core/personality');
const gemini = require('../core/gemini');
const stickerHandler = require('./stickerHandler');
const downloadService = require('../services/downloadService');
const searchService = require('../services/searchService');
const groupService = require('../services/groupService');
const logger = require('../utils/logger');
const fs = require('fs');

class MessageHandler {

    // ──────────────────────────────────────────────
    // Point d'entrée principal
    // ──────────────────────────────────────────────
    async handleMessage(sock, message, isGroup = false) {
        try {
            const sender = message.key.remoteJid;
            const senderNumber = message.key.participant || sender;
            const messageText = this._extractText(message);
            const mentionedJids = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];

            if (!messageText) {
                // Vérifier si c'est une vidéo envoyée (pour conversion)
                await this._handleMediaMessage(sock, message, senderNumber, isGroup, sender);
                return;
            }

            const isMother = personality.isMother(senderNumber);
            const isOwner = personality.isOwner(senderNumber);

            // En groupe: répondre seulement si mentionné ou si "miyabi" dans le texte
            if (isGroup) {
                const botMentioned = this._isBotMentioned(message);
                const nameMentioned = messageText.toLowerCase().includes('miyabi');
                if (!botMentioned && !nameMentioned && !isMother) return;
            }

            logger.info(`📨 Message de ${senderNumber}: "${messageText.slice(0, 60)}"`);

            // Commande admin spéciale (owner uniquement)
            if (isOwner && messageText.startsWith('!')) {
                await this._handleAdminCommand(sock, sender, messageText, senderNumber);
                return;
            }

            // ── Détecter l'intention via Gemini ──
            const intentData = await gemini.detectIntent(messageText);
            logger.info(`🧠 Intention: ${intentData.intent} (confiance: ${intentData.confidence})`);

            const emotion = personality.getCurrentEmotion();

            // Envoyer un accusé de réception pour les actions longues
            const isLongAction = ['DOWNLOAD_AUDIO', 'DOWNLOAD_VIDEO', 'SEARCH_WEB', 'CONVERT_TO_AUDIO'].includes(intentData.intent);
            if (isLongAction) {
                const ackMsg = await gemini.generateActionResponse(emotion.name, intentData.intent, intentData.params);
                await this._sendText(sock, sender, ackMsg);
            }

            // ── Router vers le bon handler ──
            switch (intentData.intent) {
                case 'DOWNLOAD_AUDIO':
                    await this._handleDownloadAudio(sock, sender, intentData.params, emotion);
                    break;

                case 'DOWNLOAD_VIDEO':
                    await this._handleDownloadVideo(sock, sender, intentData.params, emotion);
                    break;

                case 'SEARCH_WEB':
                    await this._handleSearch(sock, sender, intentData.params, emotion);
                    break;

                case 'GROUP_ACTION':
                    if (isGroup) {
                        await this._handleGroupAction(sock, sender, messageText, intentData.params, mentionedJids, emotion, isOwner);
                    } else {
                        await this._sendText(sock, sender, '...Je gère les groupes seulement dans un groupe. Logique, non ?');
                    }
                    break;

                case 'CONVERT_TO_AUDIO':
                    await this._sendText(sock, sender, await gemini.generateErrorResponse(emotion.name, 'NO_VIDEO'));
                    break;

                case 'CHAT':
                default:
                    await this._handleChat(sock, sender, message, senderNumber, messageText, emotion, isMother);
                    break;
            }

        } catch (error) {
            logger.error('Erreur handleMessage:', error);
        }
    }

    // ──────────────────────────────────────────────
    // CHAT - Réponse conversationnelle
    // ──────────────────────────────────────────────
    async _handleChat(sock, sender, message, senderNumber, messageText, emotion, isMother) {
        let response = await gemini.generateChatResponse(senderNumber, messageText, emotion.name, isMother);

        if (isMother) {
            response = `(｡•́︿•̀｡) ... ${response}`;
        }

        await this._sendText(sock, sender, response);

        // Envoyer sticker si activé dans .env (SEND_STICKERS=true)
        const stickersEnabled = process.env.SEND_STICKERS !== 'false';
        if (stickersEnabled) {
            const stickerBuffer = await stickerHandler.getStickerBuffer(emotion.sticker);
            if (stickerBuffer) {
                await sock.sendMessage(sender, { sticker: stickerBuffer });
            }
        }
    }

    // ──────────────────────────────────────────────
    // DOWNLOAD AUDIO
    // ──────────────────────────────────────────────
    async _handleDownloadAudio(sock, sender, params, emotion) {
        const query = params.query;
        if (!query) {
            await this._sendText(sock, sender, 'Quel morceau tu veux ? Donne-moi un titre ou un artiste.');
            return;
        }

        const result = await downloadService.downloadAudio(query);

        if (result.success) {
            try {
                await sock.sendMessage(sender, {
                    audio: { url: result.path },
                    mimetype: 'audio/mpeg',
                    fileName: result.fileName,
                    ptt: false
                });
                logger.info(`✅ Audio envoyé: ${result.fileName}`);
            } catch (err) {
                logger.error('Erreur envoi audio:', err.message);
                await this._sendText(sock, sender, await gemini.generateErrorResponse(emotion.name, 'DOWNLOAD_FAILED'));
            } finally {
                downloadService.cleanup(result.path);
            }
        } else {
            await this._sendText(sock, sender, await gemini.generateErrorResponse(emotion.name, result.error || 'DOWNLOAD_FAILED'));
        }
    }

    // ──────────────────────────────────────────────
    // DOWNLOAD VIDEO
    // ──────────────────────────────────────────────
    async _handleDownloadVideo(sock, sender, params, emotion) {
        const query = params.query;
        if (!query) {
            await this._sendText(sock, sender, 'Quelle vidéo tu veux ? Donne-moi un titre ou une URL.');
            return;
        }

        const result = await downloadService.downloadVideo(query);

        if (result.success) {
            try {
                await sock.sendMessage(sender, {
                    video: { url: result.path },
                    mimetype: 'video/mp4',
                    fileName: result.fileName
                });
                logger.info(`✅ Vidéo envoyée: ${result.fileName}`);
            } catch (err) {
                logger.error('Erreur envoi vidéo:', err.message);
                await this._sendText(sock, sender, await gemini.generateErrorResponse(emotion.name, 'DOWNLOAD_FAILED'));
            } finally {
                downloadService.cleanup(result.path);
            }
        } else {
            await this._sendText(sock, sender, await gemini.generateErrorResponse(emotion.name, result.error || 'DOWNLOAD_FAILED'));
        }
    }

    // ──────────────────────────────────────────────
    // SEARCH WEB
    // ──────────────────────────────────────────────
    async _handleSearch(sock, sender, params, emotion) {
        const query = params.query;
        if (!query) {
            await this._sendText(sock, sender, 'Tu cherches quoi exactement ?');
            return;
        }

        const rawResults = await searchService.search(query);

        if (rawResults) {
            const formatted = await searchService.formatResultsWithAI(query, rawResults, gemini, emotion.name);
            await this._sendText(sock, sender, formatted || rawResults.slice(0, 1000));
        } else {
            await this._sendText(sock, sender, await gemini.generateErrorResponse(emotion.name, 'SEARCH_FAILED'));
        }
    }

    // ──────────────────────────────────────────────
    // GROUP ACTION
    // ──────────────────────────────────────────────
    async _handleGroupAction(sock, groupId, messageText, params, mentionedJids, emotion, isOwner) {
        // Vérifier si le bot est admin
        const botIsAdmin = await groupService.isBotAdmin(sock, groupId);
        if (!botIsAdmin) {
            await this._sendText(sock, groupId, 'Je suis pas admin ici. Donne-moi les droits d\'abord.');
            return;
        }

        const actionData = groupService.parseGroupAction(params, messageText);
        const result = await groupService.executeAction(sock, groupId, actionData, mentionedJids);

        if (result.success) {
            if (result.action === 'WELCOME_MSG') {
                await this._sendText(sock, groupId, 'Message de bienvenue activé. Je vais accueillir les nouveaux membres... à ma façon.');
            } else {
                // Réponse Miyabi courte après action réussie
                await this._sendText(sock, groupId, 'Fait. De rien.');
            }
        } else {
            await this._sendText(sock, groupId, await gemini.generateErrorResponse(emotion.name, result.error || 'GROUP_FORBIDDEN'));
        }
    }

    // ──────────────────────────────────────────────
    // MEDIA REÇU (vidéo pour conversion)
    // ──────────────────────────────────────────────
    async _handleMediaMessage(sock, message, senderNumber, isGroup, sender) {
        const videoMsg = message.message?.videoMessage;
        if (!videoMsg) return;

        // Vérifier si c'est une demande de conversion (caption ou contexte)
        const caption = videoMsg.caption || '';
        const wantsConvert = caption.toLowerCase().includes('mp3') ||
                             caption.toLowerCase().includes('audio') ||
                             caption.toLowerCase().includes('convertis') ||
                             caption.toLowerCase().includes('extrait');

        if (!wantsConvert) return;

        const emotion = personality.getCurrentEmotion();
        await this._sendText(sock, sender, 'Je convertis ça... attends.');

        try {
            const { downloadMediaMessage } = require('@whiskeysockets/baileys');
            const buffer = await downloadMediaMessage(message, 'buffer', {});
            const tempVideoPath = require('path').join(__dirname, '../../temp', `vid_${Date.now()}.mp4`);
            require('fs').writeFileSync(tempVideoPath, buffer);

            const result = await downloadService.convertVideoToAudio(tempVideoPath);
            downloadService.cleanup(tempVideoPath);

            if (result.success) {
                await sock.sendMessage(sender, {
                    audio: { url: result.path },
                    mimetype: 'audio/mpeg',
                    ptt: false
                });
                downloadService.cleanup(result.path);
            } else {
                await this._sendText(sock, sender, await gemini.generateErrorResponse(emotion.name, 'DOWNLOAD_FAILED'));
            }
        } catch (err) {
            logger.error('Erreur conversion vidéo reçue:', err.message);
            await this._sendText(sock, sender, await gemini.generateErrorResponse(emotion.name, 'DOWNLOAD_FAILED'));
        }
    }

    // ──────────────────────────────────────────────
    // COMMANDES ADMIN (owner uniquement, préfixe !)
    // ──────────────────────────────────────────────
    async _handleAdminCommand(sock, sender, text, senderNumber) {
        const cmd = text.slice(1).trim().toLowerCase();

        if (cmd === 'reset') {
            gemini.clearHistory(senderNumber);
            await this._sendText(sock, sender, 'Mémoire effacée.');
        } else if (cmd.startsWith('humeur ')) {
            const emotion = cmd.replace('humeur ', '');
            const ok = personality.setEmotion(emotion);
            await this._sendText(sock, sender, ok ? `Humeur changée: ${emotion}` : 'Humeur inconnue.');
        } else {
            await this._sendText(sock, sender, 'Commande inconnue.');
        }
    }

    // ── Helpers ──
    _extractText(message) {
        return message.message?.conversation ||
               message.message?.extendedTextMessage?.text ||
               message.message?.imageMessage?.caption ||
               '';
    }

    _isBotMentioned(message) {
        const mentioned = message.message?.extendedTextMessage?.contextInfo?.mentionedJid;
        if (!mentioned) return false;
        // Vérifier si le JID du bot est dans les mentions
        return mentioned.length > 0;
    }

    async _sendText(sock, jid, text) {
        try {
            await sock.sendMessage(jid, { text });
        } catch (err) {
            logger.error('Erreur envoi texte:', err.message);
        }
    }
}

module.exports = new MessageHandler();
