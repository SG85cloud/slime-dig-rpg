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

    // Cache of the last-known contested-mine record id for this room, so a
    // repeat submit updates the same row instead of leaving stale duplicates.
    let mineOwnerRecordId = null;

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
        },
        // Contested mine ownership: the one place this game persists real
        // shared state (db.transact/db.subscribeQuery) instead of ephemeral
        // presence/topics. One doc per room holds the current fastest clear.
        //
        // Known limitation: if two players finish within the same round-trip
        // window, both may read a stale/absent mineOwnerRecordId and both
        // transact an update — InstantDB's server ordering (last write wins)
        // decides the outcome, not necessarily the objectively faster time.
        // subscribeMineOwner's push is the actual source of truth once the
        // dust settles; this is a deliberate simplification, not a bug to
        // chase down with a CAS/transaction-guard layer.
        subscribeMineOwner: (callback) => {
            db.subscribeQuery({ mineOwners: {} }, (result) => {
                const rows = result?.data?.mineOwners || [];
                const record = rows.find((r) => r.roomId === roomId) || null;
                mineOwnerRecordId = record?.id || null;
                callback(record);
            });
        },
        submitMineClearTime: ({ timeMs, playerName, profileId }) => {
            const recordId = mineOwnerRecordId || id();
            db.transact(db.tx.mineOwners[recordId].update({
                roomId, profileId, playerName, timeMs, claimedAt: Date.now()
            }));
        }
    };
}
