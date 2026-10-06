# Χρήση του visual-explainer

Το [visual-explainer](../.agents/skills/visual-explainer/SKILL.md) είναι skill
του project στη διαδρομή `.agents/skills/visual-explainer/`. Παράγει HTML
σελίδες με διαγράμματα, οπτικές ανασκοπήσεις και πλάνα. Η βασική χρήση
χρειάζεται μόνο browser για προβολή, χωρίς build ή εγκατάσταση MCP,
PowerPoint/PPTX ή video εργαλείων. Ο renderer διαδραστικών πλάνων χρησιμοποιεί
το υπάρχον Node.js του project και δεν χρειάζεται πρόσθετα packages.

Στο Codex, ξεκινήστε μια νέα συνεδρία μέσα στο repository ώστε να εντοπιστεί
το skill και καλέστε το με `$visual-explainer`, ή ζητήστε ρητά τη χρήση του.
Τα prompts του upstream παραμένουν στον φάκελο
[`commands/`](../.agents/skills/visual-explainer/commands/): η αντιγραφή του
skill δεν καταχωρίζει αυτόματα slash commands. Μπορείτε να ζητήσετε από τον
agent να διαβάσει το αντίστοιχο prompt ως οδηγό, όπως στα παραδείγματα παρακάτω.

Το upstream προεπιλέγει `~/.agent/diagrams/`. Τα παραδείγματα ζητούν ρητά
προσωρινά αρχεία στο `/tmp/matter-stats-visuals/`· αλλάξτε τη διαδρομή για να
τα διατηρήσετε. Ανοίξτε το HTML στον browser, αν το περιβάλλον δεν το ανοίξει
αυτόματα. Fonts ή προαιρετικές βιβλιοθήκες από CDN μπορεί να χρειάζονται δίκτυο.

## Project recap

```text
$visual-explainer Διάβασε το .agents/skills/visual-explainer/commands/project-recap.md
και φτιάξε στα ελληνικά μια οπτική ανασκόπηση του Matter Stats για τις τελευταίες
δύο εβδομάδες. Δείξε την αρχιτεκτονική, τις πρόσφατες αλλαγές, την τρέχουσα
κατάσταση και τα επόμενα βήματα. Τεκμηρίωσε τα συμπεράσματα με αρχεία και commits.
Αποθήκευσε το HTML στο /tmp/matter-stats-visuals/project-recap.html.
```

## PR review

```text
$visual-explainer Διάβασε το .agents/skills/visual-explainer/commands/diff-review.md
και κάνε στα ελληνικά οπτικό review του PR <URL του PR>. Σύγκρινε τη συμπεριφορά
πριν και μετά, δείξε τα επηρεαζόμενα αρχεία, τους κινδύνους και την κάλυψη ελέγχων.
Σύνδεσε κάθε εύρημα με συγκεκριμένο αρχείο και γραμμή. Αποθήκευσε το HTML στο
/tmp/matter-stats-visuals/pr-review.html.
```

Αν δεν υπάρχει PR, ορίστε ως πεδίο σύγκρισης το `origin/main...HEAD`.

## Παρουσίαση action plan

```text
$visual-explainer Διάβασε το .agents/skills/visual-explainer/commands/generate-visual-plan.md
και παρουσίασε στα ελληνικά ένα διαδραστικό action plan βάσει του
docs/stabilization-plan.md και του τρέχοντος κώδικα. Δείξε προτεραιότητες,
εξαρτήσεις, αποφάσεις, κινδύνους και κριτήρια ολοκλήρωσης. Ξεχώρισε όσα
επιβεβαιώνονται από τον κώδικα από τις υποθέσεις. Παρουσίασε μόνο το πλάνο.
Αποθήκευσε το τελικό HTML στο /tmp/matter-stats-visuals/action-plan.html.
```

## Προέλευση και συνοδευτικά αρχεία

Το αντίγραφο προέρχεται από το upstream commit
[`a0ece8a01dbd1e96533ed3acc372d012dbcc552b`](https://github.com/nicobailon/visual-explainer/commit/a0ece8a01dbd1e96533ed3acc372d012dbcc552b).
Η [καταγραφή προέλευσης](../.agents/skills/visual-explainer/UPSTREAM.md) περιγράφει
την εγκατάσταση, και το [LICENSE](../.agents/skills/visual-explainer/LICENSE)
διατηρεί την πλήρη άδεια MIT και το copyright του δημιουργού.

Περιλαμβάνονται όλα τα upstream `references/`, `templates/`, `commands/`,
οι renderers και τα υπόλοιπα συνοδευτικά αρχεία. Η ενότητα «Older recipes
(optional)» του `SKILL.md` παραπέμπει ρητά σε εξωτερικά παραδείγματα του tag
`v0.11.0`, μεταξύ τους το `templates/mermaid-flowchart.html`. Αυτά δεν ανήκουν
στον τρέχοντα upstream φάκελο και ανακτώνται μόνο όταν χρειάζονται.
