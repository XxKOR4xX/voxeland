(() => {
  // OneDrive/Desktop/VOXELAND/js/controls.js
  var HALF_PI = Math.PI / 2;
  var TWO_PI = Math.PI * 2;
  var KEY_BUTTONS = [
    { id: "btn-jump", key: " ", code: "Space" },
    { id: "btn-sneak", key: "shift", code: "ShiftLeft" },
    { id: "btn-sprint", key: "q", code: "KeyQ" }
  ];
  var MOUSE_BUTTONS = [
    { id: "btn-attack", keyName: "leftMouse", cooldown: "lastBreak" },
    { id: "btn-place", keyName: "rightMouse", cooldown: "lastPlace" }
  ];
  var DIR_KEYS = ["w", "a", "s", "d"];
  var DIR_CODES = { w: "KeyW", a: "KeyA", s: "KeyS", d: "KeyD" };
  var TouchController = class {
    constructor(options) {
      var o = options || {};
      this.deadZone = o.deadZone !== void 0 ? o.deadZone : 0.25;
      this.engageAt = o.engageAt !== void 0 ? o.engageAt : 0.4;
      this.releaseAt = o.releaseAt !== void 0 ? o.releaseAt : 0.25;
      this.sprintEngageAt = o.sprintEngageAt !== void 0 ? o.sprintEngageAt : -0.95;
      this.sprintReleaseAt = o.sprintReleaseAt !== void 0 ? o.sprintReleaseAt : -0.8;
      this.lookSensitivity = o.lookSensitivity || 5e-3;
      this.joyRadius = 50;
      this.attached = false;
      this.els = {};
      this._listeners = [];
      this.joyTouchId = null;
      this.joyCenter = { x: 0, y: 0 };
      this.dirActive = { w: false, a: false, s: false, d: false };
      this.sprintActive = false;
      this.lookTouchId = null;
      this.lookLast = null;
    }
    get isTouchDevice() {
      if (/[?&]touch=1/.test(window.location.search)) return true;
      return window.matchMedia && window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window || (navigator.maxTouchPoints || 0) > 0;
    }
    attach() {
      if (this.attached) return this;
      var root = document.getElementById("touch-ui");
      if (!root) {
        console.warn("[TouchController] #touch-ui not found; touch controls disabled.");
        return null;
      }
      this.els.root = root;
      this.els.joyBase = document.getElementById("joystick-base");
      this.els.joyThumb = document.getElementById("joystick-thumb");
      this.els.hotbar = document.getElementById("touch-hotbar");
      this.bindJoystick();
      this.bindKeyButtons();
      this.bindMouseButtons();
      this.bindLook();
      this.bindHotbar();
      if (this.isTouchDevice) {
        root.classList.remove("hidden");
        console.log("[TouchController] visible (touch device or ?touch=1)");
      } else {
        console.log("[TouchController] hidden (non-touch device). Open index.html?touch=1 to force the touch UI.");
      }
      this.attached = true;
      return this;
    }
    detach() {
      this.resetJoystick();
      var i;
      for (i = 0; i < KEY_BUTTONS.length; i++) this.emitKey(KEY_BUTTONS[i].key, false, KEY_BUTTONS[i].code);
      for (i = 0; i < MOUSE_BUTTONS.length; i++) this.setMouse(MOUSE_BUTTONS[i], false);
      for (i = 0; i < this._listeners.length; i++) {
        var l = this._listeners[i];
        l.el.removeEventListener(l.type, l.fn, l.opts);
      }
      this._listeners = [];
      this.attached = false;
      return this;
    }
    // ------------------------------------------------------------- helpers
    addListener(el, type, fn) {
      el.addEventListener(type, fn, { passive: false });
      this._listeners.push({ el, type, fn, opts: { passive: false } });
    }
    findTouch(event, id) {
      var list = event.changedTouches;
      for (var i = 0; i < list.length; i++) {
        if (list[i].identifier === id) return list[i];
      }
      return null;
    }
    // Synthetic key: dispatched on window.canvas so the engine's own
    // canvas.onkeydown / canvas.onkeyup handlers process it.
    emitKey(key, isDown, code) {
      var target = window.canvas;
      if (!target) return;
      var ev = new KeyboardEvent(isDown ? "keydown" : "keyup", {
        key,
        code: code || "",
        bubbles: false,
        cancelable: true
      });
      target.dispatchEvent(ev);
    }
    // Mouse state flip: the engine tick already handles held buttons with
    // its own cooldown gating, so this is all an action button needs.
    setMouse(button, isDown) {
      if (!window.Key) return;
      window.Key[button.keyName] = isDown;
      if (isDown && window.player && button.cooldown) {
        window.player[button.cooldown] = 0;
      }
    }
    // ------------------------------------------------------------- joystick
    bindJoystick() {
      var self = this;
      var base = this.els.joyBase;
      if (!base) return;
      var start = function(e) {
        e.preventDefault();
        if (self.joyTouchId !== null) return;
        var rect = base.getBoundingClientRect();
        self.joyCenter.x = rect.left + rect.width / 2;
        self.joyCenter.y = rect.top + rect.height / 2;
        self.joyRadius = rect.width / 2 - 20;
        var t = e.changedTouches[0];
        self.joyTouchId = t.identifier;
        self.moveThumb(t.clientX, t.clientY);
      };
      var move = function(e) {
        e.preventDefault();
        if (self.joyTouchId === null) return;
        var t = self.findTouch(e, self.joyTouchId);
        if (t) self.moveThumb(t.clientX, t.clientY);
      };
      var end = function(e) {
        e.preventDefault();
        if (self.joyTouchId === null) return;
        if (self.findTouch(e, self.joyTouchId)) {
          self.joyTouchId = null;
          self.resetJoystick();
        }
      };
      this.addListener(base, "touchstart", start);
      this.addListener(base, "touchmove", move);
      this.addListener(base, "touchend", end);
      this.addListener(base, "touchcancel", end);
    }
    moveThumb(x, y) {
      var dx = x - this.joyCenter.x;
      var dy = y - this.joyCenter.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var r = this.joyRadius;
      var ndx = dx;
      var ndy = dy;
      if (dist > r) {
        ndx = dx / dist * r;
        ndy = dy / dist * r;
      }
      var thumb = this.els.joyThumb;
      if (thumb) {
        thumb.style.transform = "translate(" + ndx.toFixed(1) + "px," + ndy.toFixed(1) + "px)";
      }
      if (dist < r * this.deadZone) {
        this.releaseAllDirs();
        this.setSprintFromJoystick(0);
        return;
      }
      var nx = ndx / r;
      var ny = ndy / r;
      this.applyAxis("w", "s", ny);
      this.applyAxis("a", "d", nx);
      this.setSprintFromJoystick(ny);
    }
    // axis in [-1, 1]. negKey fires on the negative side, posKey on the positive.
    applyAxis(negKey, posKey, axis) {
      var negOn = this.dirActive[negKey];
      var posOn = this.dirActive[posKey];
      if (axis <= -this.engageAt) negOn = true;
      else if (axis > -this.releaseAt) negOn = false;
      if (axis >= this.engageAt) posOn = true;
      else if (axis < this.releaseAt) posOn = false;
      this.setDirKey(negKey, negOn);
      this.setDirKey(posKey, posOn);
    }
    setDirKey(key, on) {
      var engineOn = window.Key ? !!window.Key[key] : false;
      if (on) {
        if (!this.dirActive[key] || !engineOn) {
          this.dirActive[key] = true;
          this.emitKey(key, true, DIR_CODES[key]);
        }
      } else if (this.dirActive[key]) {
        this.dirActive[key] = false;
        if (engineOn) this.emitKey(key, false, DIR_CODES[key]);
      }
    }
    // Bedrock "Sprint using the joystick": holding the knob at the top edge
    // keeps the sprint key (q) down; leaving the zone releases it. The engine
    // itself keeps sprinting while there is forward movement (game.js:3940).
    setSprintFromJoystick(ny) {
      var on;
      if (ny <= this.sprintEngageAt) on = true;
      else if (ny > this.sprintReleaseAt) on = false;
      else on = this.sprintActive;
      var engineOn = window.Key ? !!window.Key.q : false;
      if (on) {
        if (!this.sprintActive || !engineOn) {
          this.sprintActive = true;
          this.emitKey("q", true, "KeyQ");
        }
      } else if (this.sprintActive) {
        this.sprintActive = false;
        if (engineOn) this.emitKey("q", false, "KeyQ");
      }
    }
    releaseAllDirs() {
      for (var i = 0; i < DIR_KEYS.length; i++) this.setDirKey(DIR_KEYS[i], false);
    }
    resetJoystick() {
      var thumb = this.els.joyThumb;
      if (thumb) thumb.style.transform = "translate(0px,0px)";
      this.releaseAllDirs();
      this.setSprintFromJoystick(0);
    }
    // ------------------------------------------------------------- buttons
    bindKeyButtons() {
      var self = this;
      for (var i = 0; i < KEY_BUTTONS.length; i++) {
        (function(btn) {
          var el = document.getElementById(btn.id);
          if (!el) return;
          var activeId = null;
          self.addListener(el, "touchstart", function(e) {
            e.preventDefault();
            if (activeId !== null) return;
            var t = e.changedTouches[0];
            activeId = t.identifier;
            el.classList.add("pressed");
            self.emitKey(btn.key, true, btn.code);
          });
          var end = function(e) {
            e.preventDefault();
            if (activeId === null) return;
            if (!self.findTouch(e, activeId)) return;
            activeId = null;
            el.classList.remove("pressed");
            self.emitKey(btn.key, false, btn.code);
          };
          self.addListener(el, "touchend", end);
          self.addListener(el, "touchcancel", end);
        })(KEY_BUTTONS[i]);
      }
    }
    bindMouseButtons() {
      var self = this;
      for (var i = 0; i < MOUSE_BUTTONS.length; i++) {
        (function(btn) {
          var el = document.getElementById(btn.id);
          if (!el) return;
          var activeId = null;
          self.addListener(el, "touchstart", function(e) {
            e.preventDefault();
            if (activeId !== null) return;
            var t = e.changedTouches[0];
            activeId = t.identifier;
            el.classList.add("pressed");
            self.setMouse(btn, true);
          });
          var end = function(e) {
            e.preventDefault();
            if (activeId === null) return;
            if (!self.findTouch(e, activeId)) return;
            activeId = null;
            el.classList.remove("pressed");
            self.setMouse(btn, false);
          };
          self.addListener(el, "touchend", end);
          self.addListener(el, "touchcancel", end);
        })(MOUSE_BUTTONS[i]);
      }
    }
    // ------------------------------------------------------------- look pad
    // Drag anywhere on the game canvas to rotate the camera. Taps are left
    // untouched so menu buttons keep working on mobile.
    bindLook() {
      var self = this;
      var canvas = window.canvas;
      if (!canvas) return;
      var start = function(e) {
        if (self.lookTouchId !== null) return;
        var t = e.changedTouches[0];
        self.lookTouchId = t.identifier;
        self.lookLast = { x: t.clientX, y: t.clientY };
      };
      var move = function(e) {
        e.preventDefault();
        if (self.lookTouchId === null) return;
        var t = self.findTouch(e, self.lookTouchId);
        if (!t) return;
        var p = window.player;
        var dx = 0;
        var dy = 0;
        if (self.lookLast) {
          dx = t.clientX - self.lookLast.x;
          dy = t.clientY - self.lookLast.y;
        }
        self.lookLast = { x: t.clientX, y: t.clientY };
        if (!p) return;
        p.ry += dx * self.lookSensitivity;
        p.rx -= dy * self.lookSensitivity;
        while (p.ry >= TWO_PI) p.ry -= TWO_PI;
        while (p.ry < 0) p.ry += TWO_PI;
        if (p.rx > HALF_PI) p.rx = HALF_PI;
        if (p.rx < -HALF_PI) p.rx = -HALF_PI;
      };
      var end = function(e) {
        if (self.lookTouchId === null) return;
        if (self.findTouch(e, self.lookTouchId)) {
          self.lookTouchId = null;
          self.lookLast = null;
        }
      };
      this.addListener(canvas, "touchstart", start);
      this.addListener(canvas, "touchmove", move);
      this.addListener(canvas, "touchend", end);
      this.addListener(canvas, "touchcancel", end);
    }
    // ------------------------------------------------------------- hotbar
    bindHotbar() {
      var self = this;
      var bar = this.els.hotbar;
      if (!bar) return;
      var slots = bar.children;
      for (var i = 0; i < slots.length; i++) {
        (function(slot, n) {
          var key = String(n);
          self.addListener(slot, "touchstart", function(e) {
            e.preventDefault();
            slot.classList.add("pressed");
            self.emitKey(key, true, "Digit" + key);
            self.emitKey(key, false, "Digit" + key);
            setTimeout(function() {
              slot.classList.remove("pressed");
            }, 150);
          });
        })(slots[i], i + 1);
      }
    }
  };
  function initTouchControls(options) {
    return new TouchController(options).attach();
  }

  // OneDrive/Desktop/VOXELAND/js/main.js
  initTouchControls();
})();
