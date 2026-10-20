---
title: Markdown pris en charge
description: Comment PDF Report Exporter rend le Markdown d'Obsidian dans un PDF — titres numérotés, callouts avec icônes, tableaux ajustés à la page, listes de tâches, schémas Mermaid vectoriels, colonnes, images, notes incluses et sauts de page.
---

# Markdown pris en charge

PDF Report Exporter lit le Markdown que vous écrivez déjà dans Obsidian. Vos notes n'ont rien à changer.

| Markdown | Dans le PDF |
|---|---|
| `# Titre` | Titre de niveau 1 dans la couleur principale du modèle, repris dans le sommaire |
| `##` à `######` | Numérotés automatiquement — `A.`, `1.`, `a)` par défaut, réglable par niveau |
| `**gras**`, `*italique*`, `~~barré~~`, `` `code` `` | Mise en forme en ligne |
| `[texte](url)` | Lien, cliquable dans le PDF pour `http(s)` et `mailto:` |
| `[[Page]]`, `[[Page\|alias]]` | Remplacés par un texte lisible |
| `- élément`, `1. élément` | Listes |
| `- [ ]`, `- [x]` | Listes de tâches, avec des cases vectorielles |
| Liste sous un titre `# Recommandations` | Puces losange dans la couleur principale (désactivable) |
| `> [!warning] Titre` | Callout Obsidian avec l'icône et la couleur de son type |
| `> citation` | Encadré avec une barre de couleur |
| `| col | col |` | Tableau mis en forme ; un tableau trop large est ajusté à la page |
| ` ``` ` | Bloc de code |
| ` ```mermaid ` | Schéma Mermaid, dessiné par le Mermaid d'Obsidian et intégré en vectoriel |
| ` ```col `, `> [!col]` | Colonnes du plugin [Obsidian Columns](https://github.com/tnichols217/obsidian-columns), les trois syntaxes |
| `*Figure 1 : …*` | Légende centrée en italique |
| `%%commentaire%%` | Omis, comme en mode lecture dans Obsidian |

Types de callouts : `note`, `tip`, `info`, `todo`, `success`, `question`, `warning`, `failure`, `danger`, `bug`, `example`, `quote` et leurs alias.

Seuls les paragraphes qui commencent par *Figure*, *Tableau*, *Graphique*, *Schéma*, *Illustration*, *Annexe*, *Exhibit* ou *Listing* (ou leurs équivalents anglais) deviennent des légendes ; un paragraphe en italique ordinaire reste du texte.

## Images

`![[capture.png]]`, `![[capture.png|400]]` (largeur) et `![alt](chemin/capture.png)` fonctionnent. Le PNG et le JPEG sont intégrés tels quels ; WEBP, GIF, SVG, BMP, AVIF et TIFF sont convertis en PNG. Une image introuvable est signalée dans le rapport et dans une notice au lieu de faire échouer l'export. Une image répétée dans la note n'est intégrée qu'une fois, et une référence d'image écrite dans un bloc de code est laissée telle quelle.

## Notes incluses

`![[autre note]]` insère le contenu de cette note, jusqu'à trois niveaux ; les inclusions circulaires sont détectées. Un modèle peut se contenter de *mentionner* la note. Les notes marquées `audience:` ou `tlp:` sont retirées des versions restreintes — voir [Export confidentiel](confidential-export.md).

## Sauts de page

Mettez `\pagebreak` seul sur une ligne — ou `\newpage`, `[pagebreak]`, `<!-- pagebreak -->`, `<div style="page-break-after: always"></div>`. Un modèle peut aussi faire commencer chaque titre d'un niveau donné sur une nouvelle page.

## Limites

- **Polices** : Liberation Sans (métriquement compatible avec Arial), Liberation Mono et Archivo Black sont intégrées — d'où les 5 Mo environ du plugin. Les écritures qu'elles ne couvrent pas (CJK, arabe…) ne s'affichent pas.
- **Sommaire** : les entrées sont cliquables mais sans points de conduite.
- **Tableaux larges** : les colonnes prennent une largeur proportionnelle à leur contenu, la police descend jusqu'à 7 pt si besoin et, en dernier recours, les mots trop longs sont coupés entre deux caractères — sans en ajouter, pour qu'une empreinte copiée depuis le PDF reste exacte.
- Les **colonnes** ne sont pas coupées d'une page à l'autre.
- Dataview et les autres requêtes dynamiques ne sont pas rendues. Le format est A4.
