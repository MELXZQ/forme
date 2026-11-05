#!/bin/zsh
cd "${0:A:h}"
export PATH="$PWD/.tools/node/bin:$PATH"
if ! command -v node >/dev/null; then
  echo "Node.js 24 LTS is required. See README.md."
  read -k 1
  exit 1
fi
if [[ ! -d node_modules ]]; then
  npm ci || exit 1
fi
if [[ ! -f .env.local ]]; then
  echo "Private database configuration is missing. Follow the first-time setup in README.md. Existing data will not be reset."
  read -k 1
  exit 1
fi
npm run db:start || exit 1
npm run db:generate || exit 1
node --conditions=react-server --import tsx scripts/operations/expire.ts --watch &
forme_worker_pid=$!
trap 'kill "$forme_worker_pid" 2>/dev/null' EXIT
echo "FORME — Store: http://127.0.0.1:3000 / Admin: http://127.0.0.1:3000/admin"
echo "Press Control+C to stop the website and its reservation / notification worker. Stop the database separately with npm run db:stop."
npm run dev
