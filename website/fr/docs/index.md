---
title: Exporter ses notes Obsidian en rapports PDF professionnels
description: PDF Report Exporter est un plugin Obsidian gratuit et open source qui transforme une note Markdown en rapport PDF soigné — page de garde, sommaire cliquable, modèles, schémas Mermaid, callouts — et peut produire une version client sans les passages confidentiels.
---

# Exporter ses notes Obsidian en rapports PDF professionnels

**PDF Report Exporter** est un plugin [Obsidian](https://obsidian.md) gratuit et open source qui transforme une note Markdown en rapport prêt à envoyer : page de garde, bandeaux d'en-tête et de pied de page, sommaire cliquable, tableaux mis en forme, callouts Obsidian avec leurs icônes et schémas Mermaid en vectoriel. Les modèles fixent l'apparence ; la note reste du Markdown ordinaire.

[Premiers pas](getting-started.md){ .md-button .md-button--primary }
[Télécharger la dernière version](https://github.com/Phdhebde/Obisidian-pdf-export/releases/latest){ .md-button }

<div class="grid" markdown>

![Page de garde d'un rapport exporté depuis Obsidian avec PDF Report Exporter](assets/images/report-cover.webp){ loading=lazy width="300" }

![Page de contenu avec titres numérotés, une liste et un tableau mis en forme](assets/images/report-body.webp){ loading=lazy width="300" }

</div>

## Ce qu'il fait

| Vous écrivez dans Obsidian | Vous obtenez dans le PDF |
|---|---|
| Une note avec quelques clés de frontmatter (`titre`, `client`, `versions`, `contacts`) | Une page de garde, une page de références avec l'état du document et les contacts, un en-tête et un pied de page sur chaque page |
| Des titres `#`, `##`, `###` | Des titres numérotés (`A.`, `1.`, `a)`… réglables) et un sommaire paginé et cliquable |
| Des callouts `> [!warning]`, tableaux, listes de tâches, code | Des callouts avec leurs icônes Lucide, des tableaux ajustés à la page, des cases à cocher vectorielles, des blocs de code |
| Des blocs ` ```mermaid ` | Des schémas dessinés par le Mermaid d'Obsidian, intégrés en vectoriel |
| `![[image.png]]`, `![[autre note]]` | Des images intégrées (WEBP, SVG, GIF… convertis) et des notes incluses |
| `## Tarifs %%internal%%` | Une version interne complète, et une version client sans cette section |

## Pourquoi l'utiliser

- **Des rapports, pas des impressions.** L'export PDF intégré d'Obsidian imprime la note telle qu'elle s'affiche. PDF Report Exporter la met en page comme un document : page de garde, sommaire, numéros de page, en-tête courant, marquage TLP.
- **Des modèles partageables.** Couleurs, polices, numérotation, mise en page de la couverture, format des numéros de page et votre propre papier à en-tête vivent dans des modèles. Exportez-en un en JSON, un collègue l'importe.
- **Une note, plusieurs publics.** Marquez ce qui doit rester interne ; exportez une version complète pour l'équipe et une version client d'où ces passages sont retirés avant le rendu, jamais masqués par un bandeau noir. Voir [Export confidentiel](confidential-export.md).
- **Respect de la vie privée.** Aucun accès réseau, aucun compte, aucune télémétrie. Les polices sont incluses dans le plugin : il fonctionne hors ligne.
- **Anglais et français.** L'interface suit la langue d'Obsidian, et les clés du frontmatter sont comprises dans les deux langues.

## Installation en une minute

1. Dans Obsidian, ouvrez **Réglages → Plugins communautaires → Parcourir**.
2. Cherchez **PDF Report Exporter**, installez-le, puis activez-le.
3. Ouvrez une note et lancez **Exporter en rapport PDF** depuis la palette de commandes (++ctrl+p++ / ++cmd+p++).

Détails, installation manuelle et premier export pas à pas : [Premiers pas](getting-started.md).

!!! info "Prérequis"
    Obsidian **1.8.7 ou plus récent**, sur ordinateur (Windows, macOS, Linux). Le mobile n'est pas pris en charge : le moteur PDF et les polices ont besoin de l'application de bureau.

## Gratuit et communautaire

Le plugin est sous licence MIT, sans version payante, et le restera. Idées, signalements de bugs, modèles et traductions sont les bienvenus dans les [issues GitHub](https://github.com/Phdhebde/Obisidian-pdf-export/issues). La suite, l'export Word à partir de votre propre modèle `.dotx`, est décrite dans la [feuille de route](roadmap.md).
