// ============================================================
//  src/utils/messageSanitizer.js — Miyabi Protection Module
//  Détecte les messages suspects pouvant crasher WhatsApp
// ============================================================

// ── Patterns Unicode dangereux pour le rendu WhatsApp ────────
const DANGEROUS_UNICODE = [
    { pattern: /[\u202E\u202D\u202C\u202B\u202A]/, label: 'RTL/LTR override' },
    { pattern: /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/, label: 'Caractère de contrôle nul' },
    { pattern: /[\uFFF0-\uFFFD]/, label: 'Caractère Unicode spécial (Specials block)' },
    { pattern: /\u200B{3,}/, label: 'Zero-width spaces répétés' },
    { pattern: /\u200F{5,}/, label: 'RTL marks répétés' },
    { pattern: /[\uD800-\uDFFF]/, label: 'Surrogate Unicode isolé' },
];

// ── Seuils de détection ──────────────────────────────────────
const LIMITS = {
    maxTextLength:   5000,  // Longueur max d'un message texte
    maxRepeatedChar: 500,   // Même caractère répété consécutivement
    maxNewlines:     100,   // Sauts de ligne excessifs
    maxMentions:     20,    // Mentions @numéro trop nombreuses
    maxMediaSizeMB:  50,    // Taille max d'un fichier média
    maxVcardLength:  2000,  // Longueur max d'une vCard
};

// ── Analyse du texte ─────────────────────────────────────────
function _analyzeText(text) {
    if (!text || typeof text !== 'string') return null;

    if (text.length > LIMITS.maxTextLength)
        return `Texte trop long (${text.length} caractères)`;

    if (/(.)\1{500,}/.test(text))
        return 'Répétition excessive d\'un même caractère';

    const newlines = (text.match(/\n/g) || []).length;
    if (newlines > LIMITS.maxNewlines)
        return `Sauts de ligne excessifs (${newlines})`;

    const mentions = (text.match(/@\d{5,}/g) || []).length;
    if (mentions > LIMITS.maxMentions)
        return `Trop de mentions dans le message (${mentions})`;

    for (const { pattern, label } of DANGEROUS_UNICODE) {
        if (pattern.test(text))
            return `Unicode dangereux détecté : ${label}`;
    }

    return null;
}

// ── Analyse des médias ───────────────────────────────────────
function _analyzeMedia(message) {
    const mediaTypes = [
        'imageMessage', 'videoMessage', 'audioMessage',
        'stickerMessage', 'documentMessage', 'gifPlaybackMessage',
    ];

    for (const type of mediaTypes) {
        const media = message[type];
        if (!media) continue;

        if (!media.mimetype || media.mimetype.trim() === '')
            return `Média (${type}) sans mimetype`;

        if (media.fileLength) {
            const sizeMB = media.fileLength / (1024 * 1024);
            if (sizeMB > LIMITS.maxMediaSizeMB)
                return `Fichier trop lourd : ${sizeMB.toFixed(1)} MB`;
        }

        if (media.width && media.height) {
            if (media.width > 10000 || media.height > 10000)
                return `Dimensions suspectes : ${media.width}x${media.height}`;
        }
    }

    return null;
}

// ── Analyse des contacts / vCards ────────────────────────────
function _analyzeContact(message) {
    const contact = message.contactMessage || message.contactsArrayMessage;
    if (!contact) return null;

    const vcard = contact.vcard || '';
    if (vcard.length > LIMITS.maxVcardLength)
        return `vCard suspecte (${vcard.length} caractères)`;

    return null;
}

// ── Analyse des localisations ────────────────────────────────
function _analyzeLocation(message) {
    const loc = message.locationMessage || message.liveLocationMessage;
    if (!loc) return null;

    const lat = loc.degreesLatitude;
    const lon = loc.degreesLongitude;

    if (lat !== undefined && (lat < -90 || lat > 90))
        return `Latitude GPS invalide (${lat})`;
    if (lon !== undefined && (lon < -180 || lon > 180))
        return `Longitude GPS invalide (${lon})`;

    return null;
}

// ── Fonction principale ──────────────────────────────────────
function inspectMessage(msg) {
    try {
        const message = msg?.message;
        if (!message) return { suspicious: false };

        // Extraire le texte depuis tous les types possibles
        const text =
            message.conversation ||
            message.extendedTextMessage?.text ||
            message.buttonsMessage?.contentText ||
            message.listMessage?.description ||
            message.imageMessage?.caption ||
            message.videoMessage?.caption ||
            '';

        const reason =
            _analyzeText(text) ||
            _analyzeMedia(message) ||
            _analyzeContact(message) ||
            _analyzeLocation(message);

        if (reason) return { suspicious: true, reason };
        return { suspicious: false };

    } catch (err) {
        // Erreur de parsing = suspect par sécurité
        return { suspicious: true, reason: `Erreur de parsing du message : ${err.message}` };
    }
}

module.exports = { inspectMessage };
