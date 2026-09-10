/** The room page: everything about a room is built from registry data. A
 *  second room (a different year, a different machine, a different phone
 *  book) must be a data change here, not a code change -- spec §2 and §4.1.
 *  Nothing about 1980 is a literal in this file; the only strings here are
 *  UI chrome ("Power", "Phone Book", ...), never facts about the room. */

import type { Room, MachineSpec } from "@70snet/registry/room"
import type { Destination } from "@70snet/registry/destination"
import { phoneBook } from "@70snet/registry/destination"
import type { ClientMessage, ServerMessage } from "@70snet/protocol/client"
import { Telephone } from "./telephone"
import { Tones } from "./tones"

/** The Apple II+ keyboard could not produce lowercase. Typing is uppercased
 *  silently: the screen shows the truth on the first keystroke. Keys the
 *  machine did not have do nothing -- we never substitute a plausible
 *  alternative, because a key that quietly does something else is the room
 *  lying to the visitor (spec §7.2). */
export function toApple(text: string): string {
  return text.toUpperCase()
}

/** A period document, read in place -- the room's help system (spec §7.4).
 *  Paths are relative to `apps/web/index.html`, where these files actually
 *  sit on disk; how they get served is a static-hosting concern outside
 *  this task, not something room.ts invents. */
const MANUALS: { title: string; href: string }[] = [
  { title: "CBBS Cookbook (installation guide)", href: "../../machines/s100-cbbs/cbbs/cookbook.txt" },
  { title: "CBBS Operator's Manual", href: "../../machines/s100-cbbs/cbbs/cbbsoper.txt" },
  { title: "1981 CBBS List (the period phone book)", href: "../../machines/s100-cbbs/cbbs/1981cbbslist.txt" },
]

/** One open call's control channel: JSON `ClientMessage`/`ServerMessage`
 *  traffic (spec §4.3), distinct from the 300-baud byte stream, which runs
 *  iframe-to-exchange via Task 9's serial backend and never passes through
 *  this page at all. */
export interface ExchangeSocket {
  send(msg: ClientMessage): void
  close(): void
}

export type ExchangeConnector = (
  number: string,
  onMessage: (msg: ServerMessage) => void
) => ExchangeSocket

/** The default connector: a plain WebSocket to the exchange. The exchange's
 *  address is not something this page may guess at -- the switchboard
 *  (apps/switchboard) runs as its own process, so `data-exchange-url` on the
 *  document root is the one place that configuration comes from (set it to
 *  wherever that switchboard is listening; see the comment on it in
 *  index.html). Missing config fails immediately, with a named error, the
 *  moment a call is attempted -- never a silent no-op (project fail-fast
 *  rules). */
export function webSocketExchangeConnector(): ExchangeConnector {
  return (number, onMessage) => {
    const url = document.documentElement.dataset.exchangeUrl
    if (url === undefined || url === "") {
      throw new Error(
        "no exchange configured: set data-exchange-url on <html> to the switchboard's address"
      )
    }
    const ws = new WebSocket(url)
    // A close the caller asked for (hanging up) is not a dropped call --
    // only an unrequested close/error means the line actually went dead.
    let closedByUs = false
    let hadError = false

    ws.addEventListener("open", () => {
      const dial: ClientMessage = { kind: "dial", number }
      ws.send(JSON.stringify(dial))
    })
    ws.addEventListener("message", ev => {
      let msg: ServerMessage
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage
      } catch (err) {
        onMessage({
          kind: "out-of-service",
          reason: `malformed message from exchange: ${err instanceof Error ? err.message : String(err)}`,
        })
        return
      }
      onMessage(msg)
    })
    ws.addEventListener("error", () => {
      hadError = true
    })
    ws.addEventListener("close", ev => {
      if (closedByUs) return
      if (hadError || !ev.wasClean) {
        onMessage({ kind: "out-of-service", reason: `connection lost (code ${ev.code})` })
      } else {
        onMessage({ kind: "carrier-lost" })
      }
    })
    return {
      send: msg => ws.send(JSON.stringify(msg)),
      close: () => {
        closedByUs = true
        ws.close()
      },
    }
  }
}

export interface RenderRoomOptions {
  connect?: ExchangeConnector
}

export function renderRoom(
  room: Room,
  destinations: Destination[],
  opts: RenderRoomOptions = {}
): HTMLElement {
  const connect = opts.connect ?? webSocketExchangeConnector()

  const el = document.createElement("div")
  el.className = "room"
  el.setAttribute("data-room", room.id)

  const heading = document.createElement("h1")
  heading.textContent = room.name
  el.appendChild(heading)

  const machines = document.createElement("div")
  machines.className = "machines"
  for (const machine of room.machines) {
    machines.appendChild(renderMachine(machine, connect, destinations, room.date))
  }
  el.appendChild(machines)

  el.appendChild(renderPhoneBook(destinations, room.date))
  el.appendChild(renderManuals())

  return el
}

