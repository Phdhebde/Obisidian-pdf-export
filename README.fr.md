# PDF Report Exporter

*[English version](README.md)*

Exporte n'importe quelle note Obsidian en **rapport PDF soigné** : page de garde, bandeaux d'en-tête et de pied de page, sommaire paginé cliquable, tableaux stylés, callouts Obsidian avec leurs icônes, schémas Mermaid en vectoriel, colonnes, images — le tout piloté par des **modèles** personnalisables, duplicables et partageables, sélectionnés au moment de l'export.

Le plugin fonctionne entièrement hors ligne : aucune requête réseau, et les polices nécessaires sont embarquées.

L'interface suit la langue d'Obsidian (français ou anglais).

---

## Installation

**Depuis le store :** *Paramètres → Modules complémentaires → Parcourir*, cherchez **PDF Report Exporter**, installez puis activez.

**Manuellement :** téléchargez `main.js`, `manifest.json` et `styles.css` depuis la [dernière release](https://github.com/Phdhebde/Obisidian-pdf-export/releases/latest) dans `<coffre>/.obsidian/plugins/pdf-report-exporter/`, puis activez le plugin.

Ordinateur uniquement.

---

## Utilisation

### Exporter

| Comment | Ce que ça fait |
|---|---|
| Commande **« Exporter en rapport PDF »** (`Ctrl/Cmd+P`) ou l'icône du ruban | Exporte la note active |
| Commande **« Aperçu du rapport PDF »** | Génère le PDF et **l'ouvre dans Obsidian** — le moyen rapide de régler un modèle |
| Commande **« Exporter la sélection en rapport PDF »** | N'exporte que le texte sélectionné |
| **Clic droit sur une note** | Exporte cette note |
| **Clic droit sur un dossier** | Exporte toutes ses notes, une par une, avec un compte-rendu final |
| Commande **« Insérer le frontmatter de rapport »** | Insère le bloc YAML pré-rempli (date du jour, contacts par défaut) |

Avec plusieurs modèles, une fenêtre demande lequel utiliser (clavier : `↑ ↓`, `Entrée`, `Échap`). Elle est ignorée s'il n'y a qu'un modèle, si la note en désigne un, ou si vous avez coché **« Ne plus demander »**.

### Frontmatter

Toutes les clés sont facultatives ; les clés françaises et anglaises sont acceptées indifféremment :

```yaml
---
titre: Rapport d'audit                # couverture + en-tête (défaut : nom de la note)
client: ACME                          # sous le titre dans l'en-tête
sous_titre: Équipe infrastructure
acronyme: INFRA
auteur: Camille Martin                # métadonnées du PDF
logo: logos/acme.png                  # logo sur la page de garde
modele: Rapport                       # impose un modèle, sans fenêtre de sélection
sections: [cover, toc, body]          # surcharge les sections pour cette note
tlp: AMBER                            # marquage Traffic Light Protocol (facultatif)
versions:                             # tableau « Statut du document »
  - version: "1.0"
    date: "08/06/2026"
    etat: "Création du document"
contacts:                             # tableau « Contacts »
  - nom: "Camille Martin"
    poste: "Cheffe de projet"
    courriel: "camille.martin@exemple.fr"
destinataires:                        # tableau « Destinataires » (facultatif)
  - nom: "Jean Dupont"
    societe: "ACME"                   # ou `poste:`, qui a la priorité
    courriel: "jean.dupont@exemple.fr"
---
```

Attention à ne pas confondre `destinataire` (singulier, alias de `client`) et `destinataires` (pluriel, la liste du tableau).

**TLP (facultatif) :** sans clé `tlp`, aucun marquage n'est imprimé — sauf si le modèle inclut la page *Rappel TLP*, auquel cas le rapport est marqué `TLP:CLEAR`. Une valeur non reconnue déclenche un avertissement ; `WHITE` (TLP 1.0) est converti en `CLEAR`.

### Markdown

Titres numérotés automatiquement (`A.`, `1.`, `a)` par défaut, réglable par niveau), liens cliquables, listes et cases à cocher, **callouts** Obsidian avec leur icône, tableaux ajustés à la page, blocs de code, **schémas Mermaid** vectoriels, **colonnes** du plugin *Obsidian Columns*, légendes (`*Figure 1 : …*`), images (`![[capture.png|400]]`), notes incluses (`![[autre note]]`) et sauts de page (`\pagebreak` sur sa propre ligne). Les listes placées sous un titre `# Recommandations` prennent des puces losange (désactivable).

Le détail de chaque convention est dans le [README anglais](README.md#markdown).

---

## Modèles

*Paramètres → PDF Report Exporter.* Un modèle **Rapport** est créé au premier lancement. Pour chaque modèle : sections et leur ordre, numérotation et sommaire par niveau de titre, couleurs, polices et taille du texte, positions de la page de garde, format de pagination, libellés fixes, et **habillage** — par défaut le modèle dessine lui-même son décor à ses couleurs ; choisissez vos propres images A4 (fond de couverture, cadre des pages avec votre papier à en-tête) pour le remplacer.

**Partage d'équipe :** « Exporter ce modèle » écrit un `.report-template.json` autonome (images incluses) dans le coffre ; un collègue l'importe depuis la même liste.

**Reprendre un modèle existant :** un fichier de modèle `.json` exporté par une version antérieure ou un outil interne au même format (objet `{ "preset": … }` ou modèle seul) s'importe aussi : les champs manquants sont complétés par les valeurs par défaut, et les images incluses sont conservées.

---

## Limites

- **Polices :** Liberation Sans (équivalent métrique d'Arial), Liberation Mono et Archivo Black, embarquées — d'où un `main.js` d'environ 5 Mo. Les écritures non couvertes (CJK, arabe…) ne s'affichent pas.
- **Sommaire :** cliquable, mais sans points de conduite (pdfmake ne le permet pas).
- **Colonnes :** un groupe de colonnes n'est pas coupé entre deux pages.
- Dataview et les requêtes dynamiques ne sont pas rendus. Format A4 uniquement.

---

## Licence

Code : [MIT](LICENSE). Composants et polices embarqués : voir [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
