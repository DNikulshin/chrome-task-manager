import { describe, expect, it } from "vitest";
import { applyPanelEvent, describeOpenError } from "@/lib/panel";

describe("applyPanelEvent", () => {
  it("добавляет окно по opened / port-connected", () => {
    const afterOpened = applyPanelEvent(new Set(), { type: "opened", windowId: 1 });
    expect([...afterOpened]).toEqual([1]);
    expect([...applyPanelEvent(afterOpened, { type: "port-connected", windowId: 2 })]).toEqual([1, 2]);
  });

  it("убирает окно по closed / port-disconnected", () => {
    const open = new Set([1, 2]);
    expect([...applyPanelEvent(open, { type: "closed", windowId: 1 })]).toEqual([2]);
    expect([...applyPanelEvent(open, { type: "port-disconnected", windowId: 2 })]).toEqual([1]);
  });

  it("не мутирует исходное множество", () => {
    const open = new Set([1]);
    applyPanelEvent(open, { type: "opened", windowId: 2 });
    expect([...open]).toEqual([1]);
  });

  it("идемпотентен при повторных событиях", () => {
    const open = applyPanelEvent(applyPanelEvent(new Set(), { type: "opened", windowId: 3 }), {
      type: "opened",
      windowId: 3,
    });
    expect([...open]).toEqual([3]);
  });

  it("сбрасывается целиком", () => {
    expect([...applyPanelEvent(new Set([1, 2, 3]), { type: "reset" })]).toEqual([]);
  });

  it("хранит состояние по окнам независимо", () => {
    let open = applyPanelEvent(new Set(), { type: "opened", windowId: 1 });
    open = applyPanelEvent(open, { type: "opened", windowId: 2 });
    open = applyPanelEvent(open, { type: "closed", windowId: 1 });
    expect(open.has(2)).toBe(true);
    expect(open.has(1)).toBe(false);
  });
});

describe("describeOpenError", () => {
  it("отличает системные страницы от прочих ошибок", () => {
    expect(describeOpenError(new Error("Cannot open side panel on this tab"))).toBe("restricted");
    expect(describeOpenError(new Error("This request requires a user gesture"))).toBe("restricted");
    expect(describeOpenError(new Error("boom"))).toBe("unknown");
    expect(describeOpenError(undefined)).toBe("unknown");
  });
});
