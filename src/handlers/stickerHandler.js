const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

class StickerHandler {
    constructor() {
        this.stickerPath = path.join(__dirname, '../../stickers');
        if (!fs.existsSync(this.stickerPath)) {
            fs.mkdirSync(this.stickerPath, { recursive: true });
        }
    }

    async getStickerBuffer(stickerName) {
        try {
            const fullPath = path.join(this.stickerPath, stickerName);
            if (fs.existsSync(fullPath)) {
                return await fs.promises.readFile(fullPath);
            }
            return null;
        } catch {
            return null;
        }
    }

    async createStickerFromImage(imagePath, outputName) {
        try {
            const outputPath = path.join(this.stickerPath, `${outputName}.webp`);
            await sharp(imagePath)
                .resize(512, 512, { fit: 'contain' })
                .webp({ quality: 80 })
                .toFile(outputPath);
            return outputPath;
        } catch {
            return null;
        }
    }
}

module.exports = new StickerHandler();
