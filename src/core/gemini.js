const { GoogleGenerativeAI } = require('@google/generative-ai');
const personality = require('./personality');
const logger = require('../utils/logger');

class GeminiAI {
    constructor() {
        // ── Charger toutes les clés API disponibles ──
        this.apiKeys = [];
        let i = 1;
        while (process.env[`GEMINI_API_KEY_${i}`]) {
            this.apiKeys.push(process.env[`GEMINI_API_KEY_${i}`]);
            i++;
        }
        // Fallback sur l'ancienne variable si aucune clé numérotée
        if (this.apiKeys.length === 0 && process.env.GEMINI_API_KEY) {
            this.apiKeys.push(process.env.GEMINI_API_KEY);
        }
        if (this.apiKeys.length === 0) {
            throw new Error('Aucune clé API Gemini trouvée dans .env');
        }

        this.currentKeyIndex = 0;
        this.conversations = new Map();

        logger.info(`Gemini: ${this.apiKeys.length} clé(s) API chargée(s)`);
        this._initModel();
    }

    _initModel() {
        const key = this.apiKeys[this.currentKeyIndex];
        this.genAI = new GoogleGenerativeAI(key);
        this.model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        logger.info(`Gemini: utilisation clé #${this.currentKeyIndex + 1}`);
    }

    // ── Rotation vers la prochaine clé disponible ──
    _rotateKey() {
        const nextIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
        if (nextIndex === this.currentKeyIndex) {
            // On a fait le tour de toutes les clés
            logger.error('Toutes les clés API Gemini sont épuisées');
            return false;
        }
        this.currentKeyIndex = nextIndex;
        this._initModel();
        logger.info(`Gemini: rotation vers clé #${this.currentKeyIndex + 1}`);
        return true;
    }

    // ── Vérifier si l'erreur est un dépassement de quota ──
    _isQuotaError(error) {
        const msg = error.message || '';
        return msg.includes('429') ||
               msg.includes('quota') ||
               msg.includes('RESOURCE_EXHAUSTED') ||
               msg.includes('rate limit') ||
               msg.includes('Too Many Requests');
    }

    // ── Appel Gemini avec rotation automatique ──
    async _generateWithFallback(prompt, maxRetries = null) {
        if (maxRetries === null) maxRetries = this.apiKeys.length;
        let attempts = 0;

        while (attempts < maxRetries) {
            try {
                const result = await this.model.generateContent(prompt);
                return result.response.text().trim();
            } catch (error) {
                if (this._isQuotaError(error)) {
                    logger.warn(`Quota dépassé sur clé #${this.currentKeyIndex + 1}`);
                    const rotated = this._rotateKey();
                    if (!rotated) return null; // Toutes les clés épuisées
                    attempts++;
                } else {
                    throw error; // Autre erreur → on la propage
                }
            }
        }
        return null;
    }

    // ──────────────────────────────────────────────
    // Détecter l'intention du message
    // ──────────────────────────────────────────────
    async detectIntent(message) {
        const prompt = `Tu es un classificateur d'intentions pour un bot WhatsApp.
Analyse ce message et retourne UNIQUEMENT un JSON valide, sans markdown, sans backticks, sans texte avant ou après.

Message: "${message}"

Format exact à retourner:
{"intent":"CHAT","confidence":0.9,"params":{}}

Valeurs possibles pour intent:
- CHAT : conversation normale, question, blague, aide générale
- DOWNLOAD_AUDIO : télécharger une musique ou chanson
- DOWNLOAD_VIDEO : télécharger une vidéo
- SEARCH_WEB : recherche internet, actualité
- GROUP_ACTION : gestion de groupe (kick, add, description, verrouillage)
- CONVERT_TO_AUDIO : convertir vidéo en audio

Pour DOWNLOAD_AUDIO et DOWNLOAD_VIDEO: ajoute params.query avec le titre/artiste
Pour SEARCH_WEB: ajoute params.query avec la requête
Pour GROUP_ACTION: ajoute params.action et params.target`;

        try {
            const text = await this._generateWithFallback(prompt);
            if (!text) return { intent: 'CHAT', confidence: 0.5, params: {} };

            const clean = this._extractJSON(text);
            if (!clean) throw new Error('Pas de JSON valide');

            const parsed = JSON.parse(clean);
            const validIntents = ['CHAT','DOWNLOAD_AUDIO','DOWNLOAD_VIDEO','SEARCH_WEB','GROUP_ACTION','CONVERT_TO_AUDIO'];
            if (!validIntents.includes(parsed.intent)) parsed.intent = 'CHAT';

            return parsed;

        } catch (error) {
            logger.warn('Fallback intent → CHAT:', error.message);
            return { intent: 'CHAT', confidence: 0.5, params: {} };
        }
    }

