const { MongoClient } = require('mongodb');
const logger = require('../utils/logger');

class WalletService {
    constructor() {
        this.client = null;
        this.db = null;
        this.collection = null;
        this.connected = false;
    }

    async connect() {
        try {
            this.client = new MongoClient(process.env.MONGODB_URI);
            await this.client.connect();
            this.db = this.client.db(process.env.MONGODB_DB || 'miyabi');
            this.collection = this.db.collection('wallets');

            await this.collection.createIndex(
                { pseudo: 1 },
                { unique: true, collation: { locale: 'fr', strength: 2 } }
            );
            await this.collection.createIndex(
                { nom: 1 },
                { collation: { locale: 'fr', strength: 2 } }
            );

            this.connected = true;
            logger.info('MongoDB: connecté à la base wallets');
        } catch (error) {
            logger.error('MongoDB: erreur de connexion:', error.message);
            this.connected = false;
        }
    }

    // ── Vérification connexion ──
    _checkConnection() {
        if (!this.connected || !this.collection) {
            return { success: false, error: 'DB_NOT_CONNECTED' };
        }
        return null;
    }

    async createWallet(nom, pseudo, classe, gems = 0, abyssCoins = 0) {
        const connErr = this._checkConnection();
        if (connErr) return connErr;

        try {
            const now = new Date();
            const wallet = {
                nom,
                pseudo,
                classe,
                gems: parseInt(gems) || 0,
                abyssCoins: parseInt(abyssCoins) || 0,
                createdAt: now,
                updatedAt: now
            };
            await this.collection.insertOne(wallet);
            logger.info(`Wallet créé: ${pseudo}`);
            return { success: true, wallet };
        } catch (error) {
            if (error.code === 11000) {
                return { success: false, error: 'EXISTS' };
            }
            logger.error('Erreur createWallet:', error.message);
            return { success: false, error: 'DB_ERROR' };
        }
    }

    async deleteWallet(query) {
        const connErr = this._checkConnection();
        if (connErr) return connErr;

        try {
            const filter = this._buildSearchFilter(query);
            const result = await this.collection.deleteOne(filter);
            if (result.deletedCount === 0) {
                return { success: false, error: 'NOT_FOUND' };
            }
            return { success: true };
        } catch (error) {
            logger.error('Erreur deleteWallet:', error.message);
            return { success: false, error: 'DB_ERROR' };
        }
    }

    async updateCurrency(query, type, action, amount) {
        const connErr = this._checkConnection();
        if (connErr) return connErr;

        try {
            const filter = this._buildSearchFilter(query);
            const wallet = await this.collection.findOne(filter);
            if (!wallet) return { success: false, error: 'NOT_FOUND' };

            const current = wallet[type] || 0;
            const delta = action === 'add' ? parseInt(amount) : -parseInt(amount);
            const newValue = Math.max(0, current + delta);

            await this.collection.updateOne(filter, {
                $set: { [type]: newValue, updatedAt: new Date() }
            });

            const updated = await this.collection.findOne(filter);
            return { success: true, wallet: updated, previous: current, newValue };
        } catch (error) {
            logger.error('Erreur updateCurrency:', error.message);
            return { success: false, error: 'DB_ERROR' };
        }
    }

    async getWallet(query) {
        const connErr = this._checkConnection();
        if (connErr) return connErr;

        try {
            const filter = this._buildSearchFilter(query);
            const wallet = await this.collection.findOne(filter);
            if (!wallet) return { success: false, error: 'NOT_FOUND' };
            return { success: true, wallet };
        } catch (error) {
            logger.error('Erreur getWallet:', error.message);
            return { success: false, error: 'DB_ERROR' };
        }
    }

    async getAllWallets() {
        const connErr = this._checkConnection();
        if (connErr) return connErr;

        try {
            const wallets = await this.collection
                .find({})
                .sort({ pseudo: 1 })
                .toArray();
            return { success: true, wallets };
        } catch (error) {
            logger.error('Erreur getAllWallets:', error.message);
            return { success: false, error: 'DB_ERROR' };
        }
    }

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

    _buildSearchFilter(query) {
        const regex = new RegExp(`^${query.trim()}$`, 'i');
        return { $or: [{ nom: regex }, { pseudo: regex }] };
    }
}

module.exports = new WalletService();
