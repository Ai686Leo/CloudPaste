import { EventEmitter } from "events";

export const CACHE_EVENTS = {
  INVALIDATE: "cache.invalidate",
};

const cacheBus = new EventEmitter();
cacheBus.setMaxListeners(50);

export default cacheBus;
