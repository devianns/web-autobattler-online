import { createRng } from "../game/rng";

export interface Pairing {
  index: number;
  playerAId: string;
  playerBId: string;
  isGhost: boolean;
  ghostOwnerId: string | null;
}

function shuffled(ids: string[], seed: string) {
  const result = [...ids].sort();
  const random = createRng(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

/** Every survivor fights once. With an odd count, the final survivor fights a
 * deterministic snapshot ghost owned by another survivor. */
export function createRoundPairings(playerIds: string[], seed: string, previousGhostOwnerId: string | null = null): Pairing[] {
  const players = shuffled([...new Set(playerIds)], seed);
  if (players.length < 2) return [];
  const pairings: Pairing[] = [];
  const realPairCount = Math.floor(players.length / 2);
  for (let index = 0; index < realPairCount; index += 1) {
    pairings.push({ index, playerAId: players[index * 2], playerBId: players[index * 2 + 1], isGhost: false, ghostOwnerId: null });
  }
  if (players.length % 2 === 1) {
    const playerAId = players.at(-1)!;
    const candidates = shuffled(players.filter((id) => id !== playerAId), `${seed}:ghost`);
    const ghostOwnerId = candidates.find((id) => id !== previousGhostOwnerId) ?? candidates[0];
    pairings.push({ index: pairings.length, playerAId, playerBId: ghostOwnerId, isGhost: true, ghostOwnerId });
  }
  return pairings;
}
