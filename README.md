# 3072

Jeu de fusion cérébral ultra-rapide : 3 → 6 → 12 → 24 → … → 3072.

## Version corrigée

Cette version conserve le principe du jeu tout en renforçant :

- le moteur de déplacement et de fusion ;
- les effets visuels ciblés sur les bonnes tuiles ;
- les animations de déplacement, apparition, fusion et objectif ;
- le chrono, avec pause automatique quand l’onglet est masqué ;
- les swipes tactiles et les commandes clavier ;
- le son, avec activation compatible navigateur ;
- l’accessibilité des commandes et de la fenêtre d’aide ;
- l’expérience mobile et desktop sans débordement horizontal ;
- le Service Worker et la stratégie de cache PWA.

## Fichiers

- `index.html` : interface et structure accessible
- `style.css` : design glassmorphism, responsive et effets premium
- `script.js` : moteur du jeu, score, combo, chrono, swipe, clavier, sons et effets
- `manifest.webmanifest` : configuration PWA
- `sw.js` : cache hors ligne et mise à jour du cache
- `images/` : icônes

## Déploiement GitHub Pages

1. Place tous les fichiers de ce dossier à la racine du dépôt GitHub.
2. Active GitHub Pages sur la branche `main` et le dossier `/ (root)`.
3. Ouvre le site en HTTPS pour profiter du Service Worker et de la PWA.

Aucune dépendance externe n'est requise.
