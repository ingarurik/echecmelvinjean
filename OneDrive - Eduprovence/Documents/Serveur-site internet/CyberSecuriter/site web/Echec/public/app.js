// =====================================================
// CHESS ROYALE - app.js
// Gère index.html ET game.html (détecté via DOM)
// =====================================================

// --- UTILS ---
const $ = (id) => document.getElementById(id);
const show = (id) => $( id )?.classList.remove('hidden');
const hide = (id) => $( id )?.classList.add('hidden');

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array(6).fill(0).map(() => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function getWsUrl(code) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws/${code}`;
}

// =====================================================
// MODES DE JEU
// =====================================================
const MODES = {
  'all-queens': {
    name: '👑 Toutes Reines',
    initBoard() {
      const b = Array(8).fill(0).map(() => Array(8).fill(null));
      for (let c = 0; c < 8; c++) {
        b[0][c] = { color: 'black',  type: 'queen' };
        b[1][c] = { color: 'black',  type: 'queen' };
        b[6][c] = { color: 'white', type: 'queen' };
        b[7][c] = { color: 'white', type: 'queen' };
      }
      return b;
    },
    getMoves(board, row, col) {
      return getQueenMoves(board, row, col);
    },
    symbol(piece) {
      return piece.color === 'white' ? '♕' : '♛';
    },
    checkWin(board, mover) {
      const opp = mover === 'white' ? 'black' : 'white';
      for (let r = 0; r < 8; r++)
        for (let c = 0; c < 8; c++)
          if (board[r][c]?.color === opp) return null;
      return mover;
    }
  }
  // Ajouter de nouveaux modes ici !
};

// =====================================================
// LOGIQUE CHESS - Mouvement Reine
// =====================================================
function getQueenMoves(board, row, col) {
  const piece = board[row][col];
  if (!piece) return [];
  const moves = [];
  const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
  for (const [dr, dc] of dirs) {
    let r = row + dr, c = col + dc;
    while (r >= 0 && r < 8 && c >= 0 && c < 8) {
      if (!board[r][c]) {
        moves.push([r, c]);
      } else {
        if (board[r][c].color !== piece.color) moves.push([r, c]); // capture
        break; // bloqué
      }
      r += dr; c += dc;
    }
  }
  return moves;
}

// =====================================================
// ÉTAT DU JEU
// =====================================================
let board        = null;
let selectedCell = null;
let validMoves   = [];
let myColor      = null;
let currentTurn  = 'white';
let gameMode     = null;
let ws           = null;
let gameActive   = false;
let gameEnded    = false;

// =====================================================
// RENDU DU PLATEAU
// =====================================================
function renderBoard() {
  const boardEl = $('board');
  if (!boardEl || !board) return;
  boardEl.innerHTML = '';

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = document.createElement('div');
      const isLight = (r + c) % 2 === 0;
      cell.className = 'cell ' + (isLight ? 'light' : 'dark');
      cell.dataset.r = r;
      cell.dataset.c = c;

      // Surlignage sélection
      if (selectedCell && selectedCell[0] === r && selectedCell[1] === c) {
        cell.classList.add('selected');
      }

      // Surlignage coups valides
      const isValid = validMoves.some(([vr, vc]) => vr === r && vc === c);
      if (isValid) {
        cell.classList.add(board[r][c] ? 'capture-move' : 'valid-move');
      }

      // Affichage pièce
      const piece = board[r][c];
      if (piece) {
        const pieceEl = document.createElement('span');
        pieceEl.className = 'piece ' + piece.color;
        pieceEl.textContent = MODES[gameMode].symbol(piece);
        cell.appendChild(pieceEl);
      }

      cell.addEventListener('click', () => handleCellClick(r, c));
      boardEl.appendChild(cell);
    }
  }

  updatePieceCounts();
}

function updatePieceCounts() {
  let white = 0, black = 0;
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      if (board[r][c]?.color === 'white') white++;
      if (board[r][c]?.color === 'black') black++;
    }
  const myCount  = myColor === 'white' ? white : black;
  const oppCount = myColor === 'white' ? black  : white;
  $('self-count').textContent     = myCount  + ' ♛';
  $('opponent-count').textContent = oppCount + ' ♛';
}

// =====================================================
// GESTION DES CLICS SUR LE PLATEAU
// =====================================================
function handleCellClick(r, c) {
  if (!gameActive || currentTurn !== myColor) return;

  // Si un coup valide est cliqué → jouer
  if (selectedCell) {
    const isValid = validMoves.some(([vr, vc]) => vr === r && vc === c);
    if (isValid) {
      executeMove(selectedCell[0], selectedCell[1], r, c);
      return;
    }
  }

  // Sélectionner une pièce
  const piece = board[r][c];
  if (piece && piece.color === myColor) {
    selectedCell = [r, c];
    validMoves   = MODES[gameMode].getMoves(board, r, c);
  } else {
    selectedCell = null;
    validMoves   = [];
  }
  renderBoard();
}

// =====================================================
// EXÉCUTER UN COUP
// mover : 'white'|'black' si vient du serveur, sinon undefined (coup local)
// =====================================================
function executeMove(fr, fc, tr, tc, mover) {
  const isLocal = mover === undefined;
  if (isLocal) mover = myColor;

  // Déplacer la pièce
  board[tr][tc] = board[fr][fc];
  board[fr][fc] = null;

  // Vérifier victoire
  const winner = MODES[gameMode].checkWin(board, mover);

  selectedCell = null;
  validMoves   = [];
  currentTurn  = currentTurn === 'white' ? 'black' : 'white';

  renderBoard();
  updateStatus();

  if (winner) {
    if (isLocal) {
      // On prévient le serveur (qui broadcastera à l'adversaire)
      ws.send(JSON.stringify({ type: 'game-over', winner }));
    }
    showGameOver(winner);
  } else if (isLocal) {
    // Envoyer le coup à l'adversaire via le serveur
    ws.send(JSON.stringify({ type: 'move', from: [fr, fc], to: [tr, tc] }));
  }
}

function updateStatus() {
  const el = $('status-bar');
  if (!el) return;
  if (currentTurn === myColor) {
    el.textContent = '🟢 À toi de jouer !';
    el.className = 'status-bar my-turn';
  } else {
    el.textContent = "⏳ Tour de l'adversaire...";
    el.className = 'status-bar opp-turn';
  }
}

function showGameOver(winner) {
  if (gameEnded) return;
  gameEnded   = true;
  gameActive  = false;

  if (winner === myColor) {
    $('modal-icon').textContent    = '🏆';
    $('modal-title').textContent   = 'Victoire !';
    $('modal-message').textContent = 'Tu as éliminé toutes les pièces adverses !';
  } else {
    $('modal-icon').textContent    = '💀';
    $('modal-title').textContent   = 'Défaite...';
    $('modal-message').textContent = 'Toutes tes pièces ont été éliminées.';
  }
  show('game-over-modal');
}

// =====================================================
// WEBSOCKET
// =====================================================
function connectWS(code, mode) {
  ws = new WebSocket(getWsUrl(code));

  ws.onopen = () => {
    // Le créateur (celui qui a le mode dans l'URL) envoie l'init
    if (mode) {
      ws.send(JSON.stringify({ type: 'init', mode }));
    }
  };

  ws.onmessage = (ev) => {
    try {
      handleWsMsg(JSON.parse(ev.data));
    } catch(e) {
      console.error('WS parse error:', e);
    }
  };

  ws.onclose = () => {
    if (gameActive && !gameEnded) {
      const el = $('status-bar');
      if (el) { el.textContent = '❌ Connexion perdue'; el.className = 'status-bar'; }
    }
  };

  ws.onerror = () => {
    const el = $('status-bar');
    if (el) { el.textContent = '❌ Erreur de connexion'; el.className = 'status-bar'; }
  };
}

function handleWsMsg(msg) {
  switch (msg.type) {

    case 'assigned':
      // Le serveur nous assigne blanc ou noir
      myColor = msg.player;
      // Mettre à jour les points de couleur dans l'UI
      const selfDot = $('self-dot');
      const oppDot  = $('opponent-dot');
      if (selfDot) selfDot.className = 'player-dot ' + (myColor === 'white' ? 'dot-white' : 'dot-black');
      if (oppDot)  oppDot.className  = 'player-dot ' + (myColor === 'white' ? 'dot-black' : 'dot-white');
      break;

    case 'game-start':
      // Les deux joueurs sont connectés → lancer la partie
      gameMode = msg.mode;
      board    = MODES[gameMode].initBoard();

      const modeBadge = $('mode-badge');
      if (modeBadge) modeBadge.textContent = MODES[gameMode].name;

      gameActive  = true;
      gameEnded   = false;
      currentTurn = 'white';

      hide('waiting-overlay');
      renderBoard();
      updateStatus();
      break;

    case 'move':
      // Coup de l'adversaire
      if (msg.player !== myColor) {
        executeMove(msg.from[0], msg.from[1], msg.to[0], msg.to[1], msg.player);
      }
      break;

    case 'game-over':
      showGameOver(msg.winner);
      break;

    case 'opponent-disconnected':
      if (!gameEnded) {
        const el = $('status-bar');
        if (el) { el.textContent = '❌ Adversaire déconnecté'; el.className = 'status-bar'; }
        gameActive = false;
      }
      break;

    case 'error':
      const el = $('status-bar');
      if (el) { el.textContent = '❌ ' + msg.message; el.className = 'status-bar'; }
      break;
  }
}

// =====================================================
// PAGE INDEX
// =====================================================
function initIndexPage() {
  let selectedMode = 'all-queens';

  // Sélection du mode
  document.querySelectorAll('.mode-card:not(.disabled)').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedMode = card.dataset.mode;
    });
  });

  // Créer une partie → générer code et aller sur game.html
  $('create-btn').addEventListener('click', () => {
    const code = generateCode();
    window.location.href = `/game.html?code=${code}&mode=${selectedMode}`;
  });

  // Rejoindre une partie → afficher le champ de saisie
  $('join-btn').addEventListener('click', () => {
    hide('action-section');
    show('join-section');
    setTimeout(() => $('join-code-input')?.focus(), 100);
  });

  // Confirmer le code saisi
  $('confirm-join-btn').addEventListener('click', () => {
    const code = $('join-code-input').value.trim().toUpperCase();
    if (code.length < 4) {
      show('join-error');
      return;
    }
    window.location.href = `/game.html?code=${code}`;
  });

  // Entrée clavier
  $('join-code-input').addEventListener('keydown', (e) => {
    hide('join-error');
    if (e.key === 'Enter') $('confirm-join-btn').click();
  });

  // Mettre en majuscules automatiquement
  $('join-code-input').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase();
  });

  // Retour
  $('cancel-join-btn').addEventListener('click', () => {
    hide('join-section');
    show('action-section');
  });
}

// =====================================================
// PAGE DE JEU
// =====================================================
function initGamePage() {
  const params   = new URLSearchParams(location.search);
  const code     = params.get('code')?.toUpperCase();
  const modeParam = params.get('mode'); // seulement défini pour le créateur

  // Vérification code
  if (!code || code.length < 4) {
    window.location.href = '/';
    return;
  }

  // Afficher le code dans le header
  const codeHeader = $('room-code-header');
  if (codeHeader) codeHeader.textContent = code;

  // Afficher le code dans l'overlay d'attente
  const waitingCode = $('waiting-code');
  if (waitingCode) waitingCode.textContent = code;

  // Bouton copier le code
  $('copy-waiting-btn')?.addEventListener('click', () => {
    navigator.clipboard.writeText(code).then(() => {
      const btn = $('copy-waiting-btn');
      if (btn) { btn.textContent = '✅ Copié !'; setTimeout(() => { btn.textContent = '📋 Copier le code'; }, 2000); }
    });
  });

  // Connexion WebSocket
  connectWS(code, modeParam);
}

// =====================================================
// POINT D'ENTRÉE
// =====================================================
if ($('board')) {
  initGamePage();
} else {
  initIndexPage();
}
