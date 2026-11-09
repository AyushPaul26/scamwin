"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { NAV_ITEMS, OpenModsMark } from "./hero-content";

function ReserveLink({ onClick }: { onClick?: () => void }) {
  return (
    <Link className="liquid-glass reserve-link" href="/sign-up" onClick={onClick}>
      <span className="reserve-dot" aria-hidden="true" />
      Reserve Yours
    </Link>
  );
}

function keepMenuFocus(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab") return;
  const controls = event.currentTarget.querySelectorAll<HTMLElement>(
    "button:not([disabled]), a[href]",
  );
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}

export function HeroNavigation() {
  const [activeItem, setActiveItem] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const previousOverflow = useRef<string | null>(null);

  function restoreOverflow() {
    if (previousOverflow.current !== null) {
      document.body.style.overflow = previousOverflow.current;
      previousOverflow.current = null;
    }
  }

  function closeMenu() { dialogRef.current?.close(); }

  function openMenu() {
    previousOverflow.current = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.showModal();
  }

  function selectItem(item: string) {
    setActiveItem(item);
    closeMenu();
  }

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    const onResize = () => { if (desktop.matches) dialogRef.current?.close(); };
    desktop.addEventListener("change", onResize);
    return () => {
      desktop.removeEventListener("change", onResize);
      restoreOverflow();
    };
  }, []);

  return (
    <>
      <header className="hero-header">
        <Link className="hero-logo" href="/" aria-label="OpenMods home"><OpenModsMark /></Link>
        <nav className="liquid-glass desktop-navigation" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => (
            <button key={item} type="button" className="desktop-nav-item" aria-pressed={activeItem === item} onClick={() => selectItem(item)}>{item}</button>
          ))}
        </nav>
        <div className="desktop-reserve"><ReserveLink /></div>
        <button ref={triggerRef} className="liquid-glass menu-trigger" type="button" onClick={openMenu} aria-label="Open navigation menu" aria-haspopup="dialog" aria-controls="mobile-navigation"><span /><span /></button>
      </header>
      <dialog ref={dialogRef} id="mobile-navigation" className="mobile-navigation" aria-label="Navigation menu" onKeyDown={keepMenuFocus} onClose={() => { restoreOverflow(); triggerRef.current?.focus(); }}>
        <button className="liquid-glass menu-close" type="button" onClick={closeMenu} aria-label="Close navigation menu" autoFocus><span /><span /></button>
        <nav className="mobile-nav-items" aria-label="Mobile navigation">
          {NAV_ITEMS.map((item, index) => (
            <button key={item} type="button" className="mobile-nav-item" style={{ "--item-delay": `${100 + index * 60}ms` } as CSSProperties} aria-pressed={activeItem === item} onClick={() => selectItem(item)}>{item}</button>
          ))}
        </nav>
        <div className="mobile-reserve"><ReserveLink onClick={closeMenu} /></div>
      </dialog>
    </>
  );
}
