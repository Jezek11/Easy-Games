const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCS2Code(rooms) {
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += CODE_ALPHABET[(Math.random() * CODE_ALPHABET.length) | 0];
    }
    if (!rooms.has(code)) return code;
  }
  return String(Date.now()).slice(-4);
}

function normalizeCode(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/^#/, '')
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}

function sanitizeName(raw, fallback = 'Operator') {
  const s = String(raw || '').trim().slice(0, 18);
  return s || fallback;
}

function getTeamCap(mode) {
  return mode === 'wingman' ? 2 : 5;
}

function pickBalancedTeam(room, preferredTeam) {
  const cap = getTeamCap(room.mode);
  let ctCount = 0;
  let tCount = 0;
  for (const p of room.players.values()) {
    if (p.team === 'ct') ctCount++;
    else tCount++;
  }
  if (preferredTeam === 'ct' && ctCount < cap) return 'ct';
  if (preferredTeam === 't' && tCount < cap) return 't';
  if (ctCount <= tCount && ctCount < cap) return 'ct';
  if (tCount < cap) return 't';
  return ctCount <= tCount ? 'ct' : 't';
}

function serializeRoom(room) {
  return {
    code: room.code,
    leaderId: room.leaderId,
    mode: room.mode,
    fillBots: room.fillBots,
    botDifficulty: room.botDifficulty,
    state: room.state,
    players: Array.from(room.players.values())
  };
}

