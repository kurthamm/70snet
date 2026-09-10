#!/usr/bin/env python3
"""Spec §11's persistence gate, and the other half of §5.3.

Posts a message as a visitor, stops the machine entirely, restarts it, and
reads the message back. Asserts two things:

  1. The message survived -- it lives on the emulated disk, not in RAM.
  2. CBBS stamped it with the ROOM's date, not today's. The date comes from
     the emulated Scitronics clock (ports 24-27), so the timeline is produced
     by the 1981 software rather than written on top of it by us.

Runs against a copy of the disk so the gate stays deterministic.
"""
import os, shutil, sys, pathlib
sys.path.insert(0, os.path.dirname(__file__))
from cpm import CpmSim

ROOT = pathlib.Path(__file__).resolve().parent.parent
SIM = ROOT / "vendor/z80pack/cpmsim"
ROOM_DATE = os.environ.get("SEVENTIESNET_DATE", "1980-10-01")
EXPECTED_STAMP = f"{ROOM_DATE[5:7]}/{ROOM_DATE[8:10]}/{ROOM_DATE[2:4]}"

SUBJECT = "HELLO FROM 1980"
BODY = "THIS MESSAGE MUST OUTLIVE THE MACHINE."

def login(s):
    s.read(3)
    s.send("C:\r", settle=1)
    s.send("CBBS\r", settle=6)
    if not s.wait_for("FIRST TIME", 25):
        raise SystemExit("FAIL: CBBS did not start")
    s.type("N\r")
    s.wait_for("FIRST NAME", 15); s.type("KURT\r")
    s.wait_for("LAST NAME", 15);  s.type("HAMM\r")
    if not s.wait_for("FUNCTION", 25):
        raise SystemExit("FAIL: never reached the function menu")

def main():
    env = {"SEVENTIESNET_DATE": ROOM_DATE}
    disk = SIM / "disks/drivec.dsk"
    backup = SIM / "disks/drivec.persist.bak"
    shutil.copy(disk, backup)

    try:
        with CpmSim(str(SIM), env=env) as s:
            login(s)
            s.type("E\r")
            s.wait_for("WHO TO", 15);  s.type("ALL\r")
            s.wait_for("SUBJECT", 15); s.type(f"{SUBJECT}\r")
            s.wait_for("PASSWORD", 15); s.type("\r")
            # CBBS offers a walkthrough, then asks the question spec §7.2
            # cites: whether the caller's terminal can show lower case. An
            # Apple II+ cannot, so the answer is always N and the board
            # switches to upper case for the rest of the call.
            s.wait_for("HELP", 15); s.type("N\r")
            s.wait_for("LOWER CASE", 15); s.type("N\r")
            if not s.wait_for("WHEN DONE ENTERING", 15):
                raise SystemExit("FAIL: never reached message body entry")
            s.type(f"{BODY}\r")     # line 01
            s.type("\r")            # a second return ends the message
            # Entry is not the same as saving: CBBS offers an edit menu and
            # the message only reaches the disk on an explicit S.
            if not s.wait_for("A,C,D,E,G,H,I,L,R,S", 20):
                raise SystemExit("FAIL: never reached the save menu")
            s.type("S\r")
            if not s.wait_for("FUNCTION", 20):
                raise SystemExit("FAIL: save did not return to the menu")

        # The machine is now gone. Everything must come from the disk.
        with CpmSim(str(SIM), env=env) as s:
            login(s)
            s.type("R\r")
            s.wait_for("RETRIEVE", 15)
            s.type("10\r")
            s.wait_for("--END OF", 20)
            read_back = s.text()
    finally:
        shutil.copy(backup, disk)
        backup.unlink()

    (ROOT / "persist.log").write_text(read_back, encoding="latin-1")

    if BODY not in read_back.upper():
        print("FAIL: the posted message did not survive a restart")
        print(read_back[-900:])
        return 1
    if EXPECTED_STAMP not in read_back:
        print(f"FAIL: message not stamped {EXPECTED_STAMP} (the room's date)")
        print(read_back[-900:])
        return 1

    print(f"PASS: a message posted in the {ROOM_DATE} room survived a restart")
    print(f"      and CBBS stamped it {EXPECTED_STAMP} from the emulated clock.")
    i = read_back.find("MSG 00010")
    if i < 0:
        print("FAIL: could not locate the message header to display")
        return 1
    print("-" * 64)
    print(read_back[i:i + 400])
    return 0

if __name__ == "__main__":
    sys.exit(main())
