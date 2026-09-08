import { init, id } from '@instantdb/core';
import { INSTANT_DB_APP_ID } from './instant_db_config.js';

export async function initMultiplayer() {
    const db = init({ appId: INSTANT_DB_APP_ID });
    
    const params = new URLSearchParams(window.location.search);
    const roomId = params.get('room') || id();
    if (!params.get('room')) {
        window.history.replaceState({}, '', `?room=${roomId}`);
    }

    const room = db.joinRoom('main', roomId);
    const playerId = id();

    return {
        playerId,
        roomId,
        updatePlayer: (data) => {
            room.publishPresence({ id: playerId, ...data });
        },
        subscribeToPlayers: (callback) => {
            room.subscribePresence({}, (data) => {
                callback(data.peers);
            });
        },
        // Fire-and-forget social events (wave starts/clears, floor climbs) —
        // a light "we're in this together" layer that doesn't require syncing
        // actual world state (veins/waves stay per-client for now).
        broadcastEvent: (type, payload = {}) => {
            room.publishTopic('event', { type, ...payload });
        },
        onEvent: (callback) => {
            room.subscribeTopic('event', (event) => callback(event));
        }
    };
}
