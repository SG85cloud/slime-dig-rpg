# InstantDB Integration Reference

This document provides examples and patterns for integrating InstantDB into multiplayer games.

## About InstantDB

Instant is the Modern Firebase. With Instant you can easily build realtime and collaborative multiplayer games.

## Configuration

The `instant_db_config.js` file at the root of your project contains your unique app ID.
Import this configuration when using InstantDB:

```javascript
// instant_db_config.js
export const INSTANT_DB_APP_ID = 'your-app-id-here';
```

## Key Concepts

### Core Primitives

- **Rooms**: Game sessions where players receive updates from each other
- **Presence**: Ephemeral player state (position, health) - auto-cleaned on disconnect
- **Topics**: Fire-and-forget events (explosions, projectiles) - no persistence

### When to Use Each

| Feature | Use Case | Example |
|---------|----------|---------|
| `transact` | Persistent data | High scores, achievements |
| `presence` | Ephemeral state | Player position, health |
| `topics` | Instant events | Shooting, explosions |

## Quick Examples

### Basic Setup

```javascript
import { init, id } from "@instantdb/core";
import { INSTANT_DB_APP_ID } from "./instant_db_config.js";

const db = init({ appId: INSTANT_DB_APP_ID });
const room = db.joinRoom("game", "lobby");
```

### Presence - Track Player State

```javascript
// Publish your player state
room.publishPresence({
  id: playerId,
  name: `Player#${playerId}`,
  x: 100,
  y: 100,
  health: 100
});

// Subscribe to all players
room.subscribePresence({}, (data) => {
  const { user, peers } = data;

  if (user) {
    console.log("You:", user.x, user.y);
  }

  Object.entries(peers).forEach(([id, player]) => {
    console.log(`${player.name}:`, player.x, player.y);
  });
});

// Subscribe to specific properties only
room.subscribePresence({ keys: ['x', 'y'] }, (data) => {
  // Only triggers on position changes
});
```

### Topics - Broadcast Events

```javascript
// Listen for events
room.subscribeTopic('projectile', (event, peer) => {
  console.log(`${peer.name} fired from (${event.x}, ${event.y})`);
  spawnProjectile(event);
});

// Publish events
room.publishTopic('projectile', {
  x: player.x,
  y: player.y,
  angle: player.rotation,
  weaponType: 'laser'
});
```

### Persistence - Save Game Data

```javascript
// Save score to database
db.transact(
  db.tx.scores[id()].update({
    playerId,
    score,
    timestamp: Date.now()
  })
);

// Query saved data
db.subscribeQuery({ scores: {} }, (result) => {
  if (result.data) {
    console.log("High scores:", result.data.scores);
  }
});
```

## Complete Example

A minimal multiplayer game with presence, topics, and persistence:

```javascript
import { init, id } from '@instantdb/core';
import { INSTANT_DB_APP_ID } from './instant_db_config.js';

const db = init({ appId: INSTANT_DB_APP_ID });
let room, myPlayerId, players = {};

function startGame(roomId) {
  room = db.joinRoom('game', roomId);
  myPlayerId = 'player_' + Math.random().toString(36).slice(2, 9);

  // Initialize presence
  room.publishPresence({
    id: myPlayerId,
    name: `Player ${myPlayerId.slice(-4)}`,
    x: Math.random() * 800,
    y: Math.random() * 600,
    health: 100
  });

  // Subscribe to players
  room.subscribePresence({}, (data) => {
    if (data.user) players[myPlayerId] = data.user;
    Object.entries(data.peers).forEach(([id, p]) => players[id] = p);
    renderGame();
  });

  // Listen for game events
  room.subscribeTopic('gameEvent', handleGameEvent);
}

function movePlayer(x, y) {
  room.publishPresence({ x, y });
}

function takeDamage(amount) {
  const newHealth = Math.max(0, players[myPlayerId].health - amount);
  room.publishPresence({ health: newHealth });

  if (newHealth === 0) {
    room.publishTopic('gameEvent', {
      type: 'playerEliminated',
      playerId: myPlayerId
    });

    // Save to leaderboard
    db.transact(
      db.tx.eliminations[id()].update({
        playerId: myPlayerId,
        timestamp: Date.now()
      })
    );
  }
}

function handleGameEvent(event) {
  if (event.type === 'playerEliminated') {
    delete players[event.playerId];
  }
}

function renderGame() {
  Object.values(players).forEach(drawPlayer);
}

// Start
startGame('lobby-1');
```

## Benefits

- **Real-time synchronization** - Automatic state replication across clients
- **Automatic cleanup** - Presence cleared when players disconnect
- **Scalable architecture** - Room-based isolation for different game sessions
- **Flexible persistence** - Choose between ephemeral and persistent data per use case
