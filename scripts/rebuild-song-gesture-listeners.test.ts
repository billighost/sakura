import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const code = ts.transpileModule(readFileSync(new URL("../src/rebuild/app/SongGesture.tsx", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function fixture() {
  const listeners = new Map<string, Set<(event?: unknown) => void>>();
  const cleanups: (() => void)[] = [];
  const timers = new Map<number, () => void>();
  let deleted = 0, nextTimer = 0, options = 0;
  class Element { closest() { return null; } }
  class HTMLElement extends Element { isContentEditable = false; dataset = new Proxy({}, { deleteProperty: () => { deleted++; return true; } }); }
  const target = (prefix: string) => ({
    addEventListener(name: string, listener: (event?: unknown) => void) { const key = prefix + name, set = listeners.get(key) || new Set(); set.add(listener); listeners.set(key, set); },
    removeEventListener(name: string, listener: (event?: unknown) => void) { listeners.get(prefix + name)?.delete(listener); },
  });
  const exports: { SongGesture?: (props: unknown) => { props: Record<string, unknown> } } = {};
  vm.runInNewContext(code, {
    exports, Element, HTMLElement, navigator: {}, document: target("document:"), window: target("window:"),
    setTimeout(callback: () => void) { timers.set(++nextTimer, callback); return nextTimer; }, clearTimeout(id: number) { timers.delete(id); },
    require(name: string) {
      if (name === "react") return { useRef: (current: unknown) => ({ current }), useEffect: (effect: () => () => void) => cleanups.push(effect()) };
      if (name === "react/jsx-runtime") return { jsx: (_type: unknown, props: Record<string, unknown>) => ({ props }) };
      if (name === "./gestureIntent") return { holdMoved: (x: number, y: number) => Math.hypot(x, y) > 9 };
      return { default: { contextSurface: "surface" } };
    },
  });
  const mount = () => {
    const row = exports.SongGesture!({ id: "fixture", className: "row", onOptions: () => options++ });
    const surface = new HTMLElement();
    (row.props.ref as { current: HTMLElement }).current = surface;
    return { row, surface, down: () => (row.props.onPointerDown as (event: unknown) => void)({ isPrimary: true, pointerType: "touch", button: 0, target: surface, currentTarget: surface, clientX: 0, clientY: 0, pointerId: 1 }) };
  };
  return { mount, count: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0), deleted: () => deleted, options: () => options, fire: (name: string, event?: unknown) => { for (const callback of [...listeners.get(name) || []]) callback(event); }, tick: () => { for (const callback of [...timers.values()]) callback(); }, unmount: () => cleanups.forEach(cleanup => cleanup()) };
}

test("one thousand idle rows register no global cancellation listeners or inactive writes", () => {
  const host = fixture();
  for (let i = 0; i < 1000; i++) host.mount();
  assert.equal(host.count(), 0);
  host.fire("document:scroll");
  assert.equal(host.deleted(), 0);
  host.unmount();
  assert.equal(host.count(), 0);
});

test("active holds own cancellation listeners only until scroll, second finger or unmount", () => {
  for (const cancel of ["document:scroll", "document:pointerdown", "unmount"]) {
    const host = fixture(), row = host.mount();
    row.down(); assert.equal(host.count(), 4);
    if (cancel === "unmount") host.unmount(); else host.fire(cancel, { isPrimary: false });
    assert.equal(host.count(), 0); assert.equal(host.deleted(), 1);
    host.tick(); assert.equal(host.options(), 0);
  }
});

test("a completed hold opens options once and releases its global listeners", () => {
  const host = fixture(), row = host.mount();
  row.down(); host.tick();
  assert.equal(host.options(), 1);
  assert.equal(host.count(), 0);
  host.unmount();
});
