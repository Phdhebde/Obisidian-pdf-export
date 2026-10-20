---
title: FAQ
description: Réponses aux questions fréquentes sur PDF Report Exporter pour Obsidian — prix, confidentialité, mobile, différence avec l'export PDF intégré d'Obsidian, papier à en-tête, versions confidentielles, Mermaid et langues.
---

# Questions fréquentes

## Comment exporter une note Obsidian en PDF avec une page de garde et un sommaire ?

Installez **PDF Report Exporter** depuis le catalogue des plugins communautaires, ouvrez la note et lancez **Exporter en rapport PDF** depuis la palette de commandes. La page de garde est remplie à partir du frontmatter de la note (`titre`, `client`, `sous_titre`), et le sommaire est construit à partir de ses titres, avec numéros de page et entrées cliquables. Voir [Premiers pas](getting-started.md).

## PDF Report Exporter est-il gratuit ?

Oui. Il est open source sous licence MIT, sans version payante, sans compte et sans limite d'utilisation.

## Le plugin envoie-t-il mes notes quelque part ?

Non. Il ne fait aucune requête réseau : le PDF est généré sur votre ordinateur, et les polices nécessaires sont incluses dans le plugin. Il fonctionne hors ligne.

## Quelle différence avec l'« Exporter en PDF » intégré à Obsidian ?

L'export intégré d'Obsidian imprime la note telle qu'elle s'affiche à l'écran. PDF Report Exporter la met en page comme un rapport : page de garde, page de références avec l'état du document et les contacts, en-tête et pied de page courants, titres numérotés, sommaire cliquable, tableaux et callouts mis en forme, marquage TLP facultatif — le tout piloté par des modèles réutilisables.

## Puis-je utiliser le papier à en-tête ou la charte de mon entreprise ?

Oui. Un modèle fixe les couleurs, polices, marges, la numérotation et la mise en page de la couverture, et peut remplacer la décoration intégrée par vos propres images A4 pleine page pour la couverture et le cadre des pages. Le texte reste modifiable par-dessus. Voir [Modèles](templates.md).

## Puis-je envoyer à un client une version sans les parties internes ?

Oui, depuis la version 1.1. Marquez des sections, callouts, phrases ou notes entières comme `internal`, puis lancez **Exporter toutes les versions en rapports PDF** : vous obtenez la version complète et une version client d'où ces passages sont retirés avant le rendu. Voir [Export confidentiel](confidential-export.md).

## Fonctionne-t-il sur mobile ?

Non. Le plugin fonctionne uniquement sur ordinateur (Windows, macOS, Linux) : le moteur PDF et les polices intégrées ont besoin de l'application de bureau.

## Quelle version d'Obsidian faut-il ?

Obsidian 1.8.7 ou plus récent.

## Les schémas Mermaid sont-ils pris en charge ?

Oui. Les schémas sont dessinés par le Mermaid d'Obsidian et intégrés en vectoriel : ils restent nets à tous les niveaux de zoom. Un schéma invalide est imprimé sous forme de code, avec une notice.

## Quelles langues sont prises en charge ?

L'interface est en français et en anglais et suit la langue d'Obsidian. Les clés du frontmatter sont comprises dans les deux langues, et chaque libellé imprimé dans le PDF peut être réécrit dans n'importe quelle langue. Les polices intégrées couvrent les écritures latines ; le chinois, le japonais, le coréen ou l'arabe ne s'affichent pas.

## Pourquoi le plugin pèse-t-il environ 5 Mo ?

Les polices sont intégrées dans `main.js`, car le catalogue communautaire ne distribue que ce fichier, le manifeste et la feuille de style. C'est ce qui permet au plugin de fonctionner hors ligne sans rien installer d'autre.

## Puis-je exporter tout un dossier d'un coup ?

Oui. Faites un clic droit sur un dossier dans l'explorateur : chaque note est exportée, un PDF chacune, avec un compte rendu à la fin.

## Y aura-t-il un export Word (.docx) ?

C'est la prochaine grande étape de la [feuille de route](roadmap.md) : un export Word à partir de votre propre modèle `.dotx`, pour que la charte de l'entreprise vienne du modèle lui-même.

## Comment signaler un bug ou proposer une idée ?

Ouvrez une issue sur [GitHub](https://github.com/Phdhebde/Obisidian-pdf-export/issues). Indiquer la version du plugin, celle d'Obsidian et une petite note qui reproduit le problème aide beaucoup.
