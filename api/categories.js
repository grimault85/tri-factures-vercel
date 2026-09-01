// Fonction serverless Vercel — GET/POST sur /api/categories.
// Stocke les catégories (noms, codes analytiques, mots-clés, y compris ceux
// appris via les corrections manuelles) dans Redis, pour qu'elles survivent
// d'une session à l'autre, quel que soit l'appareil ou le comptable.
//
// Utilise une chaîne de connexion Redis classique (redis:// ou rediss://),
// telle qu'injectée par l'intégration Redis connectée au projet Vercel
// (variable d'environnement REDIS_URL, ou KV_URL selon l'intégration).

const Redis = require('ioredis');

const STORE_KEY = 'tri-factures:categories';

// Une seule connexion réutilisée entre les invocations "à chaud" de la fonction,
// plutôt que d'en recréer une à chaque appel.
let client = null;
function getClient() {
  const url = process.env.REDIS_URL || process.env.KV_URL;
  if (!url) return null;
  if (!client) {
    client = new Redis(url, {
      maxRetriesPerRequest: 3,
      connectTimeout: 8000,
      lazyConnect: false
    });
    client.on('error', (err) => console.error('Erreur connexion Redis', err));
  }
  return client;
}

module.exports = async (req, res) => {
  const redis = getClient();
  if (!redis) {
    res.status(500).json({
      error: "Stockage non configuré : aucune variable d'environnement REDIS_URL (ou KV_URL) trouvée sur ce projet Vercel."
    });
    return;
  }

  if (req.method === 'GET') {
    try {
      const raw = await redis.get(STORE_KEY);
      const stored = raw ? JSON.parse(raw) : null;
      res.status(200).json({ categories: stored });
    } catch (err) {
      console.error('Erreur lecture catégories', err);
      res.status(500).json({ error: 'Erreur de lecture du stockage : ' + (err && err.message ? err.message : 'inconnue') });
    }
    return;
  }

  if (req.method === 'POST') {
    const { categories, schemaVersion } = req.body || {};
    if (!Array.isArray(categories)) {
      res.status(400).json({ error: 'Format invalide : "categories" doit être un tableau.' });
      return;
    }
    try {
      await redis.set(STORE_KEY, JSON.stringify({ list: categories, schemaVersion: schemaVersion || 0 }));
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error('Erreur écriture catégories', err);
      res.status(500).json({ error: "Erreur d'écriture dans le stockage : " + (err && err.message ? err.message : 'inconnue') });
    }
    return;
  }

  res.status(405).json({ error: 'Méthode non autorisée' });
};
