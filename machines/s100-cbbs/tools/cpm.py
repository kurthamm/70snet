#!/usr/bin/env python3
"""Drive cpmsim's console over a pty.

cpmsim reads the console from stdin and expects a terminal; a plain pipe makes
it spin on zero-length reads. Everything that needs to type at the CP/M prompt
goes through here.
"""
import os, pty, re, select, subprocess, sys, termios, time

class CpmSim:
    def __init__(self, cwd, env=None, quiet=True):
        self.cwd = cwd
        self.env = {**os.environ, **(env or {})}
        self.quiet = quiet
        self.out = bytearray()

    def __enter__(self):
        self.master, slave = pty.openpty()
        # No terminal echo: CBBS echoes every character itself, and a second
        # echo from the pty doubles everything the caller types.
        attrs = termios.tcgetattr(slave)
        attrs[3] &= ~(termios.ECHO | termios.ECHONL)
        termios.tcsetattr(slave, termios.TCSANOW, attrs)
        self.proc = subprocess.Popen(
            ["./cpmsim"], cwd=self.cwd, env=self.env,
            stdin=slave, stdout=slave, stderr=subprocess.DEVNULL, close_fds=True)
        os.close(slave)
        return self

    def __exit__(self, *a):
        try: self.proc.kill()
        except Exception: pass
        os.close(self.master)

    def read(self, seconds):
        """Drain output for `seconds`, returning everything seen so far."""
        end = time.time() + seconds
        while time.time() < end:
            r, _, _ = select.select([self.master], [], [], 0.2)
            if r:
                try: chunk = os.read(self.master, 4096)
                except OSError: break
                if not chunk: break
                self.out += chunk
                if not self.quiet:
                    sys.stdout.write(chunk.decode("latin-1")); sys.stdout.flush()
        return self.text()

    def send(self, s, settle=0.4):
        os.write(self.master, s.encode("latin-1"))
        self.read(settle)

    def type(self, text, cps=15):
        """Type like a person at a terminal, one character at a time.

        CBBS echoes and processes each character as it arrives; shovelling a
        whole line in at once interleaves with its own output and garbles it.
        """
        for ch in text:
            os.write(self.master, ch.encode("latin-1"))
            self.read(1.0 / cps)
        return self.text()

    def command(self, cmd, seconds=60):
        """Send a CP/M command and wait for the prompt to come back.

        Fixed settle delays are not safe here: if the previous command has not
        finished, CP/M eats the first characters of the next one and the
        transfer aborts halfway through a build. Synchronise on the prompt.
        """
        before = len(self.out)
        os.write(self.master, cmd.encode("latin-1"))
        end = time.time() + seconds
        while time.time() < end:
            self.read(0.2)
            tail = self.text()[max(0, before - 4):].rstrip()
            # CP/M prompts are "A>", "B>" ... at the end of the output
            if re.search(r"[A-P]>$", tail):
                return self.text()
        raise TimeoutError(f"no CP/M prompt after {cmd.strip()!r} in {seconds}s")

    def wait_for(self, needle, seconds):
        """Read until `needle` appears. Returns True if it did."""
        end = time.time() + seconds
        while time.time() < end:
            if needle.upper() in self.text().upper():
                return True
            self.read(0.5)
        return needle.upper() in self.text().upper()

    def text(self):
        return self.out.decode("latin-1").replace("\x00", "")
