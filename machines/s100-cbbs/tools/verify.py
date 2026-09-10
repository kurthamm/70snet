#!/usr/bin/env python3
"""Spec §11's gate: the archived source assembles, and the result answers a call.

Asserts four things, in order of what they prove:

  1. It is the real program          -- CBBS(R) 3.5.0 banner
  2. It talks to a caller            -- the login sequence
  3. Its message base works          -- retrieves a real 1978 message
  4. It obeys the timeline (§5.3)    -- a 1981 message is NOT reachable
                                        from the 1980 room

The telephone line is the machine's CONSOLE. CBBS does terminal I/O through
the CP/M BIOS console vectors (TYPE in cbbssub2.asm calls an address patched
in by INIT), and on Randy Suess's machine that console was the modem.
cbbsmodm.asm's SERLCTL/SERLDAT only initialise the card; carrier and off-hook
live on port 0FFH.
"""
import os, sys, pathlib
sys.path.insert(0, os.path.dirname(__file__))
from cpm import CpmSim

ROOT = pathlib.Path(__file__).resolve().parent.parent
SIM = ROOT / "vendor/z80pack/cpmsim"

IN_PERIOD = "2"      # 02/07/78, Ward and Randy
AFTER_ROOM = "17"    # 11/21/81 -- exists in the archive, not in this room

def fail(msg, text):
    print(f"FAIL: {msg}")
    print(text[-900:])
    return 1

def main():
    with CpmSim(str(SIM)) as s:
        s.read(3)
        s.send("C:\r", settle=1)
        s.send("CBBS\r", settle=6)
        if not s.wait_for("CBBS(R) 3.5.0", 25):
            return fail("no CBBS banner", s.text())

        s.wait_for("FIRST TIME", 20); s.type("N\r")
        s.wait_for("FIRST NAME", 15); s.type("KURT\r")
        s.wait_for("LAST NAME", 15);  s.type("HAMM\r")
        if not s.wait_for("ACTIVE MSGS", 20):
            return fail("never reached the login summary", s.text())
        if not s.wait_for("FUNCTION", 15):
            return fail("no function menu", s.text())

        s.type("R\r"); s.wait_for("RETRIEVE", 15)
        s.type(f"{IN_PERIOD}\r")
        if not s.wait_for("--END OF", 20):
            return fail(f"could not retrieve message {IN_PERIOD}", s.text())
        in_period = s.text()

        s.type(f"{AFTER_ROOM}\r"); s.read(6)
        text = s.text()

    (ROOT / "verify.log").write_text(text, encoding="latin-1")

    if "02/07/78" not in in_period:
        return fail("retrieved message was not the archived 1978 one", in_period)

    after = text[len(in_period):]
    if f"NO MSG" not in after.upper():
        return fail(
            f"message {AFTER_ROOM} (11/21/81) is reachable from the 1980 room; "
            "spec §5.3 forbids time travel", after)

    print("PASS: CBBS 3.5.0, assembled from the 1981 source, answered a call")
    print("      and served a message from February 1978.")
    print("      A November 1981 message is correctly out of reach (§5.3).")
    i = in_period.find("MSG 00002")
    if i == -1:
        return fail("MSG 00002 marker not found in retrieved message", in_period)
    print("-" * 64)
    print(in_period[i:i + 400])
    return 0

if __name__ == "__main__":
    sys.exit(main())
