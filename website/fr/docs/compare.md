---
title: Comparatif des plugins d'export PDF pour Obsidian
description: Quel plugin Obsidian choisir pour un export PDF personnalisé et professionnel — l'export PDF intégré d'Obsidian, PDF Report Exporter, Better Export PDF, Omd to Typst, Document Export et PDF Export Enhancer comparés sur la page de garde, le sommaire, les modèles, la charte graphique et les dépendances.
---

# Comparatif des plugins d'export PDF pour Obsidian

**En bref :** pour exporter une note Obsidian en **PDF personnalisé et professionnel** (page de garde, sommaire cliquable, en-tête et pied de page, couleurs, polices et papier à en-tête de votre entreprise) sans rien installer d'autre que le plugin, utilisez **PDF Report Exporter**. Pour assembler de nombreuses notes dans un seul PDF qui ressemble au mode lecture d'Obsidian, utilisez **Better Export PDF**. Si vous utilisez déjà Typst et voulez écrire la mise en page vous-même, utilisez **Omd to Typst**.

Cette page compare les principales façons d'exporter des notes Obsidian en PDF, d'après la documentation de chaque plugin (octobre 2026). Elle est écrite par l'auteur de PDF Report Exporter : les corrections sont bienvenues dans les [issues GitHub](https://github.com/Phdhebde/Obisidian-pdf-export/issues).

## Vue d'ensemble

| | Page de garde | Sommaire cliquable | Apparence personnalisable | Autre logiciel à installer | Résultat |
|---|---|---|---|---|---|
| **Export PDF intégré d'Obsidian** | Non | Non | Format, marges, snippets CSS | Non | PDF identique à la note à l'écran |
| **PDF Report Exporter** | Oui, depuis le frontmatter, avec logo | Oui, paginé, titres numérotés | Modèles : couleurs, polices, numérotation, couverture, papier à en-tête, partageables en JSON | Non (polices embarquées, hors ligne) | Rapport PDF, et versions client sans passages confidentiels |
| **[Better Export PDF](https://community.obsidian.md/plugins/better-export-pdf)** | Pas de page de garde dédiée | Signets PDF, et une note de liens peut fixer l'ordre | Snippets CSS, en-tête et pied de page en HTML | Non | PDF au rendu du mode lecture, plusieurs notes en un |
| **[Omd to Typst](https://community.obsidian.md/plugins/omd-to-typst)** | Oui, depuis le frontmatter | Oui, titres numérotés | Vos propres modèles `.typ` | Oui : le compilateur Typst | PDF ou source `.typ` |
| **[Document Export](https://community.obsidian.md/plugins/juanperez-document-export)** | Oui : titre, sous-titre, auteur ou image | Oui, sur sa propre page | Police, taille, position des numéros de page ; pas de modèles | Non pour PDF et DOCX ; un compilateur LaTeX pour le `.tex` | PDF (US Letter), DOCX, LaTeX |
| **[PDF Export Enhancer](https://community.obsidian.md/plugins/pdf-export-enhancer)** | Non | Non | Taille du texte, marges, numéros de page, thèmes | Non | L'export PDF intégré, avec plus de réglages |

## Lequel choisir ?

### Vous envoyez des rapports à des clients ou à votre hiérarchie

Choisissez **PDF Report Exporter**. Il met la note en page comme un document au lieu d'imprimer l'écran : page de garde, page de références avec état du document, contacts et destinataires, en-tête et pied de page sur chaque page, titres numérotés, sommaire cliquable avec numéros de page, tableaux mis en forme, callouts Obsidian avec leurs icônes et schémas Mermaid en vectoriel. L'apparence est définie dans des [modèles](templates.md), qui peuvent porter votre propre papier à en-tête pleine page et se partager avec vos collègues en fichier JSON.

C'est aussi le seul de ces plugins qui produit une [version client](confidential-export.md) de la même note : les passages marqués comme internes sont retirés avant le rendu, pas masqués sous un rectangle noir.

### Vous voulez un PDF identique à vos notes

Choisissez **Better Export PDF**, ou l'export intégré d'Obsidian si les réglages par défaut suffisent. Ils impriment ce que vous voyez en mode lecture, thème et snippets CSS compris, et Better Export PDF peut fusionner un dossier de notes en un seul PDF avec signets.

### Vous voulez un contrôle typographique total et écrire vos modèles

Choisissez **Omd to Typst**. Vous installez le compilateur Typst et décrivez la mise en page dans le langage de Typst.

### Il vous faut aussi un fichier Word

**Document Export** produit du PDF et du DOCX à partir de la même note. PDF Report Exporter ne produit que du PDF pour l'instant ; l'export Word à partir de votre propre modèle `.dotx` est la prochaine étape de sa [feuille de route](roadmap.md).

## Ce que PDF Report Exporter ne fait pas

- **Mobile.** Il fonctionne uniquement sur ordinateur (Windows, macOS, Linux).
- **Votre thème Obsidian.** Le PDF suit le modèle, pas le thème ni les snippets CSS du coffre.
- **Écritures non latines.** Les polices embarquées couvrent l'alphabet latin ; le chinois, le japonais, le coréen et l'arabe ne s'affichent pas.
- **Plusieurs notes dans un seul PDF.** L'export d'un dossier produit un PDF par note. Pour réunir plusieurs notes dans un rapport, incluez-les dans une note parente avec `![[note]]`.

## L'essayer

PDF Report Exporter est gratuit et open source (MIT). Dans Obsidian, ouvrez **Réglages → Plugins communautaires → Parcourir**, cherchez **PDF Report Exporter**, puis lancez **Exporter en rapport PDF** sur une note. Voir [Premiers pas](getting-started.md).
