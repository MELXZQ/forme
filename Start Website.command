#!/bin/zsh
cd "${0:A:h}"
export PATH="$PWD/.tools/node/bin:$PATH"
if [[ ! -x .tools/node/bin/node ]]; then
  echo "Node.js is missing. See README.md."
  read -k 1
  exit 1
fi
echo "FORME — open http://127.0.0.1:3000 in your browser. Press Control+C to stop."
if [[ ! -d node_modules ]]; then
  npm install --cache .npm-cache || exit 1
fi
npm run dev
