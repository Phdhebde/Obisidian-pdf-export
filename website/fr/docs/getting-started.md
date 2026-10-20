---
title: Premiers pas
description: Installer PDF Report Exporter depuis le catalogue des plugins communautaires d'Obsidian ou manuellement, puis exporter sa première note en rapport PDF avec page de garde et sommaire.
---

# Premiers pas

Cette page vous mène de l'installation à votre premier rapport exporté en cinq minutes environ.

## Installer le plugin

=== "Depuis le catalogue communautaire"

    1. Dans Obsidian, ouvrez **Réglages → Plugins communautaires**. Si besoin, désactivez le *mode restreint*.
    2. Cliquez sur **Parcourir**, cherchez **PDF Report Exporter**, puis **Installer** et **Activer**.

=== "Manuellement"

    1. Téléchargez `main.js`, `manifest.json` et `styles.css` depuis la [dernière version](https://github.com/Phdhebde/Obisidian-pdf-export/releases/latest).
    2. Placez-les dans `<votre coffre>/.obsidian/plugins/pdf-report-exporter/`.
    3. Relancez Obsidian, puis activez **PDF Report Exporter** dans **Réglages → Plugins communautaires**.

Le plugin fonctionne avec Obsidian **1.8.7 ou plus récent**, sur ordinateur uniquement.

## Exporter votre premier rapport

1. Ouvrez une note, ou créez-en une avec quelques titres et paragraphes.
2. Lancez **Insérer le frontmatter de rapport** depuis la palette de commandes (++ctrl+p++ / ++cmd+p++). Un bloc pré-rempli s'ajoute en haut de la note :

    ```yaml
    ---
    titre: Bilan de la migration du site
    client: ACME Corp
    sous_titre: Équipe infrastructure
    versions:
      - version: "1.0"
        date: "19/10/2026"
        etat: "Création du document"
    contacts:
      - nom: "Camille Martin"
        poste: "Cheffe de projet"
        courriel: "camille.martin@exemple.fr"
    ---
    ```

3. Complétez le titre et le client, puis lancez **Aperçu du rapport PDF**. Le PDF s'ouvre dans un onglet d'Obsidian ; relancez l'aperçu après chaque modification.
4. Quand le résultat vous convient, lancez **Exporter en rapport PDF**. Le fichier est écrit à la racine du coffre, ou dans le dossier de sortie choisi dans les réglages, et une notice propose de l'ouvrir ou de l'afficher dans son dossier.

![Page de sommaire générée à partir des titres de la note](assets/images/report-toc.webp){ loading=lazy width="420" }

## Toutes les façons d'exporter

| Comment | Ce que ça fait |
|---|---|
| Commande **Exporter en rapport PDF**, ou l'icône du ruban | Exporte la note active |
| Commande **Aperçu du rapport PDF** | Génère le PDF et l'ouvre dans Obsidian, en réutilisant le même fichier et le même onglet |
| Commande **Exporter la sélection en rapport PDF** | N'exporte que le texte sélectionné |
| Commande **Exporter en rapport PDF avec un profil…** | Exporte une version : la complète, ou un profil comme *Client* — voir [Export confidentiel](confidential-export.md) |
| Commande **Exporter toutes les versions en rapports PDF** | Écrit la version complète et un PDF par profil |
| Clic droit sur une note dans l'explorateur | Exporte cette note |
| Clic droit sur un dossier | Exporte toutes ses notes, un PDF chacune, avec un compte rendu à la fin |

Avec plusieurs modèles, une fenêtre demande lequel utiliser. Elle est ignorée s'il n'y en a qu'un, si la note en désigne un avec `modele:` dans son frontmatter, ou si vous avez coché **Ne plus demander**.

## Pour aller plus loin

- [Frontmatter](frontmatter.md) : toutes les clés lues pour la couverture et la page de références.
- [Markdown](markdown.md) : ce que devient chaque élément Markdown dans le PDF.
- [Modèles](templates.md) : couleurs, numérotation, couverture, votre papier à en-tête.
- [Export confidentiel](confidential-export.md) : une note, une version complète et une version client.
- Essayez les deux notes d'exemple du dépôt : [`example-report.md`](https://github.com/Phdhebde/Obisidian-pdf-export/blob/main/example-report.md) et [`example-confidential.md`](https://github.com/Phdhebde/Obisidian-pdf-export/blob/main/example-confidential.md).