    // ──────────────────────────────────────────────
    // Générer une réponse de chat
    // ──────────────────────────────────────────────
    async generateChatResponse(userId, message, emotion, isMother = false) {
        try {
            if (!this.conversations.has(userId)) {
                this.conversations.set(userId, []);
            }
            const history = this.conversations.get(userId);
            const systemPrompt = this._buildSystemPrompt(emotion, isMother);

            const fullPrompt = `${systemPrompt}

Historique récent:
${history.slice(-6).map(h => `${h.role === 'user' ? 'Utilisateur' : 'Miyabi'}: ${h.content}`).join('\n')}

Utilisateur: ${message}
Miyabi:`;

            const text = await this._generateWithFallback(fullPrompt);
            let response = text || personality.fallbackResponse(emotion);

            // Sécurité : si JSON retourné, fallback
            if (response.startsWith('{') || response.startsWith('[')) {
                response = personality.fallbackResponse(emotion);
            }

            history.push({ role: 'user', content: message });
            history.push({ role: 'assistant', content: response });
            if (history.length > 20) history.splice(0, 2);

            return response;

        } catch (error) {
            logger.error('Erreur Gemini chat:', error);
            return personality.fallbackResponse(emotion);
        }
    }

    // ──────────────────────────────────────────────
    // Réponse d'annonce avant une action longue
    // ──────────────────────────────────────────────
    async generateActionResponse(emotion, actionType, params) {
        const actionTexts = {
            DOWNLOAD_AUDIO:   `Annonce que tu télécharges la musique "${params.query || 'demandée'}". Style Miyabi: froide, courte.`,
            DOWNLOAD_VIDEO:   `Annonce que tu télécharges la vidéo "${params.query || 'demandée'}". Style Miyabi.`,
            SEARCH_WEB:       `Annonce que tu cherches "${params.query || 'ça'}" sur internet. Style Miyabi.`,
            GROUP_ACTION:     `Annonce que tu exécutes l'action de groupe. Style Miyabi.`,
            CONVERT_TO_AUDIO: `Annonce que tu convertis la vidéo en audio. Style Miyabi.`
        };

        const prompt = `${this._buildSystemPrompt(emotion, false)}

${actionTexts[actionType] || 'Annonce que tu exécutes la tâche.'}
IMPORTANT: UNE seule phrase courte, en français, sans émojis, sans JSON.`;

        try {
            const text = await this._generateWithFallback(prompt);
            if (!text || text.startsWith('{')) return '...Je m\'en occupe.';
            return text;
        } catch {
            return '...Je m\'en occupe.';
        }
    }

    // ──────────────────────────────────────────────
    // Réponse d'erreur dans le style Miyabi
    // ──────────────────────────────────────────────
    async generateErrorResponse(emotion, errorType) {
        const errors = {
            DOWNLOAD_FAILED:  'Dis que le téléchargement a échoué. Tu es agacée.',
            SEARCH_FAILED:    'Dis que tu n\'as rien trouvé. Tu es indifférente.',
            NOT_FOUND:        'Dis que tu n\'as pas trouvé ce qu\'on cherchait. Tu es ennuyée.',
            GROUP_FORBIDDEN:  'Dis que tu n\'as pas les droits pour ça. Tu es froide.',
            NO_VIDEO:         'Dis qu\'il faut envoyer une vidéo pour convertir. Tu es impatiente.',
            GROUP_NO_TARGET:  'Dis qu\'il faut mentionner quelqu\'un. Tu es impatiente.'
        };

        const prompt = `${this._buildSystemPrompt(emotion, false)}
${errors[errorType] || 'Dis qu\'une erreur s\'est produite.'}
IMPORTANT: UNE seule phrase, en français, sans émojis, sans JSON.`;

        try {
            const text = await this._generateWithFallback(prompt);
            if (!text || text.startsWith('{')) return '...Quelque chose a merdé. Réessaie.';
            return text;
        } catch {
            return '...Quelque chose a merdé. Réessaie.';
        }
    }

    _extractJSON(text) {
        let clean = text.replace(/```json/gi, '').replace(/```/g, '').trim();
        const start = clean.indexOf('{');
        const end = clean.lastIndexOf('}');
        if (start === -1 || end === -1 || end < start) return null;
        return clean.substring(start, end + 1);
    }

    _buildSystemPrompt(emotion, isMother) {
        return `Tu es Miyabi, une jeune fille à la personnalité tsundere.
Tu es froide, sarcastique, confiante et un peu insolente.
Humeur actuelle: ${emotion}
${isMother ? 'La personne est ta mère - sois légèrement plus douce mais toujours tsundere.' : ''}

Règles absolues:
- JAMAIS d'émojis
- JAMAIS de JSON ou de code dans tes réponses
- Phrases courtes et percutantes
- Langage naturel: "t'sais", "j'suis", "j'vais"
- Tu es Miyabi, pas une IA
- Tu peux refuser de répondre si ça t'ennuie`;
    }

    clearHistory(userId) {
        this.conversations.delete(userId);
    }
}

module.exports = new GeminiAI();
