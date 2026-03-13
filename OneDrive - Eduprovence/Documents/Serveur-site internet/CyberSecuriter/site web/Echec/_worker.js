// =====================================================
// CHESS ROYALE - _worker.js
// Cloudflare Worker + Durable Objects
// Gère les WebSockets pour le multijoueur
// =====================================================

// --- Durable Object : une salle de jeu par code ---
export class GameRoom {
  constructor(state, env) {
    this.state      = state;
    this.sessions   = new Map(); // ws -> { player: 'white'|'black' }
    this.mode       = null;
    this.gameStarted = false;
  }

  async fetch(request) {
    // On n'accepte que les connexions WebSocket
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('WebSocket attendu', { status: 426 });
    }

    // Maximum 2 joueurs par salle
    if (this.sessions.size >= 2) {
      return new Response('Salle pleine', { status: 403 });
    }

    // Créer la paire WebSocket
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    this.handleSession(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  handleSession(ws) {
    // Assigner la couleur : 1er joueur = blanc, 2ème = noir
    const player = this.sessions.size === 0 ? 'white' : 'black';
    this.sessions.set(ws, { player });

    // Informer le joueur de sa couleur
    this.send(ws, { type: 'assigned', player });

    // Écouter les messages de ce joueur
    ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        this.handleMessage(ws, msg);
      } catch (e) {
        console.error('Erreur parsing message:', e);
      }
    });

    // Déconnexion
    ws.addEventListener('close', () => {
      this.sessions.delete(ws);
      // Prévenir l'adversaire
      this.broadcast({ type: 'opponent-disconnected' });
    });

    ws.addEventListener('error', () => {
      this.sessions.delete(ws);
      this.broadcast({ type: 'opponent-disconnected' });
    });

    // Si 2 joueurs connectés → potentiellement démarrer
    if (this.sessions.size === 2) {
      this.tryStartGame();
    }
  }

  handleMessage(ws, msg) {
    const session = this.sessions.get(ws);
    if (!session) return;

    switch (msg.type) {
      case 'init':
        // Le créateur envoie le mode de jeu
        if (!this.mode && msg.mode) {
          this.mode = msg.mode;
          // Si le 2ème joueur est déjà là, démarrer maintenant
          if (this.sessions.size === 2 && !this.gameStarted) {
            this.tryStartGame();
          }
        }
        break;

      case 'move':
        // Relayer le coup aux deux joueurs (pour synchroniser les deux boards)
        this.broadcast({
          type:   'move',
          from:   msg.from,
          to:     msg.to,
          player: session.player,
        });
        break;

      case 'game-over':
        // Relayer la fin de partie
        this.broadcast({
          type:   'game-over',
          winner: msg.winner,
        });
        break;
    }
  }

  tryStartGame() {
    if (this.gameStarted) return;
    if (this.sessions.size < 2) return;
    if (!this.mode) return; // On attend que le créateur envoie le mode

    this.gameStarted = true;
    this.broadcast({
      type: 'game-start',
      mode: this.mode,
    });
  }

  send(ws, data) {
    try {
      ws.send(JSON.stringify(data));
    } catch (e) {}
  }

  broadcast(data) {
    const msg = JSON.stringify(data);
    for (const [ws] of this.sessions) {
      try { ws.send(msg); } catch (e) {}
    }
  }
}

// --- Worker principal ---
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Route WebSocket : /ws/<CODE>
    if (url.pathname.startsWith('/ws/')) {
      const code = url.pathname.slice(4).toUpperCase().trim();
      if (!code || code.length < 4) {
        return new Response('Code invalide', { status: 400 });
      }

      // Obtenir ou créer le Durable Object pour cette salle
      const id   = env.GAME_ROOM.idFromName(code);
      const room = env.GAME_ROOM.get(id);
      return room.fetch(request);
    }

    // Tout le reste → fichiers statiques (index.html, game.html, etc.)
    return env.ASSETS.fetch(request);
  }
};
