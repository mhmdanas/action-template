import * as core from "@actions/core";
import { Processor } from "./Processor";

async function run() {
    try {
        await new Processor().run();
    } catch (e) {
        core.error(e);
        core.error(e.stack);
        core.setFailed(e.message);
    }
}

run();
