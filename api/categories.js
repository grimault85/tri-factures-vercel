// Fonction serverless Vercel — GET/POST sur /api/categories.
// Stocke les catégories (noms, codes analytiques, mots-clés, y compris ceux
// appris via les corrections manuelles) dans Upstash Redis, pour qu'elles
// survivent d'une session à l'autre, quel que soit l'appareil ou le comptable.
//
// Nécessite l'intégration "Upstash for Redis" installée sur le projet Vercel
// (Storage > Create Database > Upstash for Redis), qui injecte automatiquement
// KV_REST_API_URL et KV_REST_API_TOKEN comme variables d'environnement.

const { Redis } = require('@upstash/redis');

const STORE_KEY = 'tri-factures:categories';

function getClient() {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

module.exports = async (req, res) => {
  const redis = getClient();
  if (!redis) {
    res.status(500).json({
      error: "Stockage non configuré : l'intégration Upstash for Redis n'est pas connectée à ce projet Vercel (variables KV_REST_API_URL / KV_REST_API_TOKEN manquantes)."
    });
    return;
  }

  if (req.method === 'GET') {
    try {
      const stored = await redis.get(STORE_KEY);
      // stored est déjà un objet JS (le client Upstash désérialise automatiquement le JSON).
      // Format attendu : { list: [...categories], schemaVersion: N } — ou null si rien stocké.
      res.status(200).json({ categories: stored || null });
    } catch (err) {
      console.error('Erreur lecture catégories', err);
      res.status(500).json({ error: 'Erreur de lecture du stockage.' });
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
      await redis.set(STORE_KEY, { list: categories, schemaVersion: schemaVersion || 0 });
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error('Erreur écriture catégories', err);
      res.status(500).json({ error: "Erreur d'écriture dans le stockage." });
    }
    return;
  }

  res.status(405).json({ error: 'Méthode non autorisée' });
};
