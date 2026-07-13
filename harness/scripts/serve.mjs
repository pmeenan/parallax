import { resolve } from "node:path";
import { parseServerPort } from "../dist/types/config.js";
import { createLocalServer } from "../dist/types/server.js";

const root = resolve(import.meta.dirname, "../../dist");
const port = parseServerPort(process.env.PORT);
const server = createLocalServer({ root });

server.listen(port, "127.0.0.1", () => {
  console.log(`Parallax local build: http://127.0.0.1:${port}`);
});
