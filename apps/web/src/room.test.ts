import { describe, it, expect, vi, afterEach } from "vitest"
import { renderRoom, toApple, webSocketExchangeConnector, type ExchangeSocket } from "./room"
import { ROOM_1980 } from "@70snet/registry/data/rooms"
import { DESTINATIONS } from "@70snet/registry/data/destinations"
import type { Room } from "@70snet/registry/room"
import type { Destination } from "@70snet/registry/destination"
import type { ClientMessage, ServerMessage } from "@70snet/protocol/client"

/** A room with a Hayes-dialing (1981+) machine, for exercising the
 *  autodial path that ROOM_1980's machines never take. */
const ROOM_1981_HAYES: Room = {
  id: "1981-hayes-test-room",
  name: "1981 test room",
  date: "1981-06-01",
  machines: [
    {
      id: "test-machine",
      name: "Test Machine",
      emulator: "apple2ts",
      card: "test card",
      modem: { id: "smartmodem", name: "Hayes Smartmodem", dialing: "hayes-at", speeds: [300] },
      drives: [],
    },
  ],
}

const TEST_DESTINATIONS: Destination[] = [
  {
    id: "test-dest",
    number: "312-555-0100",
    name: "Test BBS",
    eras: [
      {
        from: "1981-01-01",
        until: "1981-12-31",
        lines: 1,
        speeds: [300],
        access: "direct-dial",
        presentationName: "Test BBS",
        fidelity: "reconstruction",
        host: "test-host",
      },
    ],
  },
]

/** A fake connector that records every dial it's asked to make and hands
 *  back a socket whose send/close are spies. */
function fakeConnect() {
  const dialed: string[] = []
  const sockets: { send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }[] = []
  const connect = (number: string, _onMessage: (msg: ServerMessage) => void): ExchangeSocket => {
    dialed.push(number)
    const socket = { send: vi.fn<(msg: ClientMessage) => void>(), close: vi.fn<() => void>() }
    sockets.push(socket)
    return socket
  }
  return { connect, dialed, sockets }
}

/** A minimal fake of the browser `WebSocket` this test controls by hand --
 *  enough to drive `webSocketExchangeConnector`'s "open"/"message"/"error"/
 *  "close" listeners without a real socket or server. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  private listeners: Record<string, ((ev: unknown) => void)[]> = {}
  constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this)
  }
  addEventListener(type: string, cb: (ev: unknown) => void) {
    if (this.listeners[type] === undefined) this.listeners[type] = []
    this.listeners[type].push(cb)
  }
  send(_data: unknown) {}
  close() {}
  dispatch(type: string, ev: unknown = {}) {
    for (const cb of this.listeners[type] ?? []) cb(ev)
  }
}

describe("the exchange WebSocket connector", () => {
  const originalWebSocket = globalThis.WebSocket

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket
    delete document.documentElement.dataset.exchangeUrl
    FakeWebSocket.instances = []
  })

  function fakeSocketConnector() {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    document.documentElement.dataset.exchangeUrl = "ws://example.test"
    const messages: ServerMessage[] = []
    const socket = webSocketExchangeConnector()("312-555-0100", msg => messages.push(msg))
    const ws = FakeWebSocket.instances.at(-1)
    if (ws === undefined) throw new Error("test setup: no fake socket was created")
    return { ws, socket, messages }
  }

  it("surfaces a dropped connection as carrier-lost, not a telephone that silently still looks live", () => {
    const { ws, messages } = fakeSocketConnector()
    ws.dispatch("close", { wasClean: true, code: 1000 })
    expect(messages).toEqual([{ kind: "carrier-lost" }])
  })

  it("surfaces a socket error as out-of-service, with a reason", () => {
    const { ws, messages } = fakeSocketConnector()
    ws.dispatch("error")
    ws.dispatch("close", { wasClean: false, code: 1006 })
    expect(messages).toHaveLength(1)
    expect(messages[0]!.kind).toBe("out-of-service")
  })

  it("does not report a dropped call for a close the caller itself requested", () => {
    const { ws, socket, messages } = fakeSocketConnector()
    socket.close()
    ws.dispatch("close", { wasClean: true, code: 1000 })
    expect(messages).toEqual([])
  })

  it("guards a malformed message from the exchange instead of throwing", () => {
    const { ws, messages } = fakeSocketConnector()
    ws.dispatch("message", { data: "not json" })
    expect(messages).toHaveLength(1)
    expect(messages[0]!.kind).toBe("out-of-service")
  })
})

describe("the 1980 room", () => {
  it("renders from room data, not hardcoded machines", () => {
    const el = renderRoom(ROOM_1980, DESTINATIONS)
    expect(el.querySelectorAll("[data-machine]").length).toBe(ROOM_1980.machines.length)
  })

  it("shows the museum card explaining the empty drive", () => {
    const el = renderRoom(ROOM_1980, DESTINATIONS)
    expect(el.textContent).toContain("There is no software in the machine")
  })

  it("labels every phone book entry with its fidelity", () => {
    const el = renderRoom(ROOM_1980, DESTINATIONS)
    const entries = [...el.querySelectorAll("[data-phonebook-entry]")]
    expect(entries.length).toBeGreaterThan(0)
    for (const e of entries) expect(e.getAttribute("data-fidelity")).toBeTruthy()
  })

  it("uppercases what the visitor types, because the II+ had no lowercase", () => {
    expect(toApple("hello")).toBe("HELLO")
  })
})

describe("the Hayes autodial path (1981+)", () => {
  it("dials the phone-book selection the visitor picked, not an unset dataset attribute", async () => {
    const { connect, dialed } = fakeConnect()
    const el = renderRoom(ROOM_1981_HAYES, TEST_DESTINATIONS, { connect })

    const select = el.querySelector<HTMLSelectElement>("[data-hayes-number-select]")
    expect(select).not.toBeNull()
    expect([...select!.options].map(o => o.value)).toEqual(["312-555-0100"])
    expect(select!.value).toBe("312-555-0100")

    const dialButton = el.querySelector<HTMLButtonElement>("[data-hayes-dial]")
    expect(dialButton).not.toBeNull()
    dialButton!.click()
    await Promise.resolve()
    await Promise.resolve()

    expect(dialed).toEqual(["312-555-0100"])
  })
})

describe("the modem DATA/VOICE switch", () => {
  it("does nothing while there is no live call, so it can never lie about being in DATA mode", () => {
    const { connect } = fakeConnect()
    const el = renderRoom(ROOM_1980, DESTINATIONS, { connect })
    const dataSwitch = el.querySelector<HTMLButtonElement>("[data-modem-switch]")
    expect(dataSwitch).not.toBeNull()
    expect(dataSwitch!.textContent).toBe("Modem: VOICE")

    dataSwitch!.click()

    expect(dataSwitch!.textContent).toBe("Modem: VOICE")
  })
})
