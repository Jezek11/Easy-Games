const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingInterval: 10000,
  pingTimeout: 5000
});

// Serve static frontend & local Three.js build (instant offline/local loading)
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: 0,
  etag: true
}));
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules', 'three', 'build'), {
  maxAge: '7d',
  etag: true
}));
app.use('/vendor/three-addons', express.static(path.join(__dirname, 'node_modules', 'three', 'examples', 'jsm'), {
  maxAge: '7d',
  etag: true
}));

app.get('/health', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size, queued: matchmakingQueue.length });
});

// Room & matchmaking state
const rooms = new Map(); // code -> Room
const socketToRoom = new Map(); // socketId -> code
let matchmakingQueue = []; // [{ socketId, name, skinId, buildMat, joinedAt }]

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateRoomCode() {
  for (let attempt = 0; attempt < 40; attempt++) {
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

function sanitizeName(raw, fallback = 'Player') {
  const s = String(raw || '').trim().slice(0, 18);
  return s || fallback;
}

function createPlayerRecord(socketId, slot, data) {
  return {
    id: socketId,
    slot,
    name: sanitizeName(data?.name, `Player ${slot + 1}`),
    skinId: String(data?.skinId || 'cyan'),
    buildMat: ['wood', 'brick', 'metal'].includes(data?.buildMat) ? data.buildMat : 'wood',
    hp: 100,
    shield: 100,
    kills: 0,
    alive: true,
    lastPos: null
  };
}

function isServerInSpawnBox(player, mapId) {
  if (mapId !== 'skybox' || !player) return false;
  if (!player.lastPos) return true; // Just spawned inside Sky Box before first state sync
  const { x, y, z } = player.lastPos;
  return y >= 12.8 && Math.abs(x) <= 7.8 && z >= 38.2 && z <= 51.2;
}

function serializeRoomPlayers(room) {
  return Array.from(room.players.values());
}

function serializePartyState(room) {
  return {
    code: room.code,
    leaderId: room.leaderId || null,
    state: room.state || 'lobby',
    mapId: room.mapId,
    matchBuildMat: room.buildMat,
    players: serializeRoomPlayers(room)
  };
}

function removeFromQueue(socketId) {
  const before = matchmakingQueue.length;
  matchmakingQueue = matchmakingQueue.filter((item) => item.socketId !== socketId);
  return matchmakingQueue.length !== before;
}

function leaveCurrentRoom(socket) {
  const code = socketToRoom.get(socket.id);
  if (!code) return;

  socketToRoom.delete(socket.id);
  socket.leave(code);

  const room = rooms.get(code);
  if (!room) return;

  const leavingPlayer = room.players.get(socket.id);
  room.players.delete(socket.id);

  if (room.respawnTimers) {
    const t = room.respawnTimers.get(socket.id);
    if (t) {
      clearTimeout(t);
      room.respawnTimers.delete(socket.id);
    }
  }

  if (room.players.size === 0) {
    if (room.respawnTimers) {
      for (const t of room.respawnTimers.values()) clearTimeout(t);
    }
    rooms.delete(code);
  } else {
    if (room.leaderId === socket.id) {
      const [nextId, nextPlayer] = room.players.entries().next().value;
      room.leaderId = nextId;
      if (room.state === 'lobby') {
        nextPlayer.slot = 0;
        room.buildMat = nextPlayer.buildMat;
      }
    }
    io.to(code).emit('opponent_left', {
      leftId: socket.id,
      name: leavingPlayer?.name || 'Opponent'
    });
    if (room.isPrivate) {
      io.to(code).emit('party_update', serializePartyState(room));
    }
  }
}

function broadcastStats() {
  io.emit('portal_stats', {
    online: io.engine.clientsCount,
    activeRooms: rooms.size,
    queued: matchmakingQueue.length
  });
}

io.on('connection', (socket) => {
  broadcastStats();

  socket.on('ping_check', (clientTs, ack) => {
    if (typeof ack === 'function') ack(clientTs);
  });

  socket.on('create_private_room', (payload, ack) => {
    removeFromQueue(socket.id);
    leaveCurrentRoom(socket);

    const code = generateRoomCode();
    const mapId = payload?.mapId === 'vramp' ? 'vramp' : 'skybox';
    const player = createPlayerRecord(socket.id, 0, payload);
    const room = {
      code,
      isPrivate: true,
      state: 'lobby',
      leaderId: socket.id,
      mapId,
      buildMat: player.buildMat,
      players: new Map([[socket.id, player]]),
      builds: new Map(),
      respawnTimers: new Map(),
      createdAt: Date.now()
    };

    rooms.set(code, room);
    socketToRoom.set(socket.id, code);
    socket.join(code);
    broadcastStats();

    if (typeof ack === 'function') {
      ack({
        ok: true,
        code,
        slot: 0,
        leaderId: room.leaderId,
        state: room.state,
        mapId: room.mapId,
        matchBuildMat: room.buildMat,
        players: serializeRoomPlayers(room),
        builds: []
      });
    }
  });

  socket.on('join_private_room', (payload, ack) => {
    const code = normalizeCode(payload?.code);
    if (!code || !rooms.has(code)) {
      if (typeof ack === 'function') {
        ack({ ok: false, error: `Room #${code || '????'} does not exist or has ended.` });
      }
      return;
    }

    const room = rooms.get(code);
    if (room.players.size >= 2 && !room.players.has(socket.id)) {
      if (typeof ack === 'function') {
        ack({ ok: false, error: `Room #${code} is full (2/2 players).` });
      }
      return;
    }

    removeFromQueue(socket.id);
    if (socketToRoom.get(socket.id) !== code) {
      leaveCurrentRoom(socket);
    }

    // Pick free slot (0 or 1)
    const usedSlots = new Set(Array.from(room.players.values()).map((p) => p.slot));
    const slot = usedSlots.has(0) ? 1 : 0;
    const player = createPlayerRecord(socket.id, slot, payload);

    room.players.set(socket.id, player);
    socketToRoom.set(socket.id, code);
    socket.join(code);
    broadcastStats();

    const players = serializeRoomPlayers(room);
    const builds = Array.from(room.builds.values());
    const partyPayload = serializePartyState(room);

    if (room.state === 'playing') {
      socket.to(code).emit('player_joined', {
        player,
        players
      });
    }
    io.to(code).emit('party_update', partyPayload);

    if (typeof ack === 'function') {
      ack({
        ok: true,
        code,
        slot,
        leaderId: room.leaderId,
        state: room.state || 'lobby',
        mapId: room.mapId,
        matchBuildMat: room.buildMat,
        players,
        builds: room.state === 'playing' ? builds : []
      });
    }
  });

  socket.on('join_matchmaking', (payload, ack) => {
    removeFromQueue(socket.id);
    leaveCurrentRoom(socket);

    // Filter out disconnected sockets still in queue
    matchmakingQueue = matchmakingQueue.filter((entry) => io.sockets.sockets.has(entry.socketId));

    if (matchmakingQueue.length > 0) {
      const waiting = matchmakingQueue.shift();
      const waitingSocket = io.sockets.sockets.get(waiting.socketId);

      if (waitingSocket && waitingSocket.id !== socket.id) {
        leaveCurrentRoom(waitingSocket);

        const code = generateRoomCode();
        const p0 = createPlayerRecord(waitingSocket.id, 0, waiting);
        const p1 = createPlayerRecord(socket.id, 1, payload);
        const mapId = waiting.mapId === 'vramp' ? 'vramp' : 'skybox';

        const room = {
          code,
          isPrivate: false,
          state: 'playing',
          leaderId: waitingSocket.id,
          mapId,
          buildMat: p0.buildMat,
          players: new Map([
            [waitingSocket.id, p0],
            [socket.id, p1]
          ]),
          builds: new Map(),
          respawnTimers: new Map(),
          createdAt: Date.now()
        };

        rooms.set(code, room);
        socketToRoom.set(waitingSocket.id, code);
        socketToRoom.set(socket.id, code);
        waitingSocket.join(code);
        socket.join(code);

        const players = serializeRoomPlayers(room);

        if (typeof ack === 'function') {
          ack({ ok: true, matched: true, code, slot: 1, mapId: room.mapId, matchBuildMat: room.buildMat, players });
        }

        waitingSocket.emit('match_found', {
          code,
          slot: 0,
          mapId: room.mapId,
          matchBuildMat: room.buildMat,
          players
        });

        socket.emit('match_found', {
          code,
          slot: 1,
          mapId: room.mapId,
          matchBuildMat: room.buildMat,
          players
        });

        broadcastStats();
        return;
      }
    }

    matchmakingQueue.push({
      socketId: socket.id,
      name: sanitizeName(payload?.name, 'Player'),
      skinId: String(payload?.skinId || 'cyan'),
      buildMat: ['wood', 'brick', 'metal'].includes(payload?.buildMat) ? payload.buildMat : 'wood',
      mapId: payload?.mapId === 'vramp' ? 'vramp' : 'skybox',
      joinedAt: Date.now()
    });
    broadcastStats();

    if (typeof ack === 'function') {
      ack({ ok: true, matched: false, queued: true });
    }
  });

  socket.on('cancel_matchmaking', () => {
    if (removeFromQueue(socket.id)) {
      broadcastStats();
    }
  });

  socket.on('leave_room', () => {
    removeFromQueue(socket.id);
    leaveCurrentRoom(socket);
    broadcastStats();
  });

  socket.on('party_set_settings', (payload) => {
    const code = socketToRoom.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room || room.leaderId !== socket.id) return;

    if (payload?.mapId === 'vramp' || payload?.mapId === 'skybox') {
      room.mapId = payload.mapId;
    }
    if (['wood', 'brick', 'metal'].includes(payload?.buildMat)) {
      room.buildMat = payload.buildMat;
      const leader = room.players.get(socket.id);
      if (leader) leader.buildMat = payload.buildMat;
    }

    io.to(code).emit('party_update', serializePartyState(room));
  });

  socket.on('party_start_game', (payload, ack) => {
    const code = socketToRoom.get(socket.id);
    if (!code) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Not in a party.' });
      return;
    }
    const room = rooms.get(code);
    if (!room) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Party not found.' });
      return;
    }
    if (room.leaderId !== socket.id) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Only the party leader can start the game.' });
      return;
    }

    if (payload?.mapId === 'vramp' || payload?.mapId === 'skybox') {
      room.mapId = payload.mapId;
    }
    if (['wood', 'brick', 'metal'].includes(payload?.buildMat)) {
      room.buildMat = payload.buildMat;
    }

    room.builds.clear();
    for (const t of room.respawnTimers.values()) clearTimeout(t);
    room.respawnTimers.clear();

    for (const p of room.players.values()) {
      p.hp = 100;
      p.shield = 100;
      p.kills = 0;
      p.alive = true;
      p.lastPos = null;
    }
    room.state = 'playing';

    const players = serializeRoomPlayers(room);
    for (const [pid, p] of room.players.entries()) {
      io.to(pid).emit('party_game_start', {
        code: room.code,
        leaderId: room.leaderId,
        slot: p.slot,
        mapId: room.mapId,
        matchBuildMat: room.buildMat,
        players,
        builds: []
      });
    }

    if (typeof ack === 'function') {
      ack({ ok: true, code: room.code });
    }
  });

  socket.on('party_kick', (payload) => {
    const code = socketToRoom.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room || room.leaderId !== socket.id) return;

    const targetId = payload?.targetId;
    if (!targetId || targetId === socket.id || !room.players.has(targetId)) return;

    const leader = room.players.get(socket.id);
    room.players.delete(targetId);
    socketToRoom.delete(targetId);

    const targetSocket = io.sockets.sockets.get(targetId);
    if (targetSocket) {
      targetSocket.leave(code);
      targetSocket.emit('party_kicked', {
        code,
        byName: leader?.name || 'Leader'
      });
    }

    io.to(code).emit('party_update', serializePartyState(room));
    broadcastStats();
  });

  socket.on('cosmetics_update', (payload) => {
    const code = socketToRoom.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player) return;

    if (payload?.name) player.name = sanitizeName(payload.name, player.name);
    if (payload?.skinId) player.skinId = String(payload.skinId);
    if (['wood', 'brick', 'metal'].includes(payload?.buildMat) && (room.leaderId === socket.id || player.slot === 0)) {
      player.buildMat = payload.buildMat;
      room.buildMat = payload.buildMat;
      if (room.state === 'playing') {
        io.to(code).emit('match_material_update', { buildMat: room.buildMat });
      }
    }

    if (room.state === 'lobby') {
      io.to(code).emit('party_update', serializePartyState(room));
    } else {
      socket.to(code).emit('opponent_cosmetics', {
        id: socket.id,
        name: player.name,
        skinId: player.skinId,
        buildMat: room.buildMat
      });
    }
  });

  socket.on('player_update', (state) => {
    const code = socketToRoom.get(socket.id);
    if (!code || !state) return;
    const room = rooms.get(code);
    const x = Number(state.x) || 0;
    const y = Number(state.y) || 0;
    const z = Number(state.z) || 0;
    if (room) {
      const p = room.players.get(socket.id);
      if (p) p.lastPos = { x, y, z };
    }
    socket.to(code).emit('opponent_update', {
      id: socket.id,
      x,
      y,
      z,
      yaw: Number(state.yaw) || 0,
      pitch: Number(state.pitch) || 0,
      vx: Number(state.vx) || 0,
      vz: Number(state.vz) || 0,
      crouch: Boolean(state.crouch),
      slot: Number(state.slot) || 0,
      weaponId: typeof state.weaponId === 'string' ? state.weaponId : null,
      buildMode: state.buildMode || null,
      swing: Number(state.swing) || 0,
      reloading: Boolean(state.reloading),
      reloadProgress: Math.max(0, Math.min(1, Number(state.reloadProgress) || 0)),
      emote: typeof state.emote === 'string' ? state.emote.slice(0, 16) : null,
      emoteYaw: Number.isFinite(Number(state.emoteYaw)) ? Number(state.emoteYaw) : null
    });
  });

  socket.on('build_place', (buildData, ack) => {
    const code = socketToRoom.get(socket.id);
    if (!code || !buildData || !buildData.key) return;
    const room = rooms.get(code);
    if (!room) return;
    const builder = room.players.get(socket.id);
    if (isServerInSpawnBox(builder, room.mapId)) {
      if (typeof ack === 'function') ack({ ok: false, key: buildData.key, reason: 'spawn_box' });
      return;
    }

    if (room.builds.has(buildData.key)) {
      if (typeof ack === 'function') ack({ ok: false, key: buildData.key });
      return;
    }

    const record = {
      id: String(buildData.id || buildData.key),
      key: String(buildData.key),
      type: String(buildData.type),
      mat: room.buildMat || String(buildData.mat || 'wood'),
      gx: Number(buildData.gx),
      gy: Number(buildData.gy),
      gz: Number(buildData.gz),
      dir: Number(buildData.dir || 0),
      rot: Number(buildData.rot || 0),
      mask: Number(buildData.mask),
      hp: Number(buildData.hp) || 150,
      maxHp: Number(buildData.maxHp) || 150,
      ownerId: socket.id
    };

    room.builds.set(record.key, record);
    socket.to(code).emit('build_placed', record);
    if (typeof ack === 'function') ack({ ok: true, id: record.id });
  });

  socket.on('build_edit', (payload) => {
    const code = socketToRoom.get(socket.id);
    if (!code || !payload || !payload.key) return;
    const room = rooms.get(code);
    if (!room) return;

    const existing = room.builds.get(payload.key);
    if (!existing) return;
    if (existing.ownerId && existing.ownerId !== socket.id) return;

    existing.mask = Number(payload.mask);
    if (typeof payload.rot === 'number') existing.rot = payload.rot;

    socket.to(code).emit('build_edited', {
      key: existing.key,
      mask: existing.mask,
      rot: existing.rot
    });
  });

  socket.on('build_damage', (payload) => {
    const code = socketToRoom.get(socket.id);
    if (!code || !payload || !payload.key) return;
    const room = rooms.get(code);
    if (!room) return;

    const existing = room.builds.get(payload.key);
    if (!existing) return;

    const dmg = Math.max(0, Math.min(500, Number(payload.damage) || 0));
    existing.hp -= dmg;

    if (existing.hp <= 0) {
      room.builds.delete(existing.key);
      io.to(code).emit('build_destroyed', { key: existing.key, by: socket.id });
    } else {
      io.to(code).emit('build_damaged', { key: existing.key, hp: existing.hp, maxHp: existing.maxHp });
    }
  });

  socket.on('shoot_fx', (payload) => {
    const code = socketToRoom.get(socket.id);
    if (!code || !payload) return;
    socket.to(code).emit('opponent_shoot', {
      id: socket.id,
      weapon: payload.weapon,
      origin: payload.origin,
      end: payload.end
    });
  });

  socket.on('player_hit', (payload) => {
    const code = socketToRoom.get(socket.id);
    if (!code || !payload) return;
    const room = rooms.get(code);
    if (!room) return;

    const target = room.players.get(payload.targetId);
    const attacker = room.players.get(socket.id);
    if (!target || !target.alive) return;
    if (isServerInSpawnBox(attacker, room.mapId) || isServerInSpawnBox(target, room.mapId)) return;

    let dmg = Math.max(0, Math.min(200, Number(payload.damage) || 0));
    if (dmg <= 0) return;

    if (target.shield > 0) {
      const shieldAbsorb = Math.min(target.shield, dmg);
      target.shield -= shieldAbsorb;
      dmg -= shieldAbsorb;
    }
    if (dmg > 0) {
      target.hp = Math.max(0, target.hp - dmg);
    }

    io.to(code).emit('health_update', {
      targetId: target.id,
      attackerId: socket.id,
      hp: target.hp,
      shield: target.shield,
      damage: Number(payload.damage) || 0,
      isHeadshot: Boolean(payload.isHeadshot)
    });

    if (target.hp <= 0) {
      target.alive = false;
      if (attacker && attacker.id !== target.id) {
        attacker.kills += 1;
      }

      io.to(code).emit('player_eliminated', {
        victimId: target.id,
        killerId: socket.id,
        weapon: payload.weapon || 'ar',
        isHeadshot: Boolean(payload.isHeadshot),
        players: serializeRoomPlayers(room)
      });

      if (room.mapId === 'vramp') {
        for (const t of room.respawnTimers.values()) clearTimeout(t);
        room.respawnTimers.clear();

        const roundTimer = setTimeout(() => {
          room.respawnTimers.delete('__vramp_round__');
          if (!rooms.has(code)) return;

          room.builds.clear();
          for (const p of room.players.values()) {
            p.hp = 100;
            p.shield = 100;
            p.alive = true;
            p.lastPos = null;
          }

          io.to(code).emit('vramp_next_round', {
            mapId: room.mapId,
            matchBuildMat: room.buildMat,
            players: serializeRoomPlayers(room)
          });
        }, 1400);

        room.respawnTimers.set('__vramp_round__', roundTimer);
      } else {
        const oldTimer = room.respawnTimers.get(target.id);
        if (oldTimer) clearTimeout(oldTimer);

        const respawnTimer = setTimeout(() => {
          room.respawnTimers.delete(target.id);
          if (!rooms.has(code) || !room.players.has(target.id)) return;
          target.hp = 100;
          target.shield = 100;
          target.alive = true;
          target.lastPos = null;

          io.to(code).emit('player_respawn', {
            playerId: target.id,
            slot: target.slot,
            hp: 100,
            shield: 100
          });
        }, 2000);

        room.respawnTimers.set(target.id, respawnTimer);
      }
    }
  });

  socket.on('player_fell', () => {
    const code = socketToRoom.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;

    const victim = room.players.get(socket.id);
    if (!victim || !victim.alive) return;

    victim.alive = false;
    victim.hp = 0;
    victim.shield = 0;

    let killer = null;
    for (const p of room.players.values()) {
      if (p.id !== socket.id) {
        p.kills += 1;
        killer = p;
      }
    }

    io.to(code).emit('player_eliminated', {
      victimId: victim.id,
      killerId: killer ? killer.id : null,
      reason: 'fall',
      players: serializeRoomPlayers(room)
    });

    for (const t of room.respawnTimers.values()) clearTimeout(t);
    room.respawnTimers.clear();

    const roundTimer = setTimeout(() => {
      room.respawnTimers.delete('__round_restart__');
      if (!rooms.has(code)) return;

      room.builds.clear();
      for (const p of room.players.values()) {
        p.hp = 100;
        p.shield = 100;
        p.alive = true;
        p.lastPos = null;
      }

      io.to(code).emit('round_restart', {
        reason: 'fall',
        mapId: room.mapId,
        matchBuildMat: room.buildMat,
        players: serializeRoomPlayers(room)
      });
    }, 1000);

    room.respawnTimers.set('__round_restart__', roundTimer);
  });

  socket.on('arena_reset', () => {
    const code = socketToRoom.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;

    room.builds.clear();
    for (const t of room.respawnTimers.values()) clearTimeout(t);
    room.respawnTimers.clear();

    for (const p of room.players.values()) {
      p.hp = 100;
      p.shield = 100;
      p.alive = true;
      p.lastPos = null;
    }

    const triggerPlayer = room.players.get(socket.id);
    io.to(code).emit('arena_reset_done', {
      byId: socket.id,
      byName: triggerPlayer?.name || 'Player',
      mapId: room.mapId,
      matchBuildMat: room.buildMat,
      players: serializeRoomPlayers(room)
    });
  });

  socket.on('disconnect', () => {
    removeFromQueue(socket.id);
    leaveCurrentRoom(socket);
    broadcastStats();
  });
});

server.listen(PORT, () => {
  console.log(`BuildRoyale 3D Portal server running on http://localhost:${PORT}`);
});
