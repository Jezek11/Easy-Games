class NetworkClient {
  constructor() {
    this.socket = null;
    this.connected = false;
    this.pingMs = 0;
    this.pingTimer = null;
    this.handlers = new Map();
    this.roomCode = null;
    this.slot = 0;
    this.portalStats = { online: 1, activeRooms: 0, queued: 0 };
  }

  connect() {
    if (this.socket) return this.socket;
    if (typeof window.io !== 'function') {
      console.warn('Socket.io client failed to load.');
      return null;
    }

    this.socket = window.io({
      transports: ['websocket', 'polling'],
      reconnectionDelay: 1000,
      reconnectionAttempts: 10
    });

    this.socket.on('connect', () => {
      this.connected = true;
      this.emitLocal('connection_change', { connected: true, id: this.socket.id });
      this.measurePing();
    });

    this.socket.on('disconnect', () => {
      this.connected = false;
      this.emitLocal('connection_change', { connected: false, id: null });
    });

    const forwardedEvents = [
      'portal_stats',
      'player_joined',
      'match_found',
      'opponent_left',
      'opponent_cosmetics',
      'match_material_update',
      'opponent_update',
      'build_placed',
      'build_edited',
      'build_destroyed',
      'build_damaged',
      'opponent_shoot',
      'health_update',
      'player_eliminated',
      'player_respawn',
      'vramp_next_round',
      'round_restart',
      'arena_reset_done'
    ];

    for (const evt of forwardedEvents) {
      this.socket.on(evt, (data) => {
        if (evt === 'portal_stats' && data) {
          this.portalStats = data;
        } else if (evt === 'match_found' && data) {
          this.roomCode = data.code || this.roomCode;
          if (typeof data.slot === 'number') {
            this.slot = data.slot;
          }
        }
        this.emitLocal(evt, data);
      });
    }

    if (!this.pingTimer) {
      this.pingTimer = window.setInterval(() => this.measurePing(), 2200);
    }

    return this.socket;
  }

  measurePing() {
    if (!this.socket || !this.connected) return;
    const sent = performance.now();
    this.socket.emit('ping_check', sent, (echoTs) => {
      const rtt = Math.max(1, Math.round(performance.now() - (typeof echoTs === 'number' ? echoTs : sent)));
      this.pingMs = rtt;
      this.emitLocal('ping_update', rtt);
    });
  }

  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event).add(fn);
    return () => this.handlers.get(event)?.delete(fn);
  }

  emitLocal(event, data) {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const fn of set) fn(data);
  }

  getSocketId() {
    return this.socket?.id || null;
  }

  createPrivateRoom(profile) {
    return new Promise((resolve) => {
      const sock = this.connect();
      if (!sock || !this.connected) {
        resolve({ ok: false, error: 'Not connected to server.' });
        return;
      }
      sock.emit('create_private_room', profile, (res) => {
        if (res?.ok) {
          this.roomCode = res.code;
          this.slot = res.slot;
        }
        resolve(res || { ok: false, error: 'Unknown server error.' });
      });
    });
  }

  joinPrivateRoom(code, profile) {
    return new Promise((resolve) => {
      const sock = this.connect();
      if (!sock) {
        resolve({ ok: false, error: 'No server connection.' });
        return;
      }
      const doEmit = () => {
        sock.emit('join_private_room', { code, ...profile }, (res) => {
          if (res?.ok) {
            this.roomCode = res.code;
            this.slot = res.slot;
          }
          resolve(res || { ok: false, error: 'Failed to join room.' });
        });
      };
      if (this.connected) {
        doEmit();
      } else {
        sock.once('connect', doEmit);
        setTimeout(() => {
          if (!this.connected) resolve({ ok: false, error: 'Server connection timed out.' });
        }, 4000);
      }
    });
  }

  joinMatchmaking(profile) {
    return new Promise((resolve) => {
      const sock = this.connect();
      if (!sock || !this.connected) {
        resolve({ ok: false, error: 'Online server is unavailable.' });
        return;
      }
      sock.emit('join_matchmaking', profile, (res) => {
        if (res?.matched) {
          this.roomCode = res.code;
          this.slot = res.slot;
        }
        resolve(res || { ok: false, error: 'Matchmaking error.' });
      });
    });
  }

  cancelMatchmaking() {
    if (this.socket && this.connected) {
      this.socket.emit('cancel_matchmaking');
    }
  }

  leaveRoom() {
    this.roomCode = null;
    if (this.socket && this.connected) {
      this.socket.emit('leave_room');
    }
  }

  sendCosmetics(profile) {
    if (this.socket && this.connected && this.roomCode) {
      this.socket.emit('cosmetics_update', profile);
    }
  }

  sendPlayerState(state) {
    if (this.socket && this.connected && this.roomCode) {
      this.socket.emit('player_update', state);
    }
  }

  sendBuildPlace(buildData, ack) {
    if (this.socket && this.connected && this.roomCode) {
      this.socket.emit('build_place', buildData, ack);
    }
  }

  sendBuildEdit(payload) {
    if (this.socket && this.connected && this.roomCode) {
      this.socket.emit('build_edit', payload);
    }
  }

  sendBuildDamage(payload) {
    if (this.socket && this.connected && this.roomCode) {
      this.socket.emit('build_damage', payload);
    }
  }

  sendShootFx(payload) {
    if (this.socket && this.connected && this.roomCode) {
      this.socket.emit('shoot_fx', payload);
    }
  }

  sendPlayerHit(payload) {
    if (this.socket && this.connected && this.roomCode) {
      this.socket.emit('player_hit', payload);
    }
  }

  sendPlayerFell() {
    if (this.socket && this.connected && this.roomCode) {
      this.socket.emit('player_fell');
    }
  }

  sendArenaReset() {
    if (this.socket && this.connected && this.roomCode) {
      this.socket.emit('arena_reset');
    }
  }
}

export const network = new NetworkClient();
