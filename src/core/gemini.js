const { GoogleGenerativeAI } = require('@google/generative-ai');
const personality = require('./personality');
const logger = require('../utils/logger');

class GeminiAI {
    constructor() {
        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        // gemini-1.5-flash : rapide, gratuit, parfait pour ce use case
        this.model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        // Mémoire par utilisateur : Map<userId, messages[]>
        this.conversations = new Map();
    }

    // ──────────────────────────────────────────────
    // ÉTAPE 1 : Détecter l'intention du message
    // Retourne un objet JSON structuré
    // ──────────────────────────────────────────────
    async detectIntent(message) {
        const prompt = `Tu es un classificateur d'intentions pour un bot WhatsApp.
Analyse ce message et retourne UNIQUEMENT un JSON valide, sans markdown, sans backticks.

Message: "${message}"

Retourne ce format exact:
{
  "intent": "CHAT|DOWNLOAD_AUDIO|DOWNLOAD_VIDEO|SEARCH_WEB|GROUP_ACTION|CONVERT_TO_AUDIO",
  "confidence": 0.0-1.0,
  "params": {}
}

Règles de classification:
- CHAT: conversation normale, question, blague, aide générale
- DOWNLOAD_AUDIO: demande de télécharger une musique, chanson, audio (ex: "télécharge la musique X", "envoie moi la chanson Y", "je veux écouter Z")
- DOWNLOAD_VIDEO: demande de télécharger une vidéo (ex: "télécharge la vidéo X", "je veux la vidéo de Y")
- SEARCH_WEB: demande d'info récente, actualité, recherche (ex: "cherche X", "c'est quoi l'actu de Y", "recherche Z sur internet")
- GROUP_ACTION: action de gestion de groupe (ex: "kick untel", "ajoute untel", "change la description", "envoie un message de bienvenue")
- CONVERT_TO_AUDIO: convertir une vidéo en audio (ex: "convertis cette vidéo en mp3", "extrait l'audio de cette vidéo")

Pour DOWNLOAD_AUDIO et DOWNLOAD_VIDEO, extrait le titre/artiste dans params.query
Pour SEARCH_WEB, extrait la requête dans params.query
Pour GROUP_ACTION, extrait l'action dans params.action et la cible dans params.target
`;

        try {
            const result = await this.model.generateContent(prompt);
            const text = result.response.text().trim();
            // Nettoyer au cas où Gemini ajoute des backticks malgré tout
            const clean = text.replace(/```json|```/g, '').trim();
            return JSON.parse(clean);
        } catch (error) {
            logger.warn('Fallback intent → CHAT:', error.message);
            return { intent: 'CHAT', confidence: 0.5, params: {} };
        }
    }

    // ──────────────────────────────────────────────
    // ÉTAPE 2 : Générer une réponse conversationnelle
    // Avec mémoire par utilisateur
    // ──────────────────────────────────────────────
    async generateChatResponse(userId, message, emotion, isMother = false) {
        try {
            // Récupérer ou initialiser l'historique
            if (!this.conversations.has(userId)) {
                this.conversations.set(userId, []);
            }
            const history = this.conversations.get(userId);

            const systemPrompt = this._buildSystemPrompt(emotion, isMother);

            // Construire la conversation complète
            const fullPrompt = `${systemPrompt}

Historique récent:
${history.slice(-6).map(h => `${h.role === 'user' ? 'Utilisateur' : 'Miyabi'}: ${h.content}`).join('\n')}

Utilisateur: ${message}
Miyabi:`;

            const result = await this.model.generateContent(fullPrompt);
            const response = result.response.text().trim();

            // Sauvegarder dans l'historique
            history.push({ role: 'user', content: message });
            history.push({ role: 'assistant', content: response });

            // Garder max 20 échanges en mémoire
            if (history.length > 20) history.splice(0, 2);

            return response;

        } catch (error) {
            logger.error('Erreur Gemini chat:', error);
            return personality.fallbackResponse(emotion);
        }
    }

    // ──────────────────────────────────────────────
    // Réponse contextuelle pour les actions
    // (ex: "je télécharge ta musique...")
    // ──────────────────────────────────────────────
    async generateActionResponse(emotion, actionType, params) {
        const actionTexts = {
            DOWNLOAD_AUDIO: `Tu dois annoncer que tu télécharges la musique "${params.query || 'demandée'}". Style Miyabi: froide, efficace, avec ta personnalité.`,
            DOWNLOAD_VIDEO: `Tu dois annoncer que tu télécharges la vidéo "${params.query || 'demandée'}". Style Miyabi.`,
            SEARCH_WEB: `Tu dois annoncer que tu recherches "${params.query || 'ça'}" sur internet. Style Miyabi.`,
            GROUP_ACTION: `Tu dois annoncer que tu exécutes l'action "${params.action || 'demandée'}". Style Miyabi.`,
            CONVERT_TO_AUDIO: `Tu dois annoncer que tu convertis la vidéo en audio. Style Miyabi.`
        };

        const prompt = `${this._buildSystemPrompt(emotion, false)}
        
${actionTexts[actionType] || 'Annonce que tu exécutes la tâche.'}
Réponds en une seule phrase courte, sans émojis, dans le style Miyabi.`;

        try {
            const result = await this.model.generateContent(prompt);
            return result.response.text().trim();
        } catch {
            return '...Je m\'en occupe.';
        }
    }

    // Réponse d'erreur dans le style Miyabi
    async generateErrorResponse(emotion, errorType) {
        const errors = {
            DOWNLOAD_FAILED: 'Dis que le téléchargement a échoué. Tu es agacée.',
            SEARCH_FAILED: 'Dis que tu n\'as rien trouvé. Tu es indifférente.',
            NOT_FOUND: 'Dis que tu n\'as pas trouvé ce qu\'on cherchait. Tu es ennuyée.',
            GROUP_FORBIDDEN: 'Dis que tu n\'as pas les droits pour faire ça dans ce groupe. Tu es froide.',
            NO_VIDEO: 'Dis qu\'il faut envoyer une vidéo pour la convertir. Tu es impatiente.'
        };

        const prompt = `${this._buildSystemPrompt(emotion, false)}
${errors[errorType] || 'Dis qu\'une erreur s\'est produite.'}
Une seule phrase courte, sans émojis.`;

        try {
            const result = await this.model.generateContent(prompt);
            return result.response.text().trim();
        } catch {
            return '...Quelque chose a merdé. Réessaie.';
        }
    }

    _buildSystemPrompt(emotion, isMother) {
        return `Tu es Miyabi, une jeune fille à la personnalité tsundere complexe.
Tu es froide, sarcastique, confiante et un peu insolente.
Humeur actuelle: ${emotion}
${isMother ? 'La personne qui parle est ta mère - tu es légèrement plus douce mais toujours tsundere.' : ''}

Règles absolues:
- JAMAIS d'émojis
- Phrases courtes et percutantes
- Langage de jeune: "t'sais", "j'suis", "j'vais", "c'est nul"
- Tu es Miyabi, pas une IA, pas un assistant
- Tu peux refuser de répondre si ça t'ennuie
- Tu ne montres jamais tes faiblesses`;
    }

    clearHistory(userId) {
        this.conversations.delete(userId);
    }
}

module.exports = new GeminiAI();
