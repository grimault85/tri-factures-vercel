# Tri des factures — compta analytique

Page unique (`index.html`) + une fonction serverless (`api/extract.js`) qui appelle
l'API Anthropic côté serveur, pour ne jamais exposer la clé API dans le navigateur
du comptable.

## Déploiement sur Vercel (le plus simple)

1. **Créer un dépôt GitHub** avec ces fichiers (ou pousser dans un dépôt existant).
2. Aller sur [vercel.com](https://vercel.com) → **Add New → Project** → importer ce dépôt GitHub.
   Vercel détecte automatiquement `index.html` (statique) et `api/extract.js` (fonction serverless),
   aucune configuration de build n'est nécessaire.
3. Avant de déployer (ou juste après, dans **Project → Settings → Environment Variables**),
   ajouter :
   - `ANTHROPIC_API_KEY` = ta clé API Anthropic (récupérable sur console.anthropic.com)
4. Déployer. Vercel donne une URL du type `https://tri-factures-xxxx.vercel.app`.
   C'est cette URL que tu partages avec le comptable — aucune installation de son côté.

### Sans GitHub, via la CLI Vercel

```bash
npm install -g vercel
cd tri-factures-vercel
vercel login
vercel --prod
# puis, si pas déjà fait :
vercel env add ANTHROPIC_API_KEY
```

## À savoir

- **PDF** : chaque page est lue par l'IA comme une image de facture. Un PDF multi-pages
  très volumineux (plusieurs Mo, scan haute résolution) peut approcher la limite de
  taille de requête d'une fonction Vercel (~4,5 Mo sur le plan gratuit). Si ça arrive,
  le plus simple reste un PDF par facture, ou compresser le scan.
- **Coût** : chaque photo de facture traitée consomme des crédits sur ta clé API
  Anthropic (facturés à ton compte, pas au comptable). Le volume dépend du nombre
  de factures scannées.
- **Accès** : l'URL Vercel est publique par défaut (n'importe qui avec le lien peut
  l'ouvrir). Si tu veux la protéger, deux options simples :
  - Vercel propose une **Password Protection** native (payant, plan Pro).
  - Sinon je peux ajouter un mot de passe simple géré par la fonction serverless
    elle-même (gratuit, un cran moins robuste mais suffisant pour un usage interne).
- **Session uniquement** : comme avant, rien n'est sauvegardé côté serveur — chaque
  facture traitée reste dans le navigateur du comptable tant que l'onglet est ouvert.
  Si tu veux que les factures et le récap persistent (retrouver une session le lendemain,
  historique), il faudra ajouter une base de données (Supabase, comme tes autres projets) —
  dis-le moi quand ce sera utile.
- **Catégories analytiques** : les codes par défaut (`ANA-601-VIANDE`, etc.) sont à
  personnaliser directement dans l'appli, bouton « ⚙ Catégories » — ce réglage n'est
  pas encore sauvegardé côté serveur non plus (repart à zéro à l'ouverture), à voir
  aussi si utile de le figer une fois pour toutes.
