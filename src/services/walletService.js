const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const DATA_DIR = path.join(__dirname, '../../data');
const WALLETS_FILE = path.join(DATA_DIR, 'wallets.json');

class WalletService {
    constructor() {
        // Créer le dossier data s'il n'existe pas
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        // Créer le fichier wallets.json s'il n'existe pas
        if (!fs.existsSync(WALLETS_FILE)) {
            fs.writeFileSync(WALLETS_FILE, JSON.stringify([], null, 2));
        }
        logger.info('WalletService: base de données JSON locale initialisée');
    }

    // ── Lire tous les wallets ──
    _readWallets() {
        try {
            const data = fs.readFileSync(WALLETS_FILE, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            logger.error('Erreur lecture wallets.json:', error.message);
            return [];
        }
    }

    // ── Sauvegarder tous les wallets ──
    _saveWallets(wallets) {
        try {
            fs.writeFileSync(WALLETS_FILE, JSON.stringify(wallets, null, 2));
            return true;
        } catch (error) {
            logger.error('Erreur sauvegarde wallets.json:', error.message);
            return false;
        }
    }

    // ── Trouver un wallet par nom ou pseudo (insensible casse) ──
    _findWallet(wallets, query) {
        const q = query.trim().toLowerCase();
        return wallets.find(w =>
            w.nom.toLowerCase() === q ||
            w.pseudo.toLowerCase() === q
        );
    }

    // ──────────────────────────────────────────────
    // Créer un wallet
    // ──────────────────────────────────────────────
    async createWallet(nom, pseudo, classe, gems = 0, abyssCoins = 0) {
        try {
            const wallets = this._readWallets();

            // Vérifier si le pseudo existe déjà
            const exists = wallets.find(w =>
                w.pseudo.toLowerCase() === pseudo.trim().toLowerCase()
            );
            if (exists) return { success: false, error: 'EXISTS' };

            const now = new Date().toISOString();
            const wallet = {
                id: Date.now().toString(),
                nom: nom.trim(),
                pseudo: pseudo.trim(),
                classe: classe.trim(),
                gems: parseInt(gems) || 0,
                abyssCoins: parseInt(abyssCoins) || 0,
                createdAt: now,
                updatedAt: now
            };

            wallets.push(wallet);
            const saved = this._saveWallets(wallets);

            if (!saved) return { success: false, error: 'DB_ERROR' };

            logger.info(`Wallet créé: ${pseudo}`);
            return { success: true, wallet };
        } catch (error) {
            logger.error('Erreur createWallet:', error.message);
            return { success: false, error: 'DB_ERROR' };
        }
    }

    // ──────────────────────────────────────────────
    // Supprimer un wallet
    // ──────────────────────────────────────────────
    async deleteWallet(query) {
        try {
            const wallets = this._readWallets();
            const wallet = this._findWallet(wallets, query);

            if (!wallet) return { success: false, error: 'NOT_FOUND' };

            const filtered = wallets.filter(w => w.id !== wallet.id);
            const saved = this._saveWallets(filtered);

            if (!saved) return { success: false, error: 'DB_ERROR' };
            return { success: true };
        } catch (error) {
            logger.error('Erreur deleteWallet:', error.message);
            return { success: false, error: 'DB_ERROR' };
        }
    }

    // ──────────────────────────────────────────────
    // Modifier gems ou abyss coins
    // ──────────────────────────────────────────────
    async updateCurrency(query, type, action, amount) {
        try {
            const wallets = this._readWallets();
            const wallet = this._findWallet(wallets, query);

            if (!wallet) return { success: false, error: 'NOT_FOUND' };

            const current = wallet[type] || 0;
            const delta = action === 'add' ? parseInt(amount) : -parseInt(amount);
            const newValue = Math.max(0, current + delta);

            wallet[type] = newValue;
            wallet.updatedAt = new Date().toISOString();

            const saved = this._saveWallets(wallets);
            if (!saved) return { success: false, error: 'DB_ERROR' };

            return { success: true, wallet, previous: current, newValue };
        } catch (error) {
            logger.error('Erreur updateCurrency:', error.message);
            return { success: false, error: 'DB_ERROR' };
        }
    }

    // ──────────────────────────────────────────────
    // Récupérer un wallet
    // ──────────────────────────────────────────────
    async getWallet(query) {
        try {
            const wallets = this._readWallets();
            const wallet = this._findWallet(wallets, query);

            if (!wallet) return { success: false, error: 'NOT_FOUND' };
            return { success: true, wallet };
        } catch (error) {
            logger.error('Erreur getWallet:', error.message);
            return { success: false, error: 'DB_ERROR' };
        }
    }

    // ──────────────────────────────────────────────
    // Récupérer tous les wallets
    // ──────────────────────────────────────────────
    async getAllWallets() {
        try {
            const wallets = this._readWallets();
            wallets.sort((a, b) => a.pseudo.localeCompare(b.pseudo));
            return { success: true, wallets };
        } catch (error) {
            logger.error('Erreur getAllWallets:', error.message);
            return { success: false, error: 'DB_ERROR' };
        }
    }

    // ──────────────────────────────────────────────
    // Formater une fiche en texte WhatsApp
    // ──────────────────────────────────────────────
    formatWallet(wallet) {
        const date = new Date(wallet.updatedAt);
        const dateStr = `${String(date.getDate()).padStart(2,'0')}/${String(date.getMonth()+1).padStart(2,'0')}/${date.getFullYear()}`;

        return `↤♖︎𝗟𝗢𝗪𝗘𝗥 𝗧𝗢𝗪𝗘𝗥♖︎↦
-- -- -- -- -- -- -- -- -- -- -- -- -- -- -- --
> 𝘞𝘢𝘭𝘭𝘦𝘵 𝘱𝘭𝘢𝘺𝘦𝘳𝘴💳
══════════════════
|• ℕ𝕠𝕞: *${wallet.nom}*
|• ℙ𝕤𝕖𝕦𝕕𝕠: *${wallet.pseudo}*
|• ℂ𝕝𝕒𝕤𝕤𝕖: *${wallet.classe}*
-- -- -- -- -- -- -- -- -- -- -- -- -- -- -- --
|• 𝔾𝕖𝕞: *${wallet.gems}💎*
|• 𝔸𝕓𝕪𝕤𝕤 𝕔𝕠𝕚𝕟𝕤: *${wallet.abyssCoins}🪙*
══════════════════ 
𝕌𝕡𝕕𝕒𝕥𝕖 𝕓𝕪: _*Miyabi*_

𝔻𝕒𝕥𝕖 𝕦𝕡𝕕𝕒𝕥𝕖: \`${dateStr}\`
══════════════════
-                 𝙻𝙾𝚆𝙴𝚁 𝚃𝙾𝚆𝙴𝚁`;
    }
}

module.exports = new WalletService();
