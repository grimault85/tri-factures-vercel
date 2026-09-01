// Fonction serverless Vercel — appelée par la page en POST sur /api/extract.
// La clé API Anthropic reste ici, côté serveur, jamais exposée au navigateur.
// À configurer dans Vercel : Project Settings > Environment Variables > ANTHROPIC_API_KEY
//
// Pour les PDF multi-pages, chaque page est découpée puis envoyée séparément à
// l'API (en parallèle) au lieu d'un seul gros appel — plus rapide, et surtout
// beaucoup moins susceptible de dépasser le temps d'exécution max de la fonction.

const { PDFDocument } = require('pdf-lib');

const SINGLE_SCHEMA_PROMPT =
  '{"fournisseur":"...","date":"JJ/MM/AAAA ou vide","numero_facture":"... ou vide","lignes":[{"designation":"...","quantite":0,"prix_unitaire_ht":0,"montant_ht":0}]}';

function fullDocPrompt() {
  return (
    "Tu es un assistant d'extraction de données de factures fournisseurs pour un restaurant. " +
    "Analyse le document de facture fourni (photo ou PDF) et renvoie UNIQUEMENT un objet JSON valide, sans texte autour, sans balises markdown, au format exact:\n" +
    SINGLE_SCHEMA_PROMPT + "\n" +
    "Règles: montant_ht est le montant HT de la ligne (si seul le TTC est visible sur la ligne, mets ce montant quand même et laisse prix_unitaire_ht à 0). " +
    "N'invente aucune ligne, ignore les lignes de totaux/sous-totaux/TVA/frais de port séparés. " +
    "Nombres avec un point comme séparateur décimal, jamais de virgule ni d'espace, jamais de symbole €. " +
    "Sois concis, uniquement le JSON, pas d'explication."
  );
}

function pagePrompt(pageNum, pageCount) {
  return (
    "Tu es un assistant d'extraction de données de factures fournisseurs pour un restaurant. " +
    "Voici la page " + pageNum + " sur " + pageCount + " d'une facture PDF. " +
    "Analyse UNIQUEMENT cette page et renvoie UNIQUEMENT un objet JSON valide, sans texte autour, sans balises markdown, au format exact:\n" +
    SINGLE_SCHEMA_PROMPT + "\n" +
    "Règles: ne liste QUE les lignes de produits visibles sur CETTE page. " +
    "fournisseur/date/numero_facture : renseigne-les seulement s'ils sont visibles sur cette page précise, sinon laisse-les vides (une autre page s'en charge). " +
    "montant_ht est le montant HT de la ligne (si seul le TTC est visible, mets ce montant quand même et laisse prix_unitaire_ht à 0). " +
    "N'invente aucune ligne, ignore les lignes de totaux/sous-totaux/TVA/frais de port séparés. " +
    "Nombres avec un point comme séparateur décimal, jamais de virgule ni d'espace, jamais de symbole €. " +
    "Sois concis, uniquement le JSON, pas d'explication."
  );
}

