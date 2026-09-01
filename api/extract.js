// Fonction serverless Vercel — appelée par la page en POST sur /api/extract.
// La clé API Anthropic reste ici, côté serveur, jamais exposée au navigateur.
// À configurer dans Vercel : Project Settings > Environment Variables > ANTHROPIC_API_KEY

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Méthode non autorisée' });
    return;
  }

  const { image, media_type } = req.body || {};
  if (!image || !media_type) {
    res.status(400).json({ error: 'Image manquante dans la requête.' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Clé API non configurée côté serveur (variable d'environnement ANTHROPIC_API_KEY manquante sur Vercel)." });
    return;
  }

  const prompt =
    "Tu es un assistant d'extraction de données de factures fournisseurs pour un restaurant. " +
    "Analyse le document de facture fourni (photo ou PDF) et renvoie UNIQUEMENT un objet JSON valide, sans texte autour, sans balises markdown, au format exact:\n" +
    '{"fournisseur":"...","date":"JJ/MM/AAAA ou vide","numero_facture":"... ou vide","lignes":[{"designation":"...","quantite":0,"prix_unitaire_ht":0,"montant_ht":0}]}\n' +
    "Règles: montant_ht est le montant HT de la ligne (si seul le TTC est visible sur la ligne, mets ce montant quand même et laisse prix_unitaire_ht à 0). " +
    "N'invente aucune ligne, ignore les lignes de totaux/sous-totaux/TVA/frais de port séparés. " +
    "Nombres avec un point comme séparateur décimal, jamais de virgule ni d'espace, jamais de symbole €. " +
    "Sois concis, uniquement le JSON, pas d'explication.";

  const isPdf = media_type === 'application/pdf';
  const fileBlock = isPdf
    ? { type: 'document', source: { type: 'base64', media_type, data: image } }
    : { type: 'image', source: { type: 'base64', media_type, data: image } };

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 32000,
        thinking: { type: 'disabled' },
        messages: [{
          role: 'user',
          content: [
            fileBlock,
            { type: 'text', text: prompt }
          ]
        }]
      })
    });

    const data = await anthropicRes.json();

    if (!anthropicRes.ok) {
      console.error('Erreur API Anthropic', anthropicRes.status, data);
      res.status(502).json({ error: (data && data.error && data.error.message) || ('Erreur API Anthropic (HTTP ' + anthropicRes.status + ').') });
      return;
    }

    if (data.stop_reason === 'max_tokens') {
      res.status(502).json({ error: "La réponse a été coupée avant la fin (facture avec beaucoup de lignes). Réessaie, ou scinde la facture en plusieurs PDF." });
      return;
    }

    const textBlocks = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');

    const clean = textBlocks.trim()
      .replace(/^```json/i, '')
      .replace(/^```/, '')
      .replace(/```$/, '')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (e) {
      console.error('JSON illisible renvoyé par le modèle:', clean.slice(0, 500));
      res.status(502).json({ error: "Réponse IA non exploitable. Détail: " + clean.slice(0, 200) });
      return;
    }

    res.status(200).json(parsed);
  } catch (err) {
    console.error('Erreur serveur /api/extract', err);
    res.status(500).json({ error: "Erreur serveur pendant l'extraction : " + (err && err.message ? err.message : 'inconnue') });
  }
};
