import type { Destination } from "../destination"

/** CBBS, Chicago. One phone line, from February 1978 into the mid-1980s.
 *  Everyone else gets a busy signal — spec 5.6. */
export const CBBS: Destination = {
  id: "cbbs",
  name: "CBBS",
  number: "312-545-8086",
  eras: [
    {
      from: "1978-02-16",
      until: "1982-12-31",
      lines: 1,
      speeds: [300],
      access: "direct-dial",
      presentationName: "CBBS/Chicago",
      fidelity: "real-software",
      host: "cbbs-host",
    },
    {
      from: "1983-01-01",
      until: "1986-12-31",
      lines: 1,
      speeds: [300, 1200],
      access: "direct-dial",
      presentationName: "CBBS/Chicago",
      fidelity: "real-software",
      host: "cbbs-host",
    },
  ],
}

export const DESTINATIONS: Destination[] = [CBBS]
