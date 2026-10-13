import json
import sys

with open('fr.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

# Find where noticeFormFailed is
found = False
for key in data:
    if isinstance(data[key], dict):
        if 'noticeFormFailed' in data[key]:
            print(f"Found noticeFormFailed in namespace: {key}", file=sys.stderr)
            # Add the new keys to that namespace
            data[key]['noticeFormSent'] = 'Formulaire envoyé à {queued} destinataires.'
            data[key]['noticeFormPosted'] = 'Formulaire publié sur {published} canaux.'
            data[key]['noticeFormNoAudience'] = "L'envoi nécessite une audience — ajoutez des destinataires ou sélectionnez une audience marketing."
            data[key]['noticeFormBlocked'] = 'Impossible d\'envoyer: {blockers}. Corrigez-les avant de réessayer.'
            data[key]['sendFailed'] = 'Le formulaire n\'a pas pu être envoyé.'
            data[key]['postFailed'] = 'Le formulaire n\'a pas pu être publié.'
            found = True

if found:
    with open('fr.json', 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=4)
    print("Keys added successfully")
else:
    print("noticeFormFailed not found!", file=sys.stderr)
