import { giveStarterParty, newPlayer, normalise, type PlayerState } from '@stackmon/core';

/**
 * Save and load.
 *
 * One slot, in localStorage, written after anything that matters. The state
 * object itself is owned by @stackmon/core and knows nothing about storage;
 * this file is the only place in the game that does.
 *
 * Every read and write is wrapped, because localStorage is allowed to be
 * absent, full, or throwing (private windows, cleared site data, a quota
 * exceeded by some other tab). A game that crashes on a save failure has
 * turned a nuisance into a lost session.
 */

const KEY = 'stackmon.save.v1';

export function loadPlayer(): PlayerState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PlayerState;
      if (parsed && parsed.version === 1 && Array.isArray(parsed.roster)) {
        return normalise(parsed);
      }
    }
  } catch (err) {
    console.warn('STACKMON: could not read save, starting fresh.', err);
  }
  return freshPlayer();
}

export function savePlayer(p: PlayerState): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
    return true;
  } catch (err) {
    console.warn('STACKMON: could not write save.', err);
    return false;
  }
}

export function wipeSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to do: if we cannot remove it, the next load will overwrite it.
  }
}

export function freshPlayer(): PlayerState {
  // The seed is time-based so two players get different islands, but it is
  // stored, so this player's island is the same every time they come back.
  const p = newPlayer(`realm-${Date.now().toString(36)}`);
  giveStarterParty(p);
  return p;
}