function renderMachine(
  machine: MachineSpec,
  connect: ExchangeConnector,
  destinations: Destination[],
  date: string
): HTMLElement {
  const section = document.createElement("section")
  section.className = "machine"
  section.setAttribute("data-machine", machine.id)

  const name = document.createElement("h2")
  name.textContent = machine.name
  section.appendChild(name)

  // The museum card (spec §4.1, §6.4). Text comes only from
  // `machine.card` -- never a string written here -- so that the honesty
  // this label provides stays tied to the data that describes the exhibit.
  const card = document.createElement("p")
  card.className = "museum-card"
  card.setAttribute("data-museum-card", "")
  card.textContent = machine.card
  section.appendChild(card)

  // An un-powered machine shows nothing at all: no `src` until the switch
  // is thrown. Once thrown, an empty Disk II grinds forever (spec §6.4) --
  // that is authentic, and this file does nothing to "fix" it.
  const screen = document.createElement("iframe")
  screen.className = "machine-screen"
  screen.setAttribute("data-machine-frame", "")
  screen.setAttribute("title", `${machine.name} screen`)

  const power = document.createElement("button")
  power.type = "button"
  power.className = "power-switch"
  power.setAttribute("data-power-switch", "")
  power.setAttribute("aria-pressed", "false")
  power.textContent = "Power: OFF"

  power.addEventListener("click", () => {
    const isOn = power.getAttribute("aria-pressed") === "true"
    if (isOn) {
      power.setAttribute("aria-pressed", "false")
      power.textContent = "Power: OFF"
      screen.removeAttribute("src")
      return
    }
    if (machine.emulator !== "apple2ts") {
      throw new Error(`no emulator wired for "${machine.emulator}"`)
    }
    power.setAttribute("aria-pressed", "true")
    power.textContent = "Power: ON"
    screen.src = "../../vendor/apple2ts/dist/index.html"
  })

  section.appendChild(power)
  section.appendChild(screen)
  section.appendChild(renderTelephone(machine, connect, destinations, date))

  return section
}

/** The telephone: handset, rotary dial (or a single Hayes dial button, per
 *  the machine's modem -- spec §7.3, "the telephone UI reads the modem
 *  spec; it never assumes one"), and the tones that go with each state. */
