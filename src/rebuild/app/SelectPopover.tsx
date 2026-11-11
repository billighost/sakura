"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import s from "./select-popover.module.css";

export interface SelectOption<T extends string | number = string> {
  value: T;
  label: string;
  description?: string;
  disabled?: boolean;
}

/** A select-only combobox. DOM focus stays on its trigger, including inside dialogs. */
export function SelectPopover<T extends string | number>({ value, onChange, options, label, id, name, disabled = false, className = "", description }: {
  value: T;
  onChange: (value: T) => void;
  options: readonly SelectOption<T>[];
  label: string;
  id?: string;
  name?: string;
  disabled?: boolean;
  className?: string;
  description?: string;
}) {
  const generated = useId();
  const controlId = id || generated;
  const listId = controlId + "-choices";
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const search = useRef({ text: "", at: 0 });
  const [open, setOpen] = useState(false);
  const selected = Math.max(0, options.findIndex(option => option.value === value));
  const [active, setActive] = useState(selected);
  const close = () => setOpen(false);

  function reveal(index = selected) {
    if (disabled || !options.length) return;
    setActive(index);
    setOpen(true);
  }
  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    close();
    trigger.current?.focus({ preventScroll: true });
  }
  function nextEnabled(from: number, direction: number) {
    for (let at = from; at >= 0 && at < options.length; at += direction) {
      if (!options[at].disabled) return at;
    }
    return active;
  }
  function keyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        event.stopPropagation();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        if (!open) reveal(selected);
        else setActive(nextEnabled(active + direction, direction));
        break;
      }
      case "Home":
      case "End": {
        event.preventDefault();
        event.stopPropagation();
        const first = event.key === "Home";
        reveal(nextEnabled(first ? 0 : options.length - 1, first ? 1 : -1));
        break;
      }
      case "Enter":
      case " ":
        event.preventDefault();
        event.stopPropagation();
        if (open) choose(active); else reveal();
        break;
      case "Escape":
        if (open) { event.preventDefault(); event.stopPropagation(); close(); }
        break;
      case "Tab":
        close();
        break;
      default: {
        if (event.key.length !== 1 || /\s/.test(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        const now = Date.now(), key = event.key.toLocaleLowerCase();
        const previous = now - search.current.at < 700 ? search.current.text : "";
        const typed = previous && [...previous].every(char => char === key) ? key : previous + key;
        search.current = { text: typed, at: now };
        const start = typed.length === 1 ? (open ? active : selected) + 1 : (open ? active : selected);
        for (let offset = 0; offset < options.length; offset++) {
          const index = (start + offset) % options.length, option = options[index];
          if (!option.disabled && option.label.toLocaleLowerCase().startsWith(typed)) { reveal(index); break; }
        }
      }
    }
  }

  useEffect(() => {
    if (!open) return;
    const button = trigger.current, list = popup.current;
    if (!button || !list) return;
    // The top layer keeps choices visible above overflow and native modal dialogs.
    const topLayer = typeof list.showPopover === "function";
    if (topLayer) list.showPopover();
    function position() {
      if (!button || !list) return;
      const rect = button.getBoundingClientRect(), viewport = window.visualViewport;
      const leftEdge = viewport?.offsetLeft || 0, topEdge = viewport?.offsetTop || 0;
      const width = viewport?.width || window.innerWidth, height = viewport?.height || window.innerHeight;
      const listWidth = Math.min(Math.max(rect.width, 244), width - 24);
      const below = topEdge + height - rect.bottom - 18, above = rect.top - topEdge - 18;
      const upwards = below < Math.min(300, list.scrollHeight) && above > below;
      const maxHeight = Math.max(88, Math.min(356, upwards ? above : below));
      list.style.width = listWidth + "px";
      list.style.maxHeight = maxHeight + "px";
      list.style.left = Math.max(leftEdge + 12, Math.min(rect.left, leftEdge + width - listWidth - 12)) + "px";
      list.style.top = (upwards ? rect.top - Math.min(list.scrollHeight, maxHeight) - 8 : rect.bottom + 8) + "px";
      list.dataset.direction = upwards ? "up" : "down";
    }
    function outside(event: PointerEvent) {
      if (!event.composedPath().includes(button!) && !event.composedPath().includes(list!)) close();
    }
    function focus(event: FocusEvent) {
      if (!button?.contains(event.target as Node) && !list?.contains(event.target as Node)) close();
    }
    position();
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", focus);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", focus);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      window.visualViewport?.removeEventListener("resize", position);
      if (topLayer && list.matches(":popover-open")) list.hidePopover();
    };
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(listId + "-" + active)?.scrollIntoView({ block: "nearest" });
  }, [open, active, listId]);

  return <span className={`${s.control} ${className}`} data-select-control>
    <button ref={trigger} id={controlId} type="button" role="combobox" aria-label={label} aria-expanded={open} aria-controls={listId} aria-haspopup="listbox" aria-activedescendant={open ? listId + "-" + active : undefined} aria-describedby={description ? controlId + "-description" : undefined} disabled={disabled || !options.length} className={s.trigger} onKeyDown={keyDown} onClick={() => open ? close() : reveal()}>
      <span dir="auto">{options[selected]?.label || "Choose"}</span>
      <svg className={s.branch} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4c-1 5 1 10 0 16M5 9c1 4 4 6 7 6 4-1 6-3 7-6M12 9c-4-1-6-4-5-6 4 0 6 2 5 6"/></svg>
    </button>
    {description && <span className={s.srOnly} id={controlId + "-description"}>{description}</span>}
    {name && <input type="hidden" name={name} value={value}/>}
    {open && <div ref={popup} popover="manual" role="listbox" id={listId} aria-label={label} className={s.popup} onPointerDown={event => {if(event.pointerType === "mouse")event.preventDefault();}}>
      <div className={s.heading} aria-hidden="true"><span>{label}</span><svg viewBox="0 0 120 14" fill="none"><path d="M0 9C25 0 45 15 68 7s33 0 52-4M96 6c1-5 6-7 10-5-1 5-5 7-10 5"/></svg></div>
      {options.map((option, index) => <div key={option.value} id={listId + "-" + index} role="option" aria-selected={option.value === value} aria-disabled={option.disabled || undefined} data-active={index === active || undefined} className={s.option} onPointerMove={event => {if(event.pointerType === "mouse" && !option.disabled)setActive(index);}} onClick={() => choose(index)}>
        <span className={s.ordinal} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><span className={s.words}><span dir="auto">{option.label}</span>{option.description && <small>{option.description}</small>}</span>
        {option.value === value && <svg className={s.kept} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 13q4 0 6 6c2-8 5-12 11-15M10 19c0-4-3-6-5-5 0 3 2 5 5 5"/></svg>}
      </div>)}
    </div>}
  </span>;
}
