const walletService = require('../services/walletService');
const logger = require('../utils/logger');

class WalletHandler {

    // ──────────────────────────────────────────────
    // Point d'entrée principal
    // Appelé depuis messageHandler quand intent = WALLET_*
    // ──────────────────────────────────────────────
    async handle(sock, sender, action, params, isOwner) {
        switch (action) {

            case 'CREATE':
                return await this._createWallet(sock, sender, params, isOwner);

            case 'DELETE':
                return await this._deleteWallet(sock, sender, params, isOwner);

            case 'ADD_GEMS':
                return await this._updateCurrency(sock, sender, params, 'gems', 'add', isOwner);

            case 'REMOVE_GEMS':
                return await this._updateCurrency(sock, sender, params, 'gems', 'remove', isOwner);

            case 'ADD_AC':
                return await this._updateCurrency(sock, sender, params, 'abyssCoins', 'add', isOwner);

            case 'REMOVE_AC':
                return await this._updateCurrency(sock, sender, params, 'abyssCoins', 'remove', isOwner);

            case 'VIEW':
                return await this._viewWallet(sock, sender, params);

            case 'MAJ':
                return await this._sendAllWallets(sock, sender, isOwner);

            default:
                await this._send(sock, sender, '...Je comprends pas ce que tu veux faire avec les fiches.');
        }
    }

    // ──────────────────────────────────────────────
    // Créer un wallet
    // ──────────────────────────────────────────────
    async _createWallet(sock, sender, params, isOwner) {
        if (!isOwner) {
            await this._send(sock, sender, 'T\'as pas les droits pour créer des fiches. C\'est réservé à l\'admin.');
            return;
        }

        const { nom, pseudo, classe, gems, abyssCoins } = params;

        if (!nom || !pseudo || !classe) {
            await this._send(sock, sender, 'Il me faut le nom, le pseudo et la classe du joueur pour créer sa fiche.');
            return;
        }

        const result = await walletService.createWallet(nom, pseudo, classe, gems || 0, abyssCoins || 0);

        if (result.success) {
            const fiche = walletService.formatWallet(result.wallet);
            await this._send(sock, sender, `Fiche créée. Voilà ce que ça donne.\n\n${fiche}`);
        } else if (result.error === 'EXISTS') {
            await this._send(sock, sender, `Une fiche avec ce pseudo existe déjà. Vérifie avant de me faire répéter.`);
        } else {
            await this._send(sock, sender, `Quelque chose a merdé avec la base de données. Réessaie.`);
        }
    }

    // ──────────────────────────────────────────────
    // Supprimer un wallet
    // ──────────────────────────────────────────────
    async _deleteWallet(sock, sender, params, isOwner) {
        if (!isOwner) {
            await this._send(sock, sender, 'Non. Supprimer des fiches c\'est pas pour toi.');
            return;
        }

        const query = params.query;
        if (!query) {
            await this._send(sock, sender, 'Donne-moi le nom ou le pseudo du joueur à supprimer.');
            return;
        }

        const result = await walletService.deleteWallet(query);

        if (result.success) {
            await this._send(sock, sender, `Fiche de "${query}" supprimée. Elle existe plus.`);
        } else if (result.error === 'NOT_FOUND') {
            await this._send(sock, sender, `Je trouve pas de fiche pour "${query}". Vérifie le nom ou le pseudo.`);
        } else {
            await this._send(sock, sender, `Erreur base de données. Réessaie.`);
        }
    }

    // ──────────────────────────────────────────────
    // Modifier gems ou AC
    // ──────────────────────────────────────────────
    async _updateCurrency(sock, sender, params, type, action, isOwner) {
        if (!isOwner) {
            await this._send(sock, sender, 'Tu peux pas modifier les fiches. C\'est réservé à l\'admin.');
            return;
        }

        const { query, amount } = params;

        if (!query || !amount) {
            await this._send(sock, sender, 'Il me faut le joueur et le montant. Sois précis.');
            return;
        }

        const result = await walletService.updateCurrency(query, type, action, amount);

        if (result.success) {
            const typeName = type === 'gems' ? 'gems 💎' : 'Abyss Coins 🪙';
            const actionStr = action === 'add' ? 'ajouté' : 'retiré';
            await this._send(sock, sender,
                `${amount} ${typeName} ${actionStr} pour ${result.wallet.pseudo}. ` +
                `Solde actuel: ${result.wallet[type]} ${type === 'gems' ? '💎' : '🪙'}`
            );
        } else if (result.error === 'NOT_FOUND') {
            await this._send(sock, sender, `Aucune fiche trouvée pour "${query}".`);
        } else {
            await this._send(sock, sender, `Erreur base de données. Réessaie.`);
        }
    }

    // ──────────────────────────────────────────────
    // Voir une fiche
    // ──────────────────────────────────────────────
    async _viewWallet(sock, sender, params) {
        const query = params.query;

        if (!query) {
            await this._send(sock, sender, 'Donne-moi le nom ou le pseudo du joueur dont tu veux voir la fiche.');
            return;
        }

        const result = await walletService.getWallet(query);

        if (result.success) {
            await this._send(sock, sender, walletService.formatWallet(result.wallet));
        } else if (result.error === 'NOT_FOUND') {
            await this._send(sock, sender, `Pas de fiche pour "${query}". Il joue même pas ?`);
        } else {
            await this._send(sock, sender, `Erreur base de données. Réessaie.`);
        }
    }

    // ──────────────────────────────────────────────
    // MAJ générale → envoyer toutes les fiches dans le groupe RP
    // ──────────────────────────────────────────────
    async _sendAllWallets(sock, sender, isOwner) {
        if (!isOwner) {
            await this._send(sock, sender, 'La MAJ générale c\'est réservé à l\'admin.');
            return;
        }

        const groupId = process.env.WALLET_GROUP_ID;
        if (!groupId) {
            await this._send(sock, sender, 'Le groupe de destination n\'est pas configuré. Ajoute WALLET_GROUP_ID dans le .env.');
            return;
        }

        const result = await walletService.getAllWallets();

        if (!result.success) {
            await this._send(sock, sender, 'Erreur lors de la récupération des fiches. Réessaie.');
            return;
        }

        if (result.wallets.length === 0) {
            await this._send(sock, sender, 'Aucune fiche enregistrée pour l\'instant.');
            return;
        }

        await this._send(sock, sender, `...Lancement de la MAJ. ${result.wallets.length} fiche(s) à envoyer.`);

        // Envoyer chaque fiche avec un délai pour éviter le spam
        for (let i = 0; i < result.wallets.length; i++) {
            const wallet = result.wallets[i];
            await this._send(sock, groupId, walletService.formatWallet(wallet));
            // Délai de 1.5s entre chaque fiche
            if (i < result.wallets.length - 1) {
                await new Promise(r => setTimeout(r, 1500));
            }
        }

        await this._send(sock, groupId,
            `══════════════════\n` +
            `MAJ complète — ${result.wallets.length} fiche(s) mise(s) à jour.\n` +
            `𝔻𝕒𝕥𝕖: \`${new Date().toLocaleDateString('fr-FR')}\`\n` +
            `══════════════════`
        );
    }

    async _send(sock, jid, text) {
        try {
            await sock.sendMessage(jid, { text });
        } catch (err) {
            logger.error('Erreur envoi wallet:', err.message);
        }
    }
}

module.exports = new WalletHandler();
