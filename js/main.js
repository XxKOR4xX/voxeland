// js/main.js
// Entry point for modular additions running on top of the engine
// (classic script game.js). Module scripts are deferred, so by the time
// this runs the engine has already executed and window.canvas, win.Key
// and window.player are available to consumers.

import { initTouchControls } from "./controls.js"

initTouchControls()