function registerCS2Handlers(io) {
  const cs2Rooms = new Map(); // code -> Room
  const cs2SocketToRoom = new Map(); // socketId -> code

  function leaveCS2Room(socket) {
    const code = cs2SocketToRoom.get(socket.id);
    if (!code) return;
    cs2SocketToRoom.delete(socket.id);
    socket.leave(`cs2:${code}`);

    const room = cs2Rooms.get(code);
    if (!room) return;
    const leaving = room.players.get(socket.id);
    room.players.delete(socket.id);

    if (room.players.size === 0) {
      cs2Rooms.delete(code);
      return;
    }

    if (room.leaderId === socket.id) {
      const [nextId] = room.players.keys();
      room.leaderId = nextId;
    }

    io.to(`cs2:${code}`).emit('cs2_player_left', {
      id: socket.id,
      name: leaving?.name || 'Operator'
    });
    io.to(`cs2:${code}`).emit('cs2_room_update', serializeRoom(room));
  }

  io.on('connection', (socket) => {
    socket.on('cs2_create_room', (payload, ack) => {
      leaveCS2Room(socket);
      const code = generateCS2Code(cs2Rooms);
      const mode = payload?.mode === 'wingman' ? 'wingman' : 'competitive';
      const fillBots = payload?.fillBots !== false;
      const botDifficulty = ['easy', 'medium', 'hard', 'extreme'].includes(payload?.botDifficulty)
        ? payload.botDifficulty
        : 'medium';
      const team = payload?.team === 't' ? 't' : 'ct';

      const player = {
        id: socket.id,
        name: sanitizeName(payload?.name, 'Operator'),
        team,
        slot: 0
      };

      const room = {
        code,
        leaderId: socket.id,
        mode,
        fillBots,
        botDifficulty,
        state: 'lobby',
        players: new Map([[socket.id, player]]),
        createdAt: Date.now()
      };

      cs2Rooms.set(code, room);
      cs2SocketToRoom.set(socket.id, code);
      socket.join(`cs2:${code}`);

      if (typeof ack === 'function') {
        ack({ ok: true, room: serializeRoom(room), myId: socket.id });
      }
    });

    socket.on('cs2_join_room', (payload, ack) => {
      const code = normalizeCode(payload?.code);
      if (!code || !cs2Rooms.has(code)) {
        if (typeof ack === 'function') {
          ack({ ok: false, error: `CS2 room #${code || '????'} not found.` });
        }
        return;
      }

      const room = cs2Rooms.get(code);
      const maxPlayers = getTeamCap(room.mode) * 2;
      if (room.players.size >= maxPlayers && !room.players.has(socket.id)) {
        if (typeof ack === 'function') {
          ack({ ok: false, error: `CS2 room #${code} is full (${maxPlayers}/${maxPlayers}).` });
        }
        return;
      }

      if (cs2SocketToRoom.get(socket.id) !== code) {
        leaveCS2Room(socket);
      }

      const team = pickBalancedTeam(room, payload?.team);
      const player = {
        id: socket.id,
        name: sanitizeName(payload?.name, `Operator ${room.players.size + 1}`),
        team,
        slot: room.players.size
      };

      room.players.set(socket.id, player);
      cs2SocketToRoom.set(socket.id, code);
      socket.join(`cs2:${code}`);

      const snapshot = serializeRoom(room);
      io.to(`cs2:${code}`).emit('cs2_room_update', snapshot);

      if (typeof ack === 'function') {
        ack({ ok: true, room: snapshot, myId: socket.id });
      }
    });

    socket.on('cs2_leave_room', () => {
      leaveCS2Room(socket);
    });

    socket.on('cs2_set_settings', (payload) => {
      const code = cs2SocketToRoom.get(socket.id);
      if (!code) return;
      const room = cs2Rooms.get(code);
      if (!room || room.leaderId !== socket.id) return;

      if (payload?.mode === 'wingman' || payload?.mode === 'competitive') {
        room.mode = payload.mode;
      }
      if (typeof payload?.fillBots === 'boolean') {
        room.fillBots = payload.fillBots;
      }
      if (['easy', 'medium', 'hard', 'extreme'].includes(payload?.botDifficulty)) {
        room.botDifficulty = payload.botDifficulty;
      }
      io.to(`cs2:${code}`).emit('cs2_room_update', serializeRoom(room));
    });

    socket.on('cs2_switch_team', (payload) => {
      const code = cs2SocketToRoom.get(socket.id);
      if (!code) return;
      const room = cs2Rooms.get(code);
      if (!room || room.state !== 'lobby') return;
      const player = room.players.get(socket.id);
      if (!player) return;

      const targetTeam = payload?.team === 't' ? 't' : (payload?.team === 'ct' ? 'ct' : (player.team === 'ct' ? 't' : 'ct'));
      const cap = getTeamCap(room.mode);
      let count = 0;
      for (const p of room.players.values()) {
        if (p.id !== socket.id && p.team === targetTeam) count++;
      }
      if (count < cap) {
        player.team = targetTeam;
        io.to(`cs2:${code}`).emit('cs2_room_update', serializeRoom(room));
      }
    });

    socket.on('cs2_start_match', (payload, ack) => {
      const code = cs2SocketToRoom.get(socket.id);
      if (!code) {
        if (typeof ack === 'function') ack({ ok: false, error: 'Not in a CS2 room.' });
        return;
      }
      const room = cs2Rooms.get(code);
      if (!room) {
        if (typeof ack === 'function') ack({ ok: false, error: 'CS2 room missing.' });
        return;
      }
      if (room.leaderId !== socket.id) {
        if (typeof ack === 'function') ack({ ok: false, error: 'Only the host can start the match.' });
        return;
      }
      if (payload?.mode === 'wingman' || payload?.mode === 'competitive') {
        room.mode = payload.mode;
      }
      if (typeof payload?.fillBots === 'boolean') {
        room.fillBots = payload.fillBots;
      }
      if (['easy', 'medium', 'hard', 'extreme'].includes(payload?.botDifficulty)) {
        room.botDifficulty = payload.botDifficulty;
      }

      room.state = 'playing';
      const snapshot = serializeRoom(room);
      io.to(`cs2:${code}`).emit('cs2_match_started', snapshot);
      if (typeof ack === 'function') ack({ ok: true, room: snapshot });
    });

    socket.on('cs2_return_lobby', () => {
      const code = cs2SocketToRoom.get(socket.id);
      if (!code) return;
      const room = cs2Rooms.get(code);
      if (!room || room.leaderId !== socket.id) return;
      room.state = 'lobby';
      io.to(`cs2:${code}`).emit('cs2_room_update', serializeRoom(room));
    });

    socket.on('cs2_player_state', (state) => {
      const code = cs2SocketToRoom.get(socket.id);
      if (!code || !state) return;
      socket.to(`cs2:${code}`).emit('cs2_peer_state', {
        id: socket.id,
        x: Number(state.x) || 0,
        y: Number(state.y) || 0,
        z: Number(state.z) || 0,
        yaw: Number(state.yaw) || 0,
        pitch: Number(state.pitch) || 0,
        crouch: Boolean(state.crouch),
        weaponId: typeof state.weaponId === 'string' ? state.weaponId : 'pistol',
        hp: Math.max(0, Math.min(100, Number(state.hp) || 0)),
        alive: Boolean(state.alive),
        team: state.team === 't' ? 't' : 'ct',
        speed: Number(state.speed) || 0
      });
    });

    socket.on('cs2_shoot', (payload) => {
      const code = cs2SocketToRoom.get(socket.id);
      if (!code || !payload) return;
      socket.to(`cs2:${code}`).emit('cs2_peer_shoot', {
        id: socket.id,
        weaponId: String(payload.weaponId || 'ak47'),
        ox: Number(payload.ox) || 0,
        oy: Number(payload.oy) || 0,
        oz: Number(payload.oz) || 0,
        hx: Number(payload.hx) || 0,
        hy: Number(payload.hy) || 0,
        hz: Number(payload.hz) || 0,
        hitWall: Boolean(payload.hitWall),
        nx: Number(payload.nx) || 0,
        ny: Number(payload.ny) || 1,
        nz: Number(payload.nz) || 0
      });
    });

    socket.on('cs2_hit', (payload) => {
      const code = cs2SocketToRoom.get(socket.id);
      if (!code || !payload) return;
      io.to(`cs2:${code}`).emit('cs2_hit_event', {
        attackerId: payload.attackerId || socket.id,
        targetId: String(payload.targetId || ''),
        damage: Math.max(0, Math.min(450, Number(payload.damage) || 0)),
        hitZone: payload.hitZone === 'head' ? 'head' : (payload.hitZone === 'legs' ? 'legs' : 'body'),
        weaponId: String(payload.weaponId || 'ak47')
      });
    });

    socket.on('cs2_bomb_event', (payload) => {
      const code = cs2SocketToRoom.get(socket.id);
      if (!code || !payload) return;
      io.to(`cs2:${code}`).emit('cs2_bomb_event', {
        ...payload,
        byId: socket.id
      });
    });

    socket.on('cs2_host_sync', (payload) => {
      const code = cs2SocketToRoom.get(socket.id);
      if (!code || !payload) return;
      const room = cs2Rooms.get(code);
      if (!room || room.leaderId !== socket.id) return;
      socket.to(`cs2:${code}`).emit('cs2_host_sync', payload);
    });

    socket.on('disconnect', () => {
      leaveCS2Room(socket);
    });
  });
}

module.exports = { registerCS2Handlers };
