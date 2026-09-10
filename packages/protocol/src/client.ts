/** Browser -> exchange. Control only; modem bytes travel as binary frames. */
export type ClientMessage =
  | { kind: "dial"; number: string }
  | { kind: "hangup" }

/** Exchange -> browser. Every outcome a 1980 caller could hear. */
export type ServerMessage =
  | { kind: "ringing" }
  | { kind: "busy" }
  | { kind: "no-answer" }
  | { kind: "connected"; baud: number }
  | { kind: "carrier-lost" }
  | { kind: "out-of-service"; reason: string }
