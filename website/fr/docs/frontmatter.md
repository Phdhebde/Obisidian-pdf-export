---
title: Frontmatter
description: Les clés de frontmatter lues par PDF Report Exporter pour remplir la page de garde, l'en-tête, la page de références et les métadonnées du PDF — en français ou en anglais — dont versions, contacts, destinataires et marquage TLP.
---

# Frontmatter

Les propriétés de la note remplissent la couverture, l'en-tête courant, la page de références et les métadonnées du PDF. Toutes les clés sont facultatives, et les clés françaises et anglaises sont comprises indifféremment.

```yaml
---
titre: Bilan de la migration du site   # couverture + en-tête (par défaut : le nom de la note)
client: ACME Corp                      # sous le titre, dans l'en-tête
sous_titre: Équipe infrastructure      # sous le titre de couverture
acronyme: INFRA                        # en grand, sous le sous-titre
auteur: Camille Martin                 # métadonnées du PDF
logo: logos/acme.png                   # logo de couverture (chemin du coffre ou [[lien]])
modele: Rapport                        # impose un modèle, sans passer par le choix
profil: Client                         # version restreinte exportée par défaut
sections: [cover, toc, body]           # remplace les sections du modèle pour cette note
tlp: AMBER                             # marquage Traffic Light Protocol facultatif
versions:                              # tableau « Statut du document »
  - version: "1.0"
    date: "08/06/2026"
    etat: "Création du document"
contacts:                              # tableau « Contacts »
  - nom: "Camille Martin"
    poste: "Cheffe de projet"
    courriel: "camille.martin@exemple.fr"
destinataires:                         # tableau « Destinataires » (facultatif)
  - nom: "Jean Dupont"
    societe: "ACME Corp"               # ou `poste:`, qui est prioritaire
    courriel: "jean.dupont@exemple.fr"
audience: internal                     # exclut toute la note des versions restreintes
---
```

## Clés

| Clé | Équivalent anglais | Sert à |
|---|---|---|
| `titre` | `title` | Titre de couverture, en-tête, titre du PDF, `{{title}}` dans les noms de fichier |
| `client` | `client` | En-tête, `{{client}}` dans les noms de fichier |
| `sous_titre` | `subtitle` | Sous le titre de couverture |
| `acronyme` | `acronym` | Texte en grand sous le sous-titre |
| `auteur` | `author` | Métadonnées du PDF |
| `logo` | `logo` | Logo de couverture, à la place de celui du modèle |
| `modele` | `template` | Modèle à utiliser, par nom ou identifiant |
| `profil` | `profile` | Profil d'export utilisé par l'export normal |
| `sections` | — | `cover`, `references`, `tlp`, `toc`, `body`, dans l'ordre |
| `tlp` | `tlp` | `RED`, `AMBER+STRICT`, `AMBER`, `GREEN`, `CLEAR` (`WHITE` est lu comme `CLEAR`) |
| `versions` | `versions` | Tableau d'état du document : `version`, `date`, `etat` (`status`) |
| `contacts` | `contacts` | Tableau des contacts : `nom` (`name`), `poste` (`role`), `courriel` (`email`) |
| `destinataires` | `recipients` | Tableau des destinataires : `nom`, `societe` (`company`) ou `poste`, `courriel` |
| `audience` | `audience` | Restreint toute la note — voir [Export confidentiel](confidential-export.md) |

## Comportements utiles

- **Destinataires** : le tableau n'apparaît que si la note nomme au moins un destinataire, ou si le modèle l'active. Une entrée dont tous les champs sont vides est ignorée : le bloc inséré par *Insérer le frontmatter de rapport* n'a donc aucun effet tant que vous ne le remplissez pas.
- **TLP** : sans clé `tlp`, rien n'est imprimé — sauf si le modèle inclut la page *Rappel TLP*, auquel cas le rapport est marqué `TLP:CLEAR`. Une valeur non reconnue (`tlp: rouge`) déclenche un avertissement au lieu d'être appliquée en silence.
- **Logo** : un `logo:` introuvable déclenche un avertissement plutôt que de revenir sans rien dire au logo du modèle.
- Les champs du frontmatter imprimés sur la couverture et la page de références ne sont **pas** filtrés par les profils d'export : n'y mettez pas d'informations confidentielles.
