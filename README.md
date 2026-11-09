# Prava IA

Le logiciel des artisans : une IA qui répond au téléphone et sur le site, prend les rendez-vous, prépare les devis, les fait signer en ligne, crée les factures (acompte, situation, solde), relance les impayés, suit les chantiers et range la compta.

Chaque artisan crée son compte sur `/connexion` et a ses propres données (clients, devis, factures…), séparées de celles des autres.

## 1. Lancer sur son ordinateur (5 minutes)

1. Installer **Node.js 20 ou plus récent** : https://nodejs.org
2. Dans ce dossier :
   ```bash
   npm install
   cp .env.example .env      # puis remplir au moins ANTHROPIC_API_KEY
   npm start
   ```
3. Ouvrir **http://localhost:3000** → « Créer un compte ».

Sans aucune clé, devis, factures, PDF, agenda, clients, chantiers et compta marchent déjà. Les e-mails et SMS sont alors seulement enregistrés dans « Messages envoyés » (rien ne part).

## 2. Mettre en ligne

Il faut un serveur qui tourne en continu avec un **disque persistant** (les données sont dans le dossier `data/`).

**Option A : serveur en France (Scaleway, OVH) — conseillé pour le RGPD**
1. Louer un petit serveur Linux (Scaleway DEV1-S ou OVH VPS, environ 5 à 7 €/mois) et installer Docker.
2. Pointer votre nom de domaine (ex. `app.prava-ia.fr`) vers l'adresse IP du serveur.
3. Copier ce dossier sur le serveur, créer le fichier `.env`, remplacer `app.votre-domaine.fr` dans `Caddyfile` par votre domaine, puis :
   ```bash
   docker compose up -d
   ```
   Caddy met le HTTPS en place tout seul.

**Option B : Render (le plus simple, serveurs à Francfort)**
1. Mettre ce dossier dans un dépôt GitHub.
2. Sur render.com : New > Blueprint > choisir le dépôt (le fichier `render.yaml` crée le service et le disque, environ 8 €/mois).
3. Remplir les variables demandées (`PUBLIC_URL`, `ANTHROPIC_API_KEY`, SMTP).

Dans les deux cas, pensez à **sauvegarder le dossier `data/`** (une copie par jour suffit, par ex. `tar czf sauvegarde-$(date +%F).tgz data`).

## 3. Les clés à obtenir

