# Images locales

Ajoutez vos photos dans ce dossier. Formats pris en charge :

- `.png`
- `.jpg`
- `.jpeg`
- `.webp`
- `.gif`
- `.svg`
- `.avif`

L'application détecte automatiquement les images du dossier quand le serveur expose le listing du dossier `images/`.

Sur GitHub Pages, l'application interroge automatiquement l'API GitHub publique du dépôt pour trouver les fichiers de ce dossier après publication.

`manifest.json` est la seule source de vérité pour la liste manuelle des images. `manifest.js` le charge automatiquement pour éviter de maintenir deux listes séparées.

Pour mettre à jour la liste après avoir ajouté ou supprimé des images, lancez depuis la racine du projet :

```bash
node sync-manifest.js
```

Cela régénère `manifest.json` et le fallback local de `manifest.js` depuis le contenu réel du dossier `images/`.
