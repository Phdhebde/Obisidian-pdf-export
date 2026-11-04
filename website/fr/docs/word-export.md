---
title: Export Word
description: Exporter une note Obsidian en document Word (.docx) mis en page comme le rapport PDF, ou rempli dans le modèle .dotx de votre entreprise — page de garde, en-têtes, pieds de page et styles conservés, marqueurs remplacés, vrai sommaire Word, notes de bas de page et légendes.
---

# Export Word

La même note, avec le même filtre de confidentialité, peut sortir en document Word (`.docx`) au lieu d'un PDF. Deux possibilités :

- **Sans modèle Word**, le document est mis en page comme le PDF : même page de garde, mêmes bandeaux d'en-tête et de pied de page, page de références, rappel TLP et sommaire, aux couleurs du modèle — ou avec son papier à en-tête et le logo de la note.
- **Avec votre propre modèle Word** (`.dotx` ou `.docx`), le plugin le remplit : sa page de garde, ses en-têtes, ses pieds de page, son thème et ses styles restent tels quels, et le rapport va là où vous avez écrit `{{content}}`.

!!! info "Vérifié dans Word et LibreOffice"
    L'export Word est vérifié dans Microsoft Word, et chaque build ouvre ses documents d'exemple dans LibreOffice (voir [plus bas](#libreoffice-et-google-docs)). Si un document s'ouvre mal, [ouvrez une issue](https://github.com/Phdhebde/Obisidian-pdf-export/issues) avec la note et, si possible, le modèle Word.

## Exporter

| Comment | Ce que ça fait |
|---|---|
| Commande **Exporter en document Word** | Exporte la note active |
| Commande **Exporter en document Word avec un profil…** | Exporte une version : la complète, ou un profil comme *Client* (voir [Export confidentiel](confidential-export.md)) |
| **Clic droit sur une note** → **Exporter en document Word** | Exporte cette note |

Le fichier va là où irait le PDF : même dossier, même nom, avec l'extension `.docx`. Le choix du modèle et les profils fonctionnent comme pour le PDF.

!!! info "Word demande de mettre à jour les champs"
    À l'ouverture, Word demande *« Ce document contient des champs qui peuvent faire référence à d'autres fichiers. Voulez-vous mettre à jour les champs dans ce document ? »* Répondez **Oui** : Word ajoute alors les numéros de page au sommaire et numérote les légendes. Les entrées et leurs liens sont déjà là, donc un lecteur qui répond non a quand même un sommaire qui fonctionne.

## Utiliser votre propre modèle Word

1. Ouvrez le modèle de votre entreprise dans Word et écrivez des marqueurs là où vont les valeurs de la note — sur la page de garde, dans les en-têtes et les pieds de page, dans un tableau :

    | Marqueur | Remplacé par |
    |---|---|
    | `{{title}}` | Le `title` de la note |
    | `{{subtitle}}` | `subtitle` |
    | `{{acronym}}` | `acronym` |
    | `{{client}}` | `client` |
    | `{{author}}` | `author` |
    | `{{version}}`, `{{date}}`, `{{status}}` | La dernière ligne de `versions` (la date est celle du jour par défaut) |
    | `{{tlp}}` | Le marquage TLP, en gras, dans sa couleur (`TLP:AMBER`) |
    | `{{toc}}` | Un sommaire Word, seul dans son paragraphe |
    | `{{content}}` | Le rapport, seul dans son paragraphe |

2. Enregistrez-le en `.dotx` ou `.docx` dans le coffre. Les fichiers avec macros (`.dotm`, `.docm`) sont refusés.
3. Dans **Réglages → Report Exporter**, ouvrez le modèle du plugin à utiliser, puis **Export Word → Modèle Word → Choisir…**.

Les marqueurs gardent la mise en forme du texte qu'ils remplacent. Word coupe parfois un marqueur en plusieurs morceaux après une correction orthographique ou un changement de mise en forme ; le plugin le retrouve quand même. Un marqueur écrit dans la note elle-même reste tel quel.

Sans paragraphe `{{content}}`, le rapport est ajouté à la fin du modèle, et une notification le signale.

### Conseils pour un modèle qui marche bien

- **Numérotez les titres dans le modèle, ou pas du tout.** Quand les styles *Titre 1*, *Titre 2*… du modèle sont numérotés par Word (une liste à plusieurs niveaux liée à ces styles), le plugin laisse la numérotation à Word. Sinon, il écrit la numérotation du modèle du plugin (`A.`, `1.`…) en texte, comme dans le PDF.
- **Mettez la page de garde en premier et `{{content}}` sur une page à part.** Donnez au paragraphe de `{{content}}` l'option *Saut de page avant*, ou placez un saut de page juste au-dessus, pour que le rapport commence sur une nouvelle page.
- **Utilisez une première page différente** (*Mise en page → Première page différente*) pour une page de garde sans l'en-tête courant.
- **Nommez vos styles comme vous voulez.** Un style personnalisé comme *Corps de rapport* est proposé dans le tableau **Styles Word** des réglages, où vous y associez le *Texte courant*.
- **Le format et l'orientation viennent du modèle.** Tableaux, images et colonnes prennent la largeur de sa zone de texte, en portrait comme en paysage.
- **Les notes de bas de page déjà présentes dans le modèle sont conservées** ; celles de la note viennent après.

### Modèles d'exemple

Trois modèles sous licence libre, écrits dans Word et utilisés par le banc d'essai, sont dans le dossier [`templates/word`](https://github.com/Phdhebde/Obisidian-pdf-export/tree/main/templates/word) du dépôt. Téléchargez-en un dans votre coffre pour partir de là :

| Modèle | Ce qu'il montre |
|---|---|
| [`consulting-report.dotx`](https://github.com/Phdhebde/Obisidian-pdf-export/raw/main/templates/word/consulting-report.dotx) | Page de garde avec tous les marqueurs, `{{toc}}` sur sa propre page, titres numérotés par Word (1., 1.1.), en-tête courant à partir de la deuxième page, TLP et numéro de page en pied de page |
| [`memo.dotx`](https://github.com/Phdhebde/Obisidian-pdf-export/raw/main/templates/word/memo.dotx) | Sans page de garde : marqueurs dans un tableau en haut, un style *Corps de rapport* à choisir dans les réglages |
| [`landscape-brief.dotx`](https://github.com/Phdhebde/Obisidian-pdf-export/raw/main/templates/word/landscape-brief.dotx) | A4 paysage, marges étroites, une note de bas de page qui lui est propre |

## Styles

Chaque élément de la note prend un style Word, retrouvé dans le modèle par son **nom interne** — le même dans toutes les langues, donc un modèle enregistré par un Word français (`Titre 1`) fonctionne comme un anglais (`Heading 1`) :

| Élément | Style par défaut |
|---|---|
| Texte courant | Normal |
| Titres 1 à 6 | Titre 1 … Titre 6 |
| Éléments de liste | Paragraphe de liste |
| Légendes | Légende |
| Blocs de code | HTML préformaté |
| Code dans le texte | Code HTML |
| Liens | Lien hypertexte |
| Tableaux | Grille du tableau |
| Notes de bas de page, appels de note | Note de bas de page, Appel de note de bas de page |
| Sommaire | En-tête de table des matières, TM 1 … TM 6 |

Le tableau **Styles Word** des réglages fait pointer n'importe quel élément vers un autre style du modèle — par exemple le texte courant vers votre style *Corps de texte*. Un style absent du modèle est ajouté au document, d'après les couleurs et les polices du modèle du plugin.

## Ce qui est rendu

| Dans la note | Dans Word |
|---|---|
| Titres | Les styles de titre du modèle, numérotés par le modèle ou comme dans le PDF (`A.`, `1.`…), avec un signet pour le sommaire |
| Gras, italique, barré, code dans le texte, `<br>` | Mise en forme directe et style de code |
| Liens | De vrais liens hypertexte Word |
| Listes à puces, numérotées et de tâches | Numérotation Word ; cases ☐ et ☑ |
| Tableaux | Le style de tableau, avec la ligne d'en-tête répétée sur chaque page |
| Images | Incorporées, à la largeur demandée |
| `*Figure 1 : …*`, `Tableau 2 : …` | Des légendes Word : le numéro est un champ de séquence, donc *Insérer une table des illustrations* les liste et les renumérote quand on en ajoute une. `Fig.` compte avec les figures |
| `texte[^1]`, `[^1]: note`, `texte^[note en ligne]` | De vraies notes de bas de page Word, en bas de la page qui les cite ; une note citée deux fois garde le même numéro |
| Colonnes (` ````col `, `> [!col]`) | Côte à côte dans un tableau sans bordure, chacune à la largeur de sa part `flexGrow`, avec sa bordure et son alignement ; une rangée de colonnes n'est pas coupée entre deux pages |
| Blocs de code | Le style de code : police à chasse fixe, fond grisé, espaces et tabulations conservés |
| Callouts | Un encadré teinté avec une barre de leur couleur, leur icône et un titre coloré |
| Schémas Mermaid | Dessinés par Obsidian, incorporés en images vectorielles, avec une image pour les anciennes versions de Word |
| `\pagebreak`, `---` | Sauts de page et filets |
| Passages restreints | Signalés et surlignés dans la version complète, retirés des autres — comme dans le PDF |

## LibreOffice et Google Docs

L'export Word est écrit pour Microsoft Word et vérifié dans Word. Chaque build ouvre aussi chaque document d'exemple dans **LibreOffice** et l'imprime en PDF : un fichier que LibreOffice ne sait pas ouvrir ne peut pas sortir. Le rendu peut tout de même différer de celui de Word :

- Si le sommaire n'a pas de numéros de page, ou si les légendes gardent le numéro écrit dans la note, mettez à jour les champs : *Outils → Actualiser → Tout actualiser* dans LibreOffice.
- Les polices que le modèle demande mais que l'ordinateur n'a pas sont remplacées par les plus proches de LibreOffice, ce qui peut changer les retours à la ligne.

**Google Docs** n'est pas testé. Si vous l'utilisez, dites-nous dans les [issues](https://github.com/Phdhebde/Obisidian-pdf-export/issues) ce qui marche et ce qui ne marche pas.

## Vérifié en CI

Chaque build produit des documents d'exemple — générés, avec papier à en-tête, à partir des notes d'exemple, d'un modèle Word, et de chacun des trois modèles d'exemple — puis :

- les vérifie avec le validateur Open XML de Microsoft : une modification qui ferait dire à Word qu'il a trouvé du *« contenu illisible »* ne peut pas sortir ;
- les ouvre dans LibreOffice.

Les tests de confidentialité vérifient aussi le fichier Word : aucun texte restreint — notes de bas de page comprises — n'arrive dans un `.docx` client.
