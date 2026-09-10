#!/usr/bin/env python3
"""Assemble CBBS 3.5 under CP/M with the period LINKASM assembler.

Host files reach CP/M through the auxiliary reader: cpmsim serves
`auxiliaryin.txt` to the reader device and reopens it at EOF, so PIP can pull
one file per host-side swap. No cpmtools, no installs -- the whole toolchain
is in this tree.
"""
import fcntl, os, re, shutil, subprocess, sys, pathlib
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))
from cpm import CpmSim

ROOT = pathlib.Path(__file__).resolve().parent.parent
SIM = ROOT / "vendor/z80pack/cpmsim"
CBBS = ROOT / "cbbs"
AUXIN = "/tmp/.z80pack/cpmsim.auxin"

# The room this disk is built for (spec §5.3: no time travel).
ROOM_DATE = os.environ.get("SEVENTIESNET_DATE", "1980-10-01")

# ROOM_DATE feeds string comparisons in filter_messages() (date <= room_date),
# so a malformed value would silently pick a wrong (or empty) message base
# instead of failing loudly. Require a zero-padded YYYY-MM-DD.
if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", ROOM_DATE):
    raise SystemExit(
        f"SEVENTIESNET_DATE must be a zero-padded YYYY-MM-DD date, got {ROOM_DATE!r}")

# Assembly-time configuration. CBBS supports an outboard serial modem as a
# first-class option (spec §12.2) -- this selects it instead of the PMMI.
EQUATES = [
    (r"^PMMI\tEQU\tTRUE ", "PMMI\tEQU\tFALSE"),
    (r"^SERMODM\tEQU\tFALSE", "SERMODM\tEQU\tTRUE "),
    # The Scitronics clock is emulated at ports 24-27 and reports the ROOM's
    # date, so CBBS stamps its own messages with it (spec §5.3). Turning this
    # off would mean guessing message dates later, which spec §3 calls
    # unrecoverable.
    (r"^CLOCKS\tEQU\tFALSE", "CLOCKS\tEQU\tTRUE "),
]

def configure():
    """Idempotent: re-running the build must not fail on already-set equates."""
    src = (CBBS / "cbbs.asm").read_text(encoding="latin-1")
    for pat, repl in EQUATES:
        if re.search(re.escape(repl), src, flags=re.M):
            continue                      # already configured
        src, n = re.subn(pat, repl, src, count=1, flags=re.M)
        if n != 1:
            raise SystemExit(f"cbbs.asm: expected exactly one {pat!r}, changed {n}")
    (CBBS / "cbbs.asm").write_text(src, encoding="latin-1")
    print("configured cbbs.asm: SERMODM=TRUE, PMMI=FALSE, CLOCKS=TRUE")

# The LINK chain, in the order LINKASM follows it. Only these are needed:
# the unused modem drivers (PMMI, Hayes, IDS) and clock boards are left off
# the disk, because an 8" SSSD volume holds 241K and the full source is more.
# CBBS's own 1980 requirements sheet: "Single 8' OK, dual 8' best."
LINK_CHAIN = [
    "cbbs.asm", "cbbsfunc.asm", "cbbsbye.asm", "cbbssumm.asm", "cbbsent1.asm",
    "cbbsent2.asm", "cbbsrtrv.asm", "cbbsoper.asm", "cbbskill.asm",
    # CBBSDISK links to CBBSCLKS when CLOCKS is TRUE (see EQUATES): the
    # clock driver is part of the chain, not an optional extra. Leave it off
    # and LINKASM stops at "No source file present".
    "cbbsdisk.asm", "cbbsclks.asm", "cbbssub1.asm", "cbbssub2.asm", "cbbssub3.asm",
    "cbbsmodm.asm", "cbbswork.asm",
]

def blank(drive: str):
    (SIM / f"disks/drive{drive}.dsk").unlink(missing_ok=True)
    subprocess.run(["./srctools/mkdskimg", drive], cwd=SIM, check=True)

