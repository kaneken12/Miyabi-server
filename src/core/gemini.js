// ============================================================
//  src/core/gemini.js — Miyabi Telegram v2
//  UN seul appel Gemini — parsing robuste
// ============================================================

const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger      = require('../utils/logger');
const personality = require('./personality');

const INTENT_PROMPT = `
INSTRUCTIONS STRICTES :
Si le message contient une demande d'action, réponds UNIQUEMENT avec ce JSON sur une ligne :
{"intent":"ACTION","data":"valeur","response":"ta réponse naturelle"}

Si c'est une conversation normale, réponds UNIQUEMENT avec du texte normal, sans JSON.

Actions reconnues :
- DOWNLOAD_AUDIO : musique/audio demandé. data = "artiste titre"
- DOWNLOAD_VIDEO : vidéo demandée. data = URL ou "description en anglais"
- CONVERT_TO_AUDIO : convertir vidéo en audio. data = "convert"
- WEB_SEARCH : recherche internet. data = "requête"
- GROUP_LOCK : verrouiller groupe. data = "lock"
- GROUP_UNLOCK : déverrouiller groupe. data = "unlock"
- GROUP_INFO : infos du groupe. data = "info"
- RESET_CHAT : réinitialiser conversation. data = "reset"

Exemples stricts :
Message: "envoie Careless de Neffex"
Réponse: {"intent":"DOWNLOAD_AUDIO","data":"Neffex Careless","response":"*soupir* Tiens, White."}

Message: "bonjour comment tu vas"
Réponse: Bien. Qu'est-ce que tu veux, White ?

Message: "cherche les dernières news"
Réponse: {"intent":"WEB_SEARCH","data":"latest news today","response":"Je cherche ça, White."}

RAPPEL : JSON = action détectée. Texte pur = conversation normale. Jamais les deux mélangés.
`;

class GeminiService {
    constructor() {
        this.genAI     = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        this.model     = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        this.histories = new Map();
        this.userNames = new Map();
    }

    setUserName(userId, name) { this.userNames.set(userId, name); }
    getUserName(userId)       { return this.userNames.get(userId) || null; }
    isMother(userId)          { return String(userId) === String(process.env.MOTHER_ID); }

    // ── Un seul appel : réponse + intent combinés ─────────────
    async chat(userId, userText, userName) {
        try {
            if (userName && !this.userNames.has(userId))
                this.userNames.set(userId, userName);

            if (!this.histories.has(userId)) this.histories.set(userId, []);
            const history = this.histories.get(userId);

            const chat = this.model.startChat({
                history,
                generationConfig: {
                    maxOutputTokens: 1024,
                    temperature:     1.3,
                    topK:            50,
                    topP:            0.92,
                }
            });

            const prompt = `${personality.getSystemPrompt()}\n${INTENT_PROMPT}\n\nUtilisateur (${userName || 'Inconnu'}): ${userText}`;
            const res    = await chat.sendMessage(prompt);
            const raw    = res.response.text().trim();

            // Sauvegarder dans l'historique
            history.push({ role: 'user',  parts: [{ text: userText }] });
            history.push({ role: 'model', parts: [{ text: raw }] });
            if (history.length > 40) history.splice(0, 2);

            return this._parse(raw);

        } catch (err) {
            logger.error('[GEMINI] chat erreur:', err.message);
            return { intent: null, data: null, response: personality.getErrorMessage('UNKNOWN') };
        }
    }

    // ── Réponse rapide sans historique ───────────────────────
    async quickReply(prompt) {
        try {
            const res = await this.model.generateContent(
                `${personality.getSystemPrompt()}\n\n${prompt}`
            );
            return res.response.text().trim();
        } catch (err) {
            logger.error('[GEMINI] quickReply erreur:', err.message);
            return personality.getErrorMessage('UNKNOWN');
        }
    }

    // ── Parser robuste ───────────────────────────────────────
    _parse(raw) {
        // Nettoyer backticks
        const cleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim();

        // Chercher un JSON avec "intent"
        const start = cleaned.indexOf('{"intent"');
        if (start !== -1) {
            // Trouver la fin du JSON
            let depth = 0, end = -1;
            for (let i = start; i < cleaned.length; i++) {
                if (cleaned[i] === '{') depth++;
                if (cleaned[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
            }
            if (end > start) {
                try {
                    const parsed = JSON.parse(cleaned.slice(start, end));
                    if (parsed.intent && parsed.response) {
                        return { intent: parsed.intent, data: parsed.data || null, response: parsed.response };
                    }
                } catch (_) {}
            }
        }

        // Essayer de parser toute la réponse
        try {
            const parsed = JSON.parse(cleaned);
            if (parsed.intent && parsed.response)
                return { intent: parsed.intent, data: parsed.data || null, response: parsed.response };
        } catch (_) {}

        // Réponse texte normale
        return { intent: null, data: null, response: raw };
    }

    clearHistory(userId) { this.histories.delete(userId); }
}

module.exports = new GeminiService();
