// macOS IME switches can commit an extra ASCII space. Require both a composition
// and an explicit switch key; never trim normal typing, candidate selection or paste.
const SWITCH_WINDOW_MS = 500;
type Candidate = { value: string; cursor: number; data: string };
export class ImeSwitchState {
  composing = false;
  private endedAt = -Infinity;
  private switchedAt = -Infinity;
  private spaceAt = -Infinity;
  private handled = false;
  candidate: Candidate | null = null;
  start() {
    this.composing = true;
    this.endedAt = this.switchedAt = this.spaceAt = -Infinity;
    this.handled = false;
    this.candidate = null;
  }
  end(now: number) { this.composing = false; this.endedAt = now; }
  key(key: string, code: string, down: boolean, now: number, isComposing = false) {
    if (down && (key === " " || code === "Space")) { this.spaceAt = now; return; }
    const switching = key === "Shift" || key === "CapsLock" || code === "CapsLock" || code === "ShiftLeft" || code === "ShiftRight";
    if (switching && (this.composing || now - this.endedAt <= SWITCH_WINDOW_MS)) {
      if (!Number.isFinite(this.switchedAt)) this.switchedAt = now;
    } else if (down && !isComposing && key !== "Process" && !["Control", "Alt", "Meta"].includes(key)) {
      this.reset();
    }
  }
  reset() {
    this.composing = false;
    this.endedAt = this.switchedAt = this.spaceAt = -Infinity;
    this.handled = false;
    this.candidate = null;
  }
  normalize(data: string, now: number): string {
    if (this.composing || this.handled || !Number.isFinite(this.switchedAt) ||
      now - this.endedAt > SWITCH_WINDOW_MS || now - this.switchedAt > SWITCH_WINDOW_MS ||
      this.spaceAt >= this.switchedAt || !/^[\x20-\x7e]* $/.test(data)) return data;
    this.handled = true;
    return data.slice(0, -1);
  }
}

const states = new WeakMap<Element, ImeSwitchState>();
const stateFor = (element: Element) => {
  let state = states.get(element);
  if (!state) { state = new ImeSwitchState(); states.set(element, state); }
  return state;
};
export function normalizeTerminalImeData(element: Element | undefined, data: string): string {
  return element ? stateFor(element).normalize(data, Date.now()) : data;
}

type TextControl = HTMLInputElement | HTMLTextAreaElement;
function control(target: EventTarget | null): TextControl | null {
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return null;
  return target;
}
function isTerminal(element: TextControl) { return element.classList.contains("xterm-helper-textarea"); }
function textIntent(event: InputEvent) {
  return ["insertText", "insertCompositionText", "insertFromComposition"].includes(event.inputType);
}

export function installInputMethodGuard(root: Document = document): () => void {
  let correcting = false;
  const before = new WeakMap<TextControl, { value: string; start: number; end: number }>();
  const prepare = (element: TextControl) => {
    element.setAttribute("autocorrect", "off");
    element.setAttribute("autocapitalize", "none");
    element.setAttribute("spellcheck", "false");
  };
  const correct = (element: TextControl, state: ImeSwitchState, notify: boolean) => {
    const candidate = state.candidate;
    if (!candidate || isTerminal(element) || element.value !== candidate.value ||
      element.selectionStart !== candidate.cursor || element.selectionEnd !== candidate.cursor) return;
    if (state.normalize(candidate.data, Date.now()) === candidate.data) return;
    const position = candidate.cursor - 1;
    const value = element.value.slice(0, position) + element.value.slice(position + 1);
    // Use the native setter so a late correction also reaches React controlled inputs.
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (!setter) return;
    setter.call(element, value);
    element.setSelectionRange(position, position);
    state.candidate = null;
    if (notify) {
      correcting = true;
      try { element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" })); }
      finally { correcting = false; }
    }
  };
  const onFocus = (event: Event) => { const element = control(event.target); if (element) prepare(element); };
  const onBlur = (event: Event) => { const element = control(event.target); if (element) { stateFor(element).reset(); before.delete(element); } };
  const onKey = (event: Event) => {
    const element = control(event.target); if (!element) return;
    const key = event as KeyboardEvent;
    const state = stateFor(element);
    state.key(key.key, key.code, event.type === "keydown", Date.now(), key.isComposing || key.keyCode === 229);
    correct(element, state, true);
  };
  const onComposition = (event: Event) => {
    const element = control(event.target); if (!element) return;
    const state = stateFor(element);
    if (event.type === "compositionstart") state.start();
    else {
      state.end(Date.now());
      // WebKit may commit into the DOM before or after compositionend.
      const data = (event as CompositionEvent).data;
      const cursor = element.selectionStart;
      if (!isTerminal(element) && cursor != null && cursor === element.selectionEnd &&
        data && element.value.slice(cursor - data.length, cursor) === data) {
        state.candidate = { value: element.value, cursor, data };
      }
      correct(element, state, true);
    }
  };
  const onBeforeInput = (event: Event) => {
    const element = control(event.target); if (!element || isTerminal(element)) return;
    const input = event as InputEvent;
    if (!textIntent(input)) { stateFor(element).reset(); before.delete(element); return; }
    if (element.selectionStart != null && element.selectionEnd != null) {
      before.set(element, { value: element.value, start: element.selectionStart, end: element.selectionEnd });
    }
  };
  const onInput = (event: Event) => {
    if (correcting) return;
    const element = control(event.target); if (!element || isTerminal(element)) return;
    const input = event as InputEvent;
    const state = stateFor(element);
    state.candidate = null;
    if (!textIntent(input)) { state.reset(); before.delete(element); return; }
    let data = input.data;
    const previous = before.get(element);
    before.delete(element);
    if (data == null && previous) {
      const prefix = previous.value.slice(0, previous.start);
      const suffix = previous.value.slice(previous.end);
      if (element.value.startsWith(prefix) && element.value.endsWith(suffix) && element.value.length >= prefix.length + suffix.length) {
        data = element.value.slice(prefix.length, element.value.length - suffix.length);
      }
    }
    const cursor = element.selectionStart;
    if (!data || cursor == null || cursor !== element.selectionEnd ||
      element.value.slice(cursor - data.length, cursor) !== data) return;
    state.candidate = { value: element.value, cursor, data };
    correct(element, state, false);
  };
  const onPaste = (event: Event) => { const element = control(event.target); if (element) stateFor(element).reset(); };
  const listeners: [string, EventListener][] = [
    ["focusin", onFocus], ["focusout", onBlur], ["keydown", onKey], ["keyup", onKey],
    ["compositionstart", onComposition], ["compositionend", onComposition],
    ["beforeinput", onBeforeInput], ["input", onInput], ["paste", onPaste], ["drop", onPaste],
  ];
  listeners.forEach(([type, listener]) => root.addEventListener(type, listener, true));
  root.querySelectorAll("input, textarea").forEach(element => prepare(element as TextControl));
  return () => listeners.forEach(([type, listener]) => root.removeEventListener(type, listener, true));
}
