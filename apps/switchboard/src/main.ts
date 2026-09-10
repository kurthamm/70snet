import { createSwitchboard } from "./server"

const port = Number(process.env.PORT ?? 8080)
const sb = await createSwitchboard({ port })
console.log(`switchboard listening on ${sb.port}`)