async function callClaude(apiKey, fileBlock, prompt, maxTokens) {
  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: maxTokens,
      thinking: { type: 'disabled' },
      messages: [{
        role: 'user',
        content: [fileBlock, { type: 'text', text: prompt }]
      }]
    })
  });

  const data = await anthropicRes.json();

  if (!anthropicRes.ok) {
    throw new Error((data && data.error && data.error.message) || ('Erreur API Anthropic (HTTP ' + anthropicRes.status + ').'));
  }
  if (data.stop_reason === 'max_tokens') {
    throw new Error('Réponse coupée avant la fin (trop de lignes pour cette page/ce document).');
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

  try {
    return JSON.parse(clean);
  } catch (e) {
    throw new Error('Réponse IA non exploitable: ' + clean.slice(0, 200));
  }
}

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

  const isPdf = media_type === 'application/pdf';

  // Images (photos) : un seul appel, comme avant.
  if (!isPdf) {
    try {
      const fileBlock = { type: 'image', source: { type: 'base64', media_type, data: image } };
      const parsed = await callClaude(apiKey, fileBlock, fullDocPrompt(), 8192);
      res.status(200).json(parsed);
    } catch (err) {
      console.error('Erreur extraction image', err);
      res.status(502).json({ error: err.message || "Erreur pendant l'extraction." });
    }
    return;
  }

  // PDF : on tente de découper page par page pour paralléliser et éviter les timeouts.
  const pdfBytes = Buffer.from(image, 'base64');
  let srcDoc;
  try {
    srcDoc = await PDFDocument.load(pdfBytes);
  } catch (e) {
    // PDF illisible par pdf-lib (protégé, corrompu...) : on retente en direct, sans découpage.
    try {
      const fileBlock = { type: 'document', source: { type: 'base64', media_type, data: image } };
      const parsed = await callClaude(apiKey, fileBlock, fullDocPrompt(), 32000);
      res.status(200).json(parsed);
    } catch (err2) {
      console.error('Erreur extraction PDF (fallback sans découpage)', err2);
      res.status(502).json({ error: err2.message || "PDF illisible." });
    }
    return;
  }

  const pageCount = srcDoc.getPageCount();

  // Une seule page : pas besoin de découper, appel direct.
  if (pageCount <= 1) {
    try {
      const fileBlock = { type: 'document', source: { type: 'base64', media_type, data: image } };
      const parsed = await callClaude(apiKey, fileBlock, fullDocPrompt(), 8192);
      res.status(200).json(parsed);
    } catch (err) {
      console.error('Erreur extraction PDF 1 page', err);
      res.status(502).json({ error: err.message || "Erreur pendant l'extraction." });
    }
    return;
  }

  // Plusieurs pages : découpe + appels en parallèle.
  try {
    const pageJobs = [];
    for (let i = 0; i < pageCount; i++) {
      pageJobs.push((async () => {
        const singlePageDoc = await PDFDocument.create();
        const [copiedPage] = await singlePageDoc.copyPages(srcDoc, [i]);
        singlePageDoc.addPage(copiedPage);
        const singlePageBytes = await singlePageDoc.save();
        const singlePageBase64 = Buffer.from(singlePageBytes).toString('base64');
        const fileBlock = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: singlePageBase64 } };
        try {
          const result = await callClaude(apiKey, fileBlock, pagePrompt(i + 1, pageCount), 6000);
          return { ok: true, page: i + 1, result };
        } catch (err) {
          console.error('Erreur extraction page', i + 1, err);
          return { ok: false, page: i + 1, error: err.message };
        }
      })());
    }

    const results = await Promise.all(pageJobs);

    const merged = { fournisseur: '', date: '', numero_facture: '', lignes: [] };
    const failedPages = [];

    results
      .sort((a, b) => a.page - b.page)
      .forEach(r => {
        if (!r.ok) { failedPages.push(r.page); return; }
        if (!merged.fournisseur && r.result.fournisseur) merged.fournisseur = r.result.fournisseur;
        if (!merged.date && r.result.date) merged.date = r.result.date;
        if (!merged.numero_facture && r.result.numero_facture) merged.numero_facture = r.result.numero_facture;
        if (Array.isArray(r.result.lignes)) merged.lignes = merged.lignes.concat(r.result.lignes);
      });

    if (failedPages.length) {
      merged.warning = 'Page(s) ' + failedPages.join(', ') + " non lues — vérifie s'il manque des lignes.";
    }
    if (merged.lignes.length === 0) {
      res.status(502).json({ error: "Aucune ligne détectée sur aucune des " + pageCount + " pages." });
      return;
    }

    res.status(200).json(merged);
  } catch (err) {
    console.error('Erreur serveur /api/extract (découpage PDF)', err);
    res.status(500).json({ error: "Erreur serveur pendant l'extraction : " + (err && err.message ? err.message : 'inconnue') });
  }
};
