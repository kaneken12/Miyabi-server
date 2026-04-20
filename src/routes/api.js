const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('crypto').webcrypto ? 
    { v4: () => require('crypto').randomUUID() } : 
    { v4: () => require('crypto').randomUUID() };

let sessionManager;

function setSessionManager(sm) {
    sessionManager = sm;
}

// POST /api/connect — Initier une connexion avec un numéro
router.post('/connect', async (req, res) => {
    try {
        const { phone } = req.body;

        if (!phone) {
            return res.status(400).json({ success: false, error: 'Numéro requis' });
        }

        // Nettoyer le numéro (garder uniquement les chiffres)
        const cleanPhone = phone.replace(/\D/g, '');
        if (cleanPhone.length < 8) {
            return res.status(400).json({ success: false, error: 'Numéro invalide' });
        }

        // Générer un sessionId unique
        const sessionId = require('crypto').randomUUID();

        // Créer la session (asynchrone - le pairing code arrivera via Socket.io)
        sessionManager.createSession(sessionId, cleanPhone);

        return res.json({ success: true, sessionId });

    } catch (error) {
        console.error('Erreur /connect:', error);
        return res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});

// GET /api/status/:sessionId — Vérifier le statut d'une session
router.get('/status/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const status = sessionManager.getStatus(sessionId);
    return res.json({ sessionId, status });
});

// POST /api/disconnect — Déconnecter une session
router.post('/disconnect', (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ success: false, error: 'sessionId requis' });
    sessionManager.deleteSession(sessionId);
    return res.json({ success: true, message: 'Session supprimée' });
});

module.exports = { router, setSessionManager };
