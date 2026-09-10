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

/** The default connector: a plain WebSocket to the exchange. The switchboard
 *  (apps/switchboard) now serves this very page (spec: single host, single
 *  Cloudflare tunnel, same origin) -- so its address is not a guess, it is
 *  the page's own address: same host, same port, `wss:` if the page was
 *  loaded over `https:`/`wss:` else `ws:`. That is a correct default, not a
 *  fallback papering over missing config. `data-exchange-url` on the
 *  document root remains as an explicit override, for local development
 *  where the switchboard listens on a different port than the page dev
 *  server (see the comment on it in index.html). */
export function webSocketExchangeConnector(): ExchangeConnector {
  return (number, onMessage) => {
    const override = document.documentElement.dataset.exchangeUrl
    const url =
      override !== undefined && override !== ""
        ? override
        : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`
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

  // Two views, spec §4.1: a wide shot of the room, where each machine is an
  // object to click on, and a close-up "desk" for whichever machine the
  // visitor is currently at. Both are built from `room.machines` up front
  // (nothing about the desks is deferred to a code change per machine);
  // only which one is visible ever changes.
  const roomView = document.createElement("div")
  roomView.className = "room-view"
  roomView.setAttribute("data-room-view", "")

  const roomScene = document.createElement("div")
  roomScene.className = "room-scene"
  roomScene.setAttribute("data-room-scene", "")
  roomView.appendChild(roomScene)

  const deskViews = document.createElement("div")
  deskViews.className = "desk-views"
  deskViews.setAttribute("data-desk-views", "")
  deskViews.hidden = true

  const desksById = new Map<string, HTMLElement>()

  const showRoom = () => {
    roomView.hidden = false
    deskViews.hidden = true
    for (const desk of desksById.values()) desk.hidden = true
  }

  const showDesk = (id: string) => {
    const desk = desksById.get(id)
    if (desk === undefined) throw new Error(`no desk built for machine "${id}"`)
    roomView.hidden = true
    deskViews.hidden = false
    for (const [otherId, other] of desksById) other.hidden = otherId !== id
  }

  for (const machine of room.machines) {
    roomScene.appendChild(renderMachineObject(machine, () => showDesk(machine.id)))

    const desk = renderDesk(machine, connect, destinations, room.date, showRoom)
    desk.hidden = true
    desksById.set(machine.id, desk)
    deskViews.appendChild(desk)
  }

  el.appendChild(roomView)
  el.appendChild(deskViews)

  el.appendChild(renderPhoneBook(destinations, room.date))
  el.appendChild(renderManuals())

  return el
}

/** One machine as an object sitting in the wide room shot -- a desk with a
 *  computer on it. Clicking it is how the visitor walks up to that machine
 *  (spec §4.1: "Clicking a machine brings it to life in the page"). */
function renderMachineObject(machine: MachineSpec, onSelect: () => void): HTMLElement {
  const button = document.createElement("button")
  button.type = "button"
  button.className = "room-machine"
  button.setAttribute("data-machine", machine.id)
  button.setAttribute("aria-label", `Walk up to ${machine.name}`)

  const svgNS = "http://www.w3.org/2000/svg"
  const svg = document.createElementNS(svgNS, "svg")
  svg.setAttribute("viewBox", "0 0 200 140")
  svg.setAttribute("class", "room-machine-art")
  svg.setAttribute("aria-hidden", "true")
  svg.innerHTML = `
    <ellipse cx="100" cy="128" rx="78" ry="8" class="room-machine-shadow" />
    <rect x="16" y="86" width="168" height="30" rx="3" class="room-desk-top" />
    <rect x="16" y="116" width="168" height="10" class="room-desk-front" />
    <rect x="24" y="126" width="10" height="10" class="room-desk-leg" />
    <rect x="166" y="126" width="10" height="10" class="room-desk-leg" />
    <rect x="52" y="46" width="96" height="46" rx="4" class="room-computer-case" />
    <rect x="60" y="52" width="80" height="30" rx="2" class="room-computer-screen" />
    <rect x="60" y="52" width="80" height="30" rx="2" class="room-computer-glow" />
    <rect x="58" y="86" width="84" height="6" class="room-computer-vent" />
    <rect x="112" y="70" width="26" height="18" rx="1" class="room-telephone-body" />
    <circle cx="118" cy="74" r="2" class="room-telephone-dial" />
    <circle cx="126" cy="74" r="2" class="room-telephone-dial" />
    <circle cx="134" cy="74" r="2" class="room-telephone-dial" />
  `
  button.appendChild(svg)

  const label = document.createElement("span")
  label.className = "room-machine-label"
  label.textContent = machine.name
  button.appendChild(label)

  button.addEventListener("click", onSelect)
  return button
}

/** The close-up desk view for one machine: its screen, power switch,
 *  telephone and disk box, plus the museum card and a way back to the room
 *  (spec §4.1). Everything here comes from this one `MachineSpec` -- a
 *  second machine is a second call to this function, not new code. */
function renderDesk(
  machine: MachineSpec,
  connect: ExchangeConnector,
  destinations: Destination[],
  date: string,
  onBack: () => void
): HTMLElement {
  const section = document.createElement("section")
  section.className = "desk"
  section.setAttribute("data-desk-machine", machine.id)

  const back = document.createElement("button")
  back.type = "button"
  back.className = "back-to-room"
  back.setAttribute("data-back-to-room", "")
  back.textContent = "← Back to the room"
  back.addEventListener("click", onBack)
  section.appendChild(back)

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

  const screenFrame = document.createElement("div")
  screenFrame.className = "crt-frame"

  // An un-powered machine shows nothing at all: no `src` until the switch
  // is thrown. Once thrown, an empty Disk II grinds forever (spec §6.4) --
  // that is authentic, and this file does nothing to "fix" it.
  const screen = document.createElement("iframe")
  screen.className = "machine-screen"
  screen.setAttribute("data-machine-frame", "")
  screen.setAttribute("title", `${machine.name} screen`)
  screenFrame.appendChild(screen)

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
    // Served by the switchboard at a stable path (apps/switchboard/src/
    // server.ts), same origin as this page -- not bundled or copied into
    // apps/web/dist, since vendor/apple2ts/dist is ~69 MB and already built.
    screen.src = "/apple2ts/index.html"
  })

  section.appendChild(power)
  section.appendChild(screenFrame)
  section.appendChild(renderTelephone(machine, connect, destinations, date))
  section.appendChild(renderDiskBox())

  return section
}

/** The disk box beside the machine. There is no media subsystem yet (that
 *  is separate, future work), so opening it has nothing real to show --
 *  but it must say so, in the same museum-card voice as everything else
 *  here, rather than silently doing nothing (per the owner's brief). */
function renderDiskBox(): HTMLElement {
  const wrap = document.createElement("div")
  wrap.className = "disk-box"
  wrap.setAttribute("data-disk-box", "")

  const lid = document.createElement("button")
  lid.type = "button"
  lid.className = "disk-box-lid"
  lid.setAttribute("data-disk-box-open", "")
  lid.setAttribute("aria-label", "Open the diskette box")

  const svgNS = "http://www.w3.org/2000/svg"
  const svg = document.createElementNS(svgNS, "svg")
  svg.setAttribute("viewBox", "0 0 120 70")
  svg.setAttribute("class", "disk-box-art")
  svg.setAttribute("aria-hidden", "true")
  svg.innerHTML = `
    <rect x="4" y="18" width="112" height="48" rx="3" class="disk-box-base" />
    <rect x="4" y="4" width="112" height="20" rx="3" class="disk-box-top" />
    <rect x="10" y="24" width="4" height="36" class="disk-sleeve" />
    <rect x="18" y="24" width="4" height="36" class="disk-sleeve" />
    <rect x="26" y="24" width="4" height="36" class="disk-sleeve" />
  `
  lid.appendChild(svg)

  const label = document.createElement("span")
  label.className = "disk-box-label"
  label.textContent = "Disk Box"
  lid.appendChild(label)

  const note = document.createElement("p")
  note.className = "museum-card disk-box-note"
  note.setAttribute("data-disk-box-note", "")
  note.textContent = "The diskettes are not here yet."
  note.hidden = true

  lid.addEventListener("click", () => {
    note.hidden = false
  })

  wrap.append(lid, note)
  return wrap
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

  const tones = new Tones()
  const telephone = new Telephone({ tones, dialing: machine.modem.dialing })
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

  // What the visitor has dialled so far, shown back to them as they press
  // keys -- without this, pressing digits produced no visible sign anything
  // had happened at all.
  const numberDisplay = document.createElement("p")
  numberDisplay.className = "telephone-number"
  numberDisplay.setAttribute("data-dialed-number", "")
  numberDisplay.textContent = "—"

  const formatDialed = (digits: string): string => {
    if (digits.length === 0) return "—"
    const parts = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 10)]
    return parts.filter(p => p.length > 0).join("-")
  }

  const dataSwitch = document.createElement("button")
  dataSwitch.type = "button"
  dataSwitch.setAttribute("data-modem-switch", "")
  dataSwitch.textContent = "Modem: VOICE"

  // The keypad only does anything once the handset is up -- exactly like a
  // real phone, where pressing keys with the handset down does not
  // silently fail, it simply cannot be done. Collected here so `refresh`
  // can enable/disable every key from the one place that tracks state.
  const dialButtons: HTMLButtonElement[] = []

  const refresh = () => {
    status.textContent = telephone.state
    if (telephone.state !== "connected") inDataMode = false
    dataSwitch.textContent = inDataMode ? "Modem: DATA" : "Modem: VOICE"
    numberDisplay.textContent = formatDialed(dialed)
    const canDial = telephone.state !== "on-hook"
    for (const button of dialButtons) button.disabled = !canDial
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
    // A standard touch-tone keypad: 1-2-3 / 4-5-6 / 7-8-9 / *-0-#. Every key
    // plays its true DTMF pair the instant it's pressed -- that's pure
    // audible feedback (`tones.dtmf`) and happens independent of whether
    // the key is one that can actually be dialled. Only the ten digit keys
    // feed `telephone.dial`, which still governs the pulse timing that
    // decides when a number is complete -- `*`/`#` make their tone and do
    // nothing else, exactly as on a real keypad phone.
    const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"]
    for (const key of keys) {
      const btn = document.createElement("button")
      btn.type = "button"
      btn.className = "keypad-key"
      btn.setAttribute("data-dial-digit", key)
      btn.textContent = key
      btn.disabled = telephone.state === "on-hook"
      btn.addEventListener("click", () => {
        tones.dtmf(key)
        if (key === "*" || key === "#") return
        void telephone.dial(key).then(() => {
          dialed += key
          refresh()
          if (dialed.length === 10) {
            const number = `${dialed.slice(0, 3)}-${dialed.slice(3, 6)}-${dialed.slice(6)}`
            onConnected(number)
          }
        })
      })
      dialButtons.push(btn)
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
  wrap.appendChild(numberDisplay)
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
