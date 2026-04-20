const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('../utils/logger');

class SearchService {
    constructor() {
        this.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7'
        };
    }

    // ──────────────────────────────────────────────
    // Recherche DuckDuckGo (pas de clé API requise)
    // Retourne un résumé textuel des résultats
    // ──────────────────────────────────────────────
    async search(query) {
        try {
            logger.info(`🔍 Recherche web: ${query}`);

            // DuckDuckGo HTML (gratuit, pas de clé API)
            const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
            const response = await axios.get(url, {
                headers: this.headers,
                timeout: 10000
            });

            const $ = cheerio.load(response.data);
            const results = [];

            // Extraire les premiers résultats
            $('.result__body').slice(0, 4).each((i, el) => {
                const title = $(el).find('.result__title').text().trim();
                const snippet = $(el).find('.result__snippet').text().trim();
                if (title && snippet) {
                    results.push(`• ${title}\n  ${snippet}`);
                }
            });

            if (results.length === 0) {
                return null;
            }

            return results.join('\n\n');

        } catch (error) {
            logger.error('Erreur recherche:', error.message);
            // Fallback: Wikipedia API en français
            return await this.searchWikipedia(query);
        }
    }

    // ──────────────────────────────────────────────
    // Fallback Wikipedia (API officielle, fiable)
    // ──────────────────────────────────────────────
    async searchWikipedia(query) {
        try {
            const url = `https://fr.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&utf8=1&srlimit=3`;
            const response = await axios.get(url, { timeout: 8000 });
            const items = response.data?.query?.search || [];

            if (items.length === 0) return null;

            // Prendre le premier résultat et extraire l'extrait
            const firstResult = items[0];
            const cleanSnippet = firstResult.snippet
                .replace(/<[^>]+>/g, '') // Supprimer les balises HTML
                .replace(/&quot;/g, '"')
                .replace(/&#039;/g, "'");

            return `📖 ${firstResult.title}\n${cleanSnippet}...`;

        } catch (error) {
            logger.error('Erreur Wikipedia:', error.message);
            return null;
        }
    }

    // ──────────────────────────────────────────────
    // Résume les résultats de recherche via Gemini
    // pour une réponse plus naturelle
    // ──────────────────────────────────────────────
    async formatResultsWithAI(query, rawResults, gemini, emotion) {
        if (!rawResults) return null;

        try {
            const prompt = `Tu es Miyabi, bot WhatsApp tsundere et sarcastique.
Humeur: ${emotion}
Voici les résultats de recherche pour "${query}":

${rawResults}

Résume ces informations en 2-3 phrases claires et utiles.
Garde ton style Miyabi: direct, un peu froid, sans émojis.
Ne commence pas par "Alors" ou "Voilà".`;

            const { GoogleGenerativeAI } = require('@google/generative-ai');
            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
            const result = await model.generateContent(prompt);
            return result.response.text().trim();
        } catch {
            // Si Gemini échoue, retourner les résultats bruts formatés
            return `Résultats pour "${query}":\n\n${rawResults.slice(0, 800)}`;
        }
    }
}

module.exports = new SearchService();
