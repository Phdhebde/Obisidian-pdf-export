---
title: Modèles
description: Personnaliser les modèles de PDF Report Exporter — sections, numérotation des titres, couleurs, polices, couverture, numéros de page, libellés et papier à en-tête — et les partager en fichiers JSON.
---

# Modèles

Le modèle décide de l'apparence du rapport ; la note décide de ce qu'il dit. Les modèles se gèrent dans **Réglages → PDF Report Exporter**. Un modèle **Rapport** est créé au premier lancement, et vous pouvez en ajouter autant que nécessaire : **nouveau**, **dupliquer**, **exporter en JSON**, **importer un JSON**, **supprimer**.

## Ce que règle un modèle

Sections et ordre
:   Couverture, Références, Rappel TLP, Sommaire, Contenu. La couverture reste toujours en premier.

Titres et sommaire
:   Pour chacun des six niveaux : sa numérotation (`1.`, `A.`, `a)`, `I.`, `i.` ou aucune), sa présence dans le sommaire, et s'il commence une nouvelle page. La numérotation hiérarchique (`1.1`, `1.A`…) s'active d'un clic.

Couleurs
:   Couleur principale, bandeaux d'en-tête et de pied de page et leur texte, en-tête, corps et bordures des tableaux, liens, titre du sommaire, texte courant, badges TLP.

Typographie
:   Polices du texte et des titres, un seul curseur de **taille du texte** (7 à 18 pt) dont tout le reste découle, texte justifié ou aligné à gauche, icônes des callouts, puces losange, notes incluses, marges.

Page de garde
:   Position et taille du titre, du filet, du sous-titre, de l'acronyme et du logo, en points depuis le coin supérieur gauche (A4 = 595 × 842 pt). Un titre trop long pour sa place rétrécit, puis repousse le filet et les sous-titres vers le bas.

En-tête et pied de page
:   Position du texte et format des numéros de page : `page {{page}}/{{total}}`, `{{page}}`, `Page {{page}} sur {{total}}`, aucun, ou le vôtre.

Libellés
:   « Références du document », en-têtes de tableaux, titres du rappel TLP… modifiables, dans n'importe quelle langue.

Habillage
:   Par défaut, le modèle dessine sa propre décoration dans ses couleurs. Choisissez des images A4 pleine page dans le coffre pour remplacer le fond de couverture et le cadre des pages par votre papier à en-tête ; le titre, le client, les numéros de page et les marquages restent du texte par-dessus. Un logo par défaut peut aussi être défini.

## Partager un modèle avec l'équipe

**Exporter ce modèle** écrit dans le coffre un fichier `.report-template.json` autonome, images comprises. Un collègue dépose ce fichier dans son coffre et l'importe depuis la même liste. Un modèle importé n'accepte que des images PNG et JPEG intégrées : un fichier partagé ne peut donc pas faire lire au plugin d'autres fichiers du coffre.

## Réglages généraux

- **Dossier de sortie** des PDF (vide : racine du coffre).
- **Nom du fichier**, avec les jetons `{{note}}`, `{{title}}`, `{{client}}`, `{{tlp}}`, `{{date}}` et `{{version}}`. Les jetons vides disparaissent avec leurs tirets.
- **Si le PDF existe déjà** : demander, garder les deux (nom numéroté) ou écraser.
- **Contacts par défaut**, utilisés par *Insérer le frontmatter de rapport*.
- **Passages confidentiels** : niveaux de diffusion, profils d'export, repérage et journal — voir [Export confidentiel](confidential-export.md).

À partir d'Obsidian 1.13, chaque réglage est aussi accessible depuis la recherche des réglages d'Obsidian.
