const { GoogleGenerativeAI } = require('@google/generative-ai');
const personality = require('./personality');
const logger = require('../utils/logger');

class GeminiAI {
    constructor() {
        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        this.model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        this.conversations = new Map();
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
- DOWNLOAD_AUDIO : télécharger une musique ou chanson (ex: "télécharge X", "envoie la chanson Y")
- DOWNLOAD_VIDEO : télécharger une vidéo (ex: "télécharge la vidéo X")
- SEARCH_WEB : recherche internet, actualité (ex: "cherche X", "c'est quoi Y")
- GROUP_ACTION : gestion de groupe (kick, add, description, verrouillage)
- CONVERT_TO_AUDIO : convertir vidéo en audio

Pour DOWNLOAD_AUDIO et DOWNLOAD_VIDEO: ajoute params.query avec le titre/artiste
Pour SEARCH_WEB: ajoute params.query avec la requête
Pour GROUP_ACTION: ajoute params.action et params.target`;

        try {
            const result = await this.model.generateContent(prompt);
            const text = result.response.text().trim();

            // Nettoyage robuste : extraire uniquement le JSON
            const clean = this._extractJSON(text);
            if (!clean) throw new Error('Pas de JSON valide dans la réponse');

            const parsed = JSON.parse(clean);

            // Vérifier que l'intent est valide
            const validIntents = ['CHAT','DOWNLOAD_AUDIO','DOWNLOAD_VIDEO','SEARCH_WEB','GROUP_ACTION','CONVERT_TO_AUDIO'];
            if (!validIntents.includes(parsed.intent)) {
                parsed.intent = 'CHAT';
            }

            return parsed;

        } catch (error) {
            logger.warn('Fallback intent → CHAT:', error.message);
            return { intent: 'CHAT', confidence: 0.5, params: {} };
        }
    }

    // ──────────────────────────────────────────────
    // Extraire le JSON d'une réponse Gemini
    // Même si Gemini ajoute du texte autour
    // ──────────────────────────────────────────────
    _extractJSON(text) {
        // Supprimer les backticks markdown
        let clean = text.replace(/```json/gi, '').replace(/```/g, '').trim();

        // Chercher le premier { et le dernier }
        const start = clean.indexOf('{');
        const end = clean.lastIndexOf('}');

        if (start === -1 || end === -1 || end < start) return null;

        return clean.substring(start, end + 1);
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

            const result = await this.model.generateContent(fullPrompt);
            let response = result.response.text().trim();

            // Sécurité : si la réponse ressemble à du JSON, ne pas l'envoyer
            if (response.startsWith('{') || response.startsWith('[')) {
                logger.warn('Gemini a retourné du JSON dans le chat, fallback utilisé');
                response = personality.fallbackResponse(emotion);
            }

            // Sauvegarder dans l'historique
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
IMPORTANT: réponds en UNE SEULE phrase courte, en français naturel, sans émojis, sans JSON, sans code.`;

        try {
            const result = await this.model.generateContent(prompt);
            let response = result.response.text().trim();

            // Sécurité : si JSON retourné, fallback
            if (response.startsWith('{') || response.startsWith('[')) {
                return '...Je m\'en occupe.';
            }

            return response;
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
IMPORTANT: UNE seule phrase, en français, sans émojis, sans JSON, sans code.`;

        try {
            const result = await this.model.generateContent(prompt);
            let response = result.response.text().trim();

            if (response.startsWith('{') || response.startsWith('[')) {
                return '...Quelque chose a merdé. Réessaie.';
            }

            return response;
        } catch {
            return '...Quelque chose a merdé. Réessaie.';
        }
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