def serve(path: pathlib.Path):
    """Feed a host file to CP/M's reader device.

    cpmsim is built with PIPES, so the auxiliary port is the FIFO pair in
    /tmp/.z80pack -- not auxiliaryin.txt. A FIFO never reaches EOF, so the
    explicit ^Z is what tells PIP the file has ended. CP/M wants CRLF.
    """
    data = path.read_bytes().replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
    payload = data + b"\x1a"
    if len(payload) > 60000:
        raise SystemExit(f"{path.name} is {len(payload)} bytes; larger than the pipe buffer")
    fd = os.open(AUXIN, os.O_WRONLY | os.O_NONBLOCK)
    try:
        # O_NONBLOCK was only needed for the open() to fail fast if cpmsim
        # isn't reading the FIFO yet. Left on, a write to a full pipe buffer
        # raises BlockingIOError instead of blocking, and the loop below
        # would abort partway through -- silently truncating the transfer.
        # Clear it now so writes block until the whole payload is consumed.
        flags = fcntl.fcntl(fd, fcntl.F_GETFL)
        fcntl.fcntl(fd, fcntl.F_SETFL, flags & ~os.O_NONBLOCK)
        written = 0
        while written < len(payload):
            written += os.write(fd, payload[written:])
    finally:
        os.close(fd)

# The NEXT file's first four lines are fixed-width and CBBS is unforgiving
# about them -- files.doc: "the first 4 lines must appear exactly as they do."
#   <5 byte next message #, leading zeros>
#   <5 byte next caller #, leading spaces>
#   <5 byte active message count>
#   <5 byte maximum active messages>
MAX_ACTIVE = 100

def next_file(count: int, highest: int) -> bytes:
    return (f"{highest + 1:05d}\r\n"
            f"{6:>5}\r\n"
            f"{count:>5}\r\n"
            f"{MAX_ACTIVE:>5}\r\n").encode("latin-1")

def msg_date(rec: bytes):
    """A CBBS message record starts NNNNN,LL,MM/DD/YY,FROM,TO."""
    m = re.match(rb"(\d{5}),(\d+),(\d\d)/(\d\d)/(\d\d),", rec)
    if not m:
        return None
    num = int(m.group(1))
    mm, dd, yy = int(m.group(3)), int(m.group(4)), int(m.group(5))
    year = 1900 + yy if yy >= 70 else 2000 + yy
    return num, f"{year:04d}-{mm:02d}-{dd:02d}"

def filter_messages(raw: bytes, room_date: str):
    """Keep only messages the room's year could have seen.

    Spec §5.3: a room shows messages stamped at or before its own era, and
    nothing later. The archived base runs to December 1981, so the 1980 room
    must not be handed 1981 posts -- CBBS itself will not filter them.
    """
    kept, nums = [], []
    for rec in raw.split(b"\x07"):
        if not rec.strip():
            continue
        d = msg_date(rec)
        if d is None:
            continue
        num, date = d
        if date <= room_date:
            kept.append(rec)
            nums.append(num)
    # CBBS finds the end of a message by the BEL that starts the NEXT one
    # (cbbsrtrv.asm: "each message is preceded by a bell char"). A filtered
    # file whose last kept record is final needs a sentinel BEL, then a CP/M
    # EOF -- without it CBBS prints the message but never "--END OF nnnnn".
    # The sentinel BEL only. serve() supplies the CP/M EOF -- appending one
    # here too leaves a second ^Z in the FIFO, which the NEXT transfer reads
    # as an immediate end-of-file and writes an empty file.
    return b"\x07".join([b""] + kept) + b"\x07", nums

def install_data(s, room_date="1980-10-01"):
    """Put CBBS's data files on the same drive as CBBS.COM (DISKMSG EQU 0
    means the FCB drive is 'current'). The message.x* files are the real
    CBBS message base as it was archived."""
    build = ROOT / "build"
    build.mkdir(exist_ok=True)

    data, all_nums = [], []
    for f in sorted(CBBS.glob("message.x*")):
        body, nums = filter_messages(f.read_bytes(), room_date)
        if not nums:
            continue                      # nothing in this file predates the room
        out = build / f.name.upper()
        out.write_bytes(body)
        data.append((out, f.name.upper()))
        all_nums += nums

    if not all_nums:
        raise SystemExit(f"no messages dated on or before {room_date}")

    nxt = build / "NEXT"
    nxt.write_bytes(next_file(len(all_nums), max(all_nums)))
    data.insert(0, (nxt, "NEXT"))
    data.append((CBBS / "help.idx", "HELP.IDX"))
    print(f"  message base as of {room_date}: "
          f"{len(all_nums)} messages, highest #{max(all_nums)}")

    s.command("A:\r")               # PIP lives on A:, and we may be on C:
    # Clear any previous room's message base. Without this a later build
    # leaves stale files behind and the room shows messages it cannot have.
    s.command("ERA C:MESSAGE.*\r")
    for path, name in data:
        if not path.exists():
            raise SystemExit(f"missing CBBS data file: {path}")
        serve(path)
        s.command(f"PIP C:{name}=RDR:\r")
        if "PIP?" in s.text()[-200:]:
            raise SystemExit(f"PIP not found while transferring {name}")

    # Confirm, rather than trust the absence of an error message. Capture the
    # output length *before* issuing STAT so we check only what STAT itself
    # produced -- checking a tail of the cumulative log can match leftover
    # text from an earlier command instead of this STAT's own output.
    before = len(s.text())
    s.command("A:STAT C:*.*\r")
    new_out = s.text()[before:]
    for _, name in data:
        # records(), not a substring search: a file listed in DIR with 0
        # records is indistinguishable from a real one by name alone, and an
        # empty file here has already broken this build twice before.
        if not records(new_out, name):
            print(new_out[-1200:])
            raise SystemExit(f"FAIL: {name} is not on drive C")
        print(f"  -> C:{name}")

