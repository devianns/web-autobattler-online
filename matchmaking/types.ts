export interface SessionProfile { id: string; nickname: string | null; createdAt: string; serverNow: string; activeRoomId: string | null }
export type RoomStatus = "WAITING" | "STARTED" | "FINISHED";
export interface RoomSummary { id: string; name: string; status: RoomStatus; hostNickname: string; playerCount: number; maxPlayers: number; createdAt: string; startedAt: string | null }
export interface RoomPlayer { sessionId: string; nickname: string; seat: number; ready: boolean; isHost: boolean; joinedAt: string }
export interface RoomDetail extends RoomSummary { version: number; gameId: string | null; players: RoomPlayer[]; viewerSessionId: string; viewerIsMember: boolean; viewerIsHost: boolean }
export interface GameHistorySummary { id: string; roomId: string; roomName: string; startedAt: string; endedAt: string; rounds: number; winnerNickname: string | null; playerNicknames: string[]; summary: Record<string, unknown> }
export interface GameHistoryDetail extends GameHistorySummary { ledger: Record<string, unknown> }
