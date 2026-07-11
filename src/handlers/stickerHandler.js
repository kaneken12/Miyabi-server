const fs = require('fs');
const path = require('path');

class StickerHandler {
    constructor() {
        this.stickerPath = path.join(__dirname, '../../stickers');
    }

    async getStickerBuffer(stickerName) {
        try {
            const fullPath = path.join(this.stickerPath, stickerName);
            if (fs.existsSync(fullPath)) {
                return fs.readFileSync(fullPath);
            }
            return null;
        } catch {
            return null;
        }
    }
}

module.exports = new StickerHandler();