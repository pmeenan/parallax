import { initializeEngine } from "@parallax/engine";
import { identifyGame } from "@parallax/game";

const identity = identifyGame(initializeEngine());
const status = document.querySelector("#status");

if (status === null) {
  throw new Error("App shell status element is missing");
}

status.textContent = `${identity.name} ${identity.version} / engine ${identity.engine.version}`;
