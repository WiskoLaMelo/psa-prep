#!/bin/bash
# Lanceur Mac : installe ce qui manque, démarre PSA Prep et ouvre le navigateur.
# Usage : mac.sh [ordinateur|telephone]
MODE="${1:-ordinateur}"
cd "$(dirname "$0")/../.." || exit 1
clear
echo "=============================================="
echo "  PSA Prep"
echo "=============================================="
echo

node_ok() {
  command -v node >/dev/null 2>&1 && [ "$(node -p 'Number(process.versions.node.split(".")[0])')" -ge 20 ]
}

if ! node_ok; then
  echo "Node.js (le moteur qui fait tourner PSA Prep) n'est pas installé."
  echo "Je télécharge l'installateur officiel depuis nodejs.org…"
  PKG=$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | awk '/\.pkg$/ {print $2; exit}')
  if [ -z "$PKG" ]; then
    echo "Téléchargement impossible. Vérifie ta connexion Internet, puis relance ce fichier."
    read -r -p "Appuie sur Entrée pour fermer." _
    exit 1
  fi
  curl -fL "https://nodejs.org/dist/latest-v22.x/$PKG" -o "/tmp/$PKG" || exit 1
  open "/tmp/$PKG"
  echo
  echo "L'installateur de Node.js vient de s'ouvrir : clique sur « Continuer » jusqu'à « Installer »"
  echo "(ton mot de passe Mac te sera demandé), puis « Fermer »."
  read -r -p "Quand c'est fini, reviens ici et appuie sur Entrée. " _
  export PATH="/usr/local/bin:$PATH"
  if ! node_ok; then
    echo "Node.js n'est toujours pas détecté. Ferme cette fenêtre et relance le fichier."
    read -r -p "Appuie sur Entrée pour fermer." _
    exit 1
  fi
fi
echo "✓ Node.js $(node -v)"

if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.psa-prep-installed ]; then
  echo "Installation des composants de PSA Prep (une à deux minutes la première fois)…"
  if ! npm install --no-audit --no-fund; then
    echo
    echo "L'installation a échoué. Copie le texte ci-dessus et envoie-le à Claude."
    read -r -p "Appuie sur Entrée pour fermer." _
    exit 1
  fi
  touch node_modules/.psa-prep-installed
fi
echo "✓ Composants installés"
[ -f .env ] || cp .env.example .env

echo
if [ "$MODE" = "telephone" ]; then
  echo "Démarrage en mode téléphone. Un QR code va s'afficher : scanne-le avec le téléphone."
  echo "Pour arrêter PSA Prep : ferme cette fenêtre."
  echo
  npm run phone
else
  echo "Démarrage… le navigateur va s'ouvrir tout seul."
  echo "Laisse cette fenêtre ouverte pendant que tu utilises PSA Prep ; ferme-la pour l'arrêter."
  echo
  (
    for _ in $(seq 1 90); do
      if curl -fs -o /dev/null http://localhost:3000/api/config; then open "http://localhost:3000/"; exit 0; fi
      sleep 1
    done
  ) &
  npm run dev
fi