def records(out: str, name: str) -> int:
    """Records reported by STAT for a file. Presence in DIR is not proof --
    an empty file is listed exactly like a real one."""
    # NEXT has no extension (CBBS's own file, ships that way) -- partition()
    # instead of split(".") tolerates that; ext comes back empty for it.
    stem, _, ext = name.partition(".")
    for line in out.splitlines():
        if stem.upper() in line.upper() and (not ext or ext.upper() in line.upper()):
            parts = line.split()
            if parts and parts[0].isdigit():
                return int(parts[0])
    return 0

def main():
    configure()
    blank("b")          # sources
    blank("c")          # assembler output, so B does not run out of room
    (SIM / "disks/drivea.dsk").unlink(missing_ok=True)
    shutil.copy(SIM / "disks/library/cpm22-1.dsk", SIM / "disks/drivea.dsk")

    sources = [CBBS / n for n in LINK_CHAIN]
    missing = [f.name for f in sources if not f.exists()]
    if missing:
        raise SystemExit(f"missing CBBS sources: {missing}")

    with CpmSim(str(SIM)) as s:
        s.read(3)

        for f in sources:
            serve(f)
            s.command(f"PIP B:{f.name.upper()}=RDR:\r")
            if "ERROR" in s.text()[-200:].upper():
                raise SystemExit(f"transfer failed for {f.name}\n{s.text()[-400:]}")
            print(f"  -> B:{f.name.upper()}")

        # LINKASM ships as Intel HEX; LOAD turns it into an executable.
        serve(CBBS / "linkasm.com.hex")
        s.command("PIP B:LINKASM.HEX=RDR:\r")
        s.command("B:\r")
        s.command("A:LOAD LINKASM\r")

        # LINKASM CBBS.SHP -- source drive, hex drive, prn drive (Z = none).
        print("assembling (this follows the LINK chain through 20+ files)...")
        s.command("LINKASM CBBS.BCZ\r", seconds=600)
        s.command("A:STAT C:CBBS.HEX\r")
        out = s.text()
        (ROOT / "build.log").write_text(out, encoding="latin-1")

        if "OUTPUT FILE WRITE ERROR" in out.upper():
            raise SystemExit("FAIL: assembler ran out of disk -- see build.log")
        if not records(out, "CBBS.HEX"):
            print(out[-2500:])
            raise SystemExit("FAIL: LINKASM produced no CBBS.HEX -- see build.log")

        s.command("C:\r")
        s.command("A:LOAD CBBS\r")
        s.command("A:STAT C:CBBS.COM\r")
        out = s.text()
        (ROOT / "build.log").write_text(out, encoding="latin-1")

        recs = records(out, "CBBS.COM")
        if not recs:
            print(out[-2500:])
            raise SystemExit("FAIL: CBBS.COM is empty or missing -- see build.log")
        print(f"CBBS.COM: {recs} records ({recs * 128} bytes)")

        install_data(s, ROOM_DATE)
        (ROOT / "disks").mkdir(exist_ok=True)
        shutil.copy(SIM / "disks/drivec.dsk", ROOT / "disks/cbbs-drive-c.dsk")

    print("OK: CBBS.COM built from the 1981 source")

if __name__ == "__main__":
    main()
