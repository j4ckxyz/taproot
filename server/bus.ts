import { EventEmitter } from 'node:events';

/** In-process events: `project:<id>` for changes, `presence:<id>` for who is looking. */
export const bus = new EventEmitter();
bus.setMaxListeners(0);