function renderTelephone(
  machine: MachineSpec,
  connect: ExchangeConnector,
  destinations: Destination[],
  date: string
): HTMLElement {
  const wrap = document.createElement("div")
  wrap.className = "telephone"
  wrap.setAttribute("data-telephone", "")
  wrap.setAttribute("data-modem", machine.modem.id)

  const telephone = new Telephone({ tones: new Tones(), dialing: machine.modem.dialing })
  let socket: ExchangeSocket | null = null

  // The partially dialled number lives here, not inside the manual-dial
  // branch below, so a hangup from *any* path (handset replaced, carrier
  // lost, busy) can clear it -- otherwise the next call starts with digits
  // left over from the last one.
  let dialed = ""

  // Whether the visitor has flipped the modem to DATA on the current call.
  // `refresh` is the single place that reconciles this with reality: once
  // the call is no longer connected there is nothing to be in DATA mode on.
  let inDataMode = false

  const status = document.createElement("p")
  status.className = "telephone-status"
  status.setAttribute("data-telephone-status", "")
  status.textContent = telephone.state

  const dataSwitch = document.createElement("button")
  dataSwitch.type = "button"
  dataSwitch.setAttribute("data-modem-switch", "")
  dataSwitch.textContent = "Modem: VOICE"

  const refresh = () => {
    status.textContent = telephone.state
    if (telephone.state !== "connected") inDataMode = false
    dataSwitch.textContent = inDataMode ? "Modem: DATA" : "Modem: VOICE"
  }

  const endCall = () => {
    socket?.close()
    socket = null
    dialed = ""
  }

  const handset = document.createElement("button")
  handset.type = "button"
  handset.setAttribute("data-handset", "")
  handset.textContent = "Lift handset"

  handset.addEventListener("click", () => {
    if (telephone.state === "on-hook") {
      telephone.lift()
      handset.textContent = "Replace handset"
    } else {
      telephone.replace()
      endCall()
      handset.textContent = "Lift handset"
    }
    refresh()
  })

  dataSwitch.addEventListener("click", () => {
    // The switch only means anything on a live call.
    if (telephone.state !== "connected") return
    if (inDataMode) {
      telephone.flipToVoice()
    } else {
      telephone.flipToData()
    }
    inDataMode = !inDataMode
    refresh()
  })

  const onConnected = (number: string) => {
    socket = connect(number, msg => {
      telephone.hear(msg)
      refresh()
    })
  }

  const dialPad = document.createElement("div")
  dialPad.className = "rotary-dial"
  dialPad.setAttribute("data-rotary-dial", "")

  if (machine.modem.dialing === "manual") {
    for (const digit of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]) {
      const btn = document.createElement("button")
      btn.type = "button"
      btn.setAttribute("data-dial-digit", digit)
      btn.textContent = digit
      btn.addEventListener("click", () => {
        void telephone.dial(digit).then(() => {
          dialed += digit
          refresh()
          if (dialed.length === 10) {
            const number = `${dialed.slice(0, 3)}-${dialed.slice(3, 6)}-${dialed.slice(6)}`
            onConnected(number)
            dialed = ""
          }
        })
      })
      dialPad.appendChild(btn)
    }
  } else {
    // 1981+: a Hayes Smartmodem dials itself; there is no handset in the
    // loop (spec §7.3). The visitor picks a destination from the room's
    // phone book, and that selection is passed straight into the dialing
    // action -- not stashed on a dataset attribute the button then has to
    // go looking for.
    const numberSelect = document.createElement("select")
    numberSelect.setAttribute("data-hayes-number-select", "")
    for (const entry of phoneBook(destinations, date)) {
      const option = document.createElement("option")
      option.value = entry.number
      option.textContent = `${entry.name} (${entry.number})`
      numberSelect.appendChild(option)
    }
    dialPad.appendChild(numberSelect)

    const dialButton = document.createElement("button")
    dialButton.type = "button"
    dialButton.setAttribute("data-hayes-dial", "")
    dialButton.textContent = "Dial"
    dialButton.addEventListener("click", () => {
      const number = numberSelect.value
      if (number === "") throw new Error("no number set to dial")
      void telephone.dialNumber(number).then(() => {
        refresh()
        onConnected(number)
      })
    })
    dialPad.appendChild(dialButton)
  }

  wrap.appendChild(status)
  wrap.appendChild(handset)
  wrap.appendChild(dataSwitch)
  wrap.appendChild(dialPad)
  return wrap
}

function renderPhoneBook(destinations: Destination[], date: string): HTMLElement {
  const wrap = document.createElement("section")
  wrap.className = "phone-book"
  wrap.setAttribute("data-phonebook", "")

  const heading = document.createElement("h2")
  heading.textContent = "Phone Book"
  wrap.appendChild(heading)

  const list = document.createElement("ul")
  for (const entry of phoneBook(destinations, date)) {
    const li = document.createElement("li")
    li.setAttribute("data-phonebook-entry", "")
    // Every entry carries its fidelity so the honesty label is structural,
    // not cosmetic (spec §4.1).
    li.setAttribute("data-fidelity", entry.fidelity)

    const name = document.createElement("span")
    name.className = "entry-name"
    name.textContent = entry.name

    const number = document.createElement("span")
    number.className = "entry-number"
    number.textContent = entry.number

    const label = document.createElement("span")
    label.className = `entry-fidelity entry-fidelity-${entry.fidelity}`
    label.setAttribute("data-fidelity-label", "")
    label.textContent = entry.fidelity === "real-software" ? "real software" : "reconstruction"

    const speeds = document.createElement("span")
    speeds.className = "entry-speeds"
    speeds.textContent = entry.speeds.map(s => `${s} baud`).join(", ")

    li.append(name, number, label, speeds)
    list.appendChild(li)
  }
  wrap.appendChild(list)
  return wrap
}

function renderManuals(): HTMLElement {
  const wrap = document.createElement("section")
  wrap.className = "manuals"
  wrap.setAttribute("data-manuals", "")

  const heading = document.createElement("h2")
  heading.textContent = "Manuals"
  wrap.appendChild(heading)

  const list = document.createElement("ul")
  for (const manual of MANUALS) {
    const li = document.createElement("li")
    const a = document.createElement("a")
    a.href = manual.href
    a.target = "_blank"
    a.rel = "noopener noreferrer"
    a.setAttribute("data-manual-link", "")
    a.textContent = manual.title
    li.appendChild(a)
    list.appendChild(li)
  }
  wrap.appendChild(list)
  return wrap
}
