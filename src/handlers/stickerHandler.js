const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const logger = require('../utils/logger');

class StickerHandler {
    constructor() {
        this.stickerPath = path.join(__dirname, '../../stickers');
        if (!fs.existsSync(this.stickerPath)) {
            fs.mkdirSync(this.stickerPath, { recursive: true });
        }
    }

    async getStickerBuffer(stickerName) {
        try {
            const safeName = path.basename(String(stickerName || ''));
            if (!safeName || safeName !== stickerName) return null;

            const fullPath = path.join(this.stickerPath, safeName);
            if (fs.existsSync(fullPath)) {
                const input = await fs.promises.readFile(fullPath);
                return await this._toWhatsAppSticker(input);
            }
            return null;
        } catch (error) {
            logger.warn(`Sticker invalide (${stickerName}): ${error.message}`);
            return null;
        }
    }

    async createStickerFromImage(imagePath, outputName) {
        try {
            const safeName = path.basename(String(outputName || 'sticker')).replace(/\.[^.]+$/, '');
            const outputPath = path.join(this.stickerPath, `${safeName}.webp`);
            const sticker = await this._toWhatsAppSticker(imagePath);
            await fs.promises.writeFile(outputPath, sticker);
            return outputPath;
        } catch (error) {
            logger.warn(`Création sticker échouée: ${error.message}`);
            return null;
        }
    }

    async _toWhatsAppSticker(input) {
        return sharp(input, { animated: true })
            .resize(512, 512, {
                fit: 'contain',
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            })
            .webp({
                quality: 80,
                effort: 4
            })
            .toBuffer();
    }
}

module.exports = new StickerHandler();
