import { network } from '../../js/network.js';

class CS2NetworkClient {
  constructor() {
    this._bound = false;
    this._handlers = new Map();
    this.room = null;
  }

  _ensureBound() {
    const sock = network.connect();
    if (!sock) return null;
    if (this._bound) return sock;
    this._bound = true;

    const events = [
      'cs2_room_update',
      'cs2_match_started',
      'cs2_player_left',
      'cs2_peer_state',
      'cs2_peer_shoot',
      'cs2_hit_event',
      'cs2_bomb_event',
      'cs2_host_sync'
    ];

    for (const evt of events) {
      sock.on(evt, (data) => {
        if (evt === 'cs2_room_update' && data) {
          this.room = data;
        } else if (evt === 'cs2_match_started' && data) {
          this.room = data;
        }
        const set = this._handlers.get(evt);
        if (set) {
          for (const fn of set) fn(data);
        }
      });
    }
    return sock;
  }

  on(evt, fn) {
    this._ensureBound();
    if (!this._handlers.has(evt)) this._handlers.set(evt, new Set());
    this._handlers.get(evt).add(fn);
    return () => this._handlers.get(evt)?.delete(fn);
  }

  getSocketId() {
    return network.getSocketId();
  }

  isHost() {
    const myId = this.getSocketId();
    return Boolean(this.room && myId && this.room.leaderId === myId);
  }

  createRoom(payload) {
    return new Promise((resolve) => {
      const sock = this._ensureBound();
      if (!sock || !network.connected) {
        resolve({ ok: false, error: 'Offline / server not connected.' });
        return;
      }
      sock.emit('cs2_create_room', payload, (res) => {
        if (res?.ok && res.room) this.room = res.room;
        resolve(res || { ok: false, error: 'Failed to create room.' });
      });
    });
  }

  joinRoom(code, payload) {
    return new Promise((resolve) => {
      const sock = this._ensureBound();
      if (!sock) {
        resolve({ ok: false, error: 'Offline / server not connected.' });
        return;
      }
      const sendJoin = () => {
        sock.emit('cs2_join_room', { code, ...payload }, (res) => {
          if (res?.ok && res.room) this.room = res.room;
          resolve(res || { ok: false, error: 'Failed to join room.' });
        });
      };
      if (network.connected) {
        sendJoin();
      } else {
        sock.once('connect', sendJoin);
        setTimeout(() => {
          if (!network.connected) resolve({ ok: false, error: 'Connection timed out.' });
        }, 4000);
      }
    });
  }

  leaveRoom() {
    this.room = null;
    const sock = this._ensureBound();
    if (sock && network.connected) {
      sock.emit('cs2_leave_room');
    }
  }

  setSettings(payload) {
    const sock = this._ensureBound();
    if (sock && network.connected && this.room) {
      sock.emit('cs2_set_settings', payload);
    }
  }

  switchTeam(team) {
    const sock = this._ensureBound();
    if (sock && network.connected && this.room) {
      sock.emit('cs2_switch_team', { team });
    }
  }

  startMatch(payload) {
    return new Promise((resolve) => {
      const sock = this._ensureBound();
      if (!sock || !network.connected || !this.room) {
        resolve({ ok: false, error: 'Not in a CS2 room.' });
        return;
      }
      sock.emit('cs2_start_match', payload, (res) => {
        if (res?.ok && res.room) this.room = res.room;
        resolve(res || { ok: false, error: 'Failed to start match.' });
      });
    });
  }

  returnToLobby() {
    const sock = this._ensureBound();
    if (sock && network.connected && this.room) {
      sock.emit('cs2_return_lobby');
    }
  }

  sendPlayerState(state) {
    const sock = this._ensureBound();
    if (sock && network.connected && this.room) {
      sock.emit('cs2_player_state', state);
    }
  }

  sendShoot(payload) {
    const sock = this._ensureBound();
    if (sock && network.connected && this.room) {
      sock.emit('cs2_shoot', payload);
    }
  }

  sendHit(payload) {
    const sock = this._ensureBound();
    if (sock && network.connected && this.room) {
      sock.emit('cs2_hit', payload);
    }
  }

  sendBombEvent(payload) {
    const sock = this._ensureBound();
    if (sock && network.connected && this.room) {
      sock.emit('cs2_bomb_event', payload);
    }
  }

  sendHostSync(payload) {
    const sock = this._ensureBound();
    if (sock && network.connected && this.room) {
      sock.emit('cs2_host_sync', payload);
    }
  }
}

export const cs2Network = new CS2NetworkClient();
