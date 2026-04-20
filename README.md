# 🎀 Miyabi Server — Interface de connexion WhatsApp

Serveur Express + Socket.io qui permet aux utilisateurs de connecter Miyabi via une interface web.

## 🚀 Installation

```bash
npm install
cp .env.example .env
# Édite .env avec ta clé Gemini
npm start
```

## ⚙️ Variables d'environnement

```env
PORT=3000
GEMINI_API_KEY=ta_cle_ici
OWNER_NUMBER=237XXXXXXXXX
MOTHER_NUMBER=237XXXXXXXXX
BOT_NAME=Miyabi
SEND_STICKERS=true        # true ou false
```

## 🌐 Accès

- Interface web : `http://localhost:3000`
- API : `http://localhost:3000/api`

## 📡 API Endpoints

| Méthode | Route | Description |
|---|---|---|
| POST | `/api/connect` | Initier une connexion (body: `{phone}`) |
| GET | `/api/status/:sessionId` | Statut d'une session |
| POST | `/api/disconnect` | Déconnecter une session (body: `{sessionId}`) |

## 🔧 Architecture

```
miyabi-server/
├── server.js              # Express + Socket.io
├── public/
│   └── index.html         # Interface web de connexion
└── src/
    ├── core/
    │   ├── sessionManager.js  # Gestion sessions Baileys
    │   ├── whatsapp.js
    │   ├── gemini.js
    │   └── personality.js
    ├── handlers/
    │   ├── messageHandler.js
    │   └── stickerHandler.js
    └── services/
        ├── downloadService.js
        ├── searchService.js
        └── groupService.js
```

## 🔄 Déploiement (Railway / Render)

1. Push sur GitHub
2. Connecte Railway à ton repo
3. Ajoute les variables d'env dans le dashboard
4. Deploy automatique ✅