| Pour quoi | Variable(s) | Où | Obligatoire ? |
|---|---|---|---|
| Liens envoyés aux clients | `PUBLIC_URL` | votre domaine | **Oui** en ligne |
| Sécurité des connexions | `SESSION_SECRET` | `openssl rand -hex 32` | **Oui** en ligne |
| IA (téléphone, chat, assistant, tri des mails, lecture des tickets) | `ANTHROPIC_API_KEY` | console.anthropic.com | Fortement conseillé |
| Envoyer devis, factures, relances, codes de signature, mot de passe oublié | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Brevo (gratuit jusqu'à 300 mails/jour), OVH, Scaleway TEM | **Oui** pour un vrai usage |
| SMS et vrai numéro de téléphone | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | twilio.com | Pour le téléphone IA |
| Paiement par carte | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | stripe.com | Non (sinon virement avec l'IBAN) |
| Voix naturelle / temps réel | `ELEVENLABS_API_KEY`, `VAPI_SECRET` | elevenlabs.io, vapi.ai | Non |
| Signature Yousign | `YOUSIGN_API_KEY` | yousign.com | Non (signature + code inclus) |
| Facture électronique | `PA_API_URL`, `PA_API_KEY`, `PA_NAME` | plateforme agréée | Pas encore (voir plus bas) |

Pour réserver les inscriptions à vos clients, mettez `SIGNUP_CODE=un-code` : il faudra ce code pour créer un compte.

## 4. Le parcours d'un artisan

1. **Créer un compte** (nom de l'entreprise, métier, e-mail, mot de passe).
2. **Paramètres** : SIRET, forme juridique, n° de TVA, assurance décennale, IBAN, horaires, équipe, catalogue de prix. La carte « Premiers pas » du tableau de bord dit ce qui manque. Le catalogue peut s'importer depuis Excel, Obat ou Batappli (**Importer mes données**).
3. **Devis** : créé à la main, par l'IA au téléphone, ou depuis une photo. Le client le reçoit par e-mail (PDF joint) et/ou SMS avec un lien.
4. **Signature** : le client signe au doigt sur son téléphone et confirme avec un code reçu par SMS ou e-mail. Le PDF garde la signature et le dossier de preuve.
5. **Factures** : l'acompte part à la signature ; la situation et le solde partent avec l'avancement du chantier, ou en un clic depuis le devis. PDF avec mentions légales et XML Factur-X joint.
6. **Paiement** : par carte si Stripe est branché, sinon la page de la facture affiche l'IBAN et la référence du virement. L'artisan note les règlements reçus (virement, chèque, espèces, paiement partiel).
7. **Relances** automatiques : devis non signés (J+3, J+7), factures (2 jours avant l'échéance, puis chaque semaine), rappels de rendez-vous la veille.
8. **Lien de réservation** (Paramètres > Mon compte) à mettre sur le site, Google et Instagram : l'IA répond et prend les rendez-vous.
9. **Téléphone** : acheter un numéro Twilio, régler « A call comes in » sur l'adresse affichée dans l'écran Téléphone (`/twilio/voice?b=...`) et renseigner ce numéro dans Paramètres > « Numéro Prava ».

## 5. Ce qui est réel et ce qui reste à faire

Réel : comptes et connexion sécurisée (mots de passe chiffrés, sessions, mot de passe oublié), données séparées par entreprise, devis/factures/PDF, numérotation continue, signature avec code, e-mails avec PDF, SMS Twilio, relances, agenda, chantiers et espace client, compta et export CSV, import Excel. Aucun paiement n'est jamais simulé sur un vrai compte.

Encore à faire avant de vendre à grande échelle :
- **Facture électronique** : choisir une plateforme agréée et adapter `lib/einvoice.js` à son API (le XML Factur-X est déjà généré). Obligatoire en réception depuis septembre 2026, en émission pour les TPE en septembre 2027.
- **Stripe, Yousign, Vapi** : le code suit leurs API publiques mais n'a pas été testé avec de vraies clés. Faire un essai en mode test avant la mise en production.
- **Abonnements** : la formule (Essentiel, Pro, Complet) se choisit dans Paramètres mais n'est pas encore facturée automatiquement (Stripe Billing à ajouter).
- **Base de données** : un fichier par entreprise, très bien jusqu'à quelques centaines de comptes. Au-delà, passer à PostgreSQL.
- **RGPD** : informer l'appelant qu'il parle à une IA, registre des traitements, contrat de sous-traitance avec chaque artisan.
- Les montants d'aides (MaPrimeRénov', CEE) dans `lib/aides.js` sont indicatifs : à mettre à jour chaque année.
- La page `/trouver` (annuaire d'artisans) contient des artisans fictifs : elle n'est plus dans le menu.

## 6. Faire une démo à un prospect

À l'inscription, cocher « Compte de démonstration » et choisir un profil (plombier, électricienne, peintre) : le compte est rempli d'une entreprise fictive (clients, chantier, factures, mails). Sur un compte de démo seulement, le paiement par carte est simulé et le code de signature s'affiche à l'écran. Ajouter un profil : copier un bloc dans `lib/demos.js`.

## Organisation du code

```
server.js           serveur web, API, comptes, webhooks (Twilio, Stripe, Yousign, Vapi), automatisations
lib/auth.js         comptes, mots de passe, sessions, mot de passe oublié
lib/db.js           stockage : une base par entreprise (data/tenants/<id>.json)
lib/mailer.js       envoi des e-mails (SMTP)
lib/agent.js        l'IA (Claude) : consignes, outils, conversation
lib/ops.js          agenda, devis, factures, messages, relances, statistiques
lib/billing.js      factures par étapes, paiements, relances, compta, mails, espace client
lib/pdf.js          devis et factures en PDF
lib/sectors.js      profils métiers        lib/plans.js     formules
lib/aides.js        MaPrimeRénov', CEE      lib/rentabilite.js marge, heures, bons de commande
lib/einvoice.js     Factur-X                lib/integrations.js Stripe, Yousign, ElevenLabs, Vapi, code de signature
lib/importer.js     import Excel / CSV      lib/demos.js     comptes de démonstration
public/             interface (login.html, index.html + app.js) et pages clients (devis, facture, RDV, chantier, réservation)
Dockerfile, docker-compose.yml, Caddyfile, render.yaml   mise en ligne
```
