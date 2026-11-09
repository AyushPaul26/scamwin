'use client';
import { createContext, useContext, useEffect, useRef, useState, useCallback, type CSSProperties, type ReactNode } from 'react';
import { MaximizeIcon, MinimizeIcon, MonitorIcon, RefreshCwIcon, XIcon } from 'lucide-react';
import type RFB from '@novnc/novnc';
import { Button } from '@/components/ui/button';
const DesktopContext = createContext<{ open: boolean; toggle: () => void } | null>(null);
async function openDesktop(chatId: string) {
  const response = await fetch(`/api/chats/${encodeURIComponent(chatId)}/desktop`, { method: 'POST' });
  if (!response.ok) throw new Error('Desktop unavailable.');
  return response.json() as Promise<{ url: string; expiresAt: number }>;
}
export function DesktopButton() {
  const desktop = useContext(DesktopContext);
  if (!desktop) return null;
  return <Button type="button" variant="ghost" size="icon-lg" onClick={desktop.toggle} aria-label="Open computer desktop" title="Computer desktop" aria-expanded={desktop.open}><MonitorIcon className="size-5" /></Button>;
}
export function DesktopWorkspace({ chatId, children, enabled, name }: { chatId: string; children: ReactNode; enabled: boolean; name: string }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const workspace = useRef<HTMLDivElement>(null);
  const [computerWidth, setComputerWidth] = useState(55);
  const [resizing, setResizing] = useState(false);
  const clampWidth = (value: number) => Math.max(30, Math.min(70, value));
  const close = useCallback(() => { setOpen(false); setExpanded(false); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[aria-label="Open computer desktop"]')?.focus()); }, []);
  return <DesktopContext.Provider value={enabled ? { open, toggle: () => setOpen(v => !v) } : null}>
    <div ref={workspace} style={{ "--computer-width": `${computerWidth}%` } as CSSProperties} className="desktop-workspace relative flex min-h-0 flex-1" data-resizing={resizing} data-desktop-open={enabled && open} data-desktop-expanded={expanded && open}>
      <div className="desktop-chat flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      {enabled && open && !expanded && <div
        role="separator" aria-label="Resize computer panel" aria-orientation="vertical"
        aria-valuemin={30} aria-valuemax={70} aria-valuenow={Math.round(computerWidth)}
        aria-valuetext={`Computer width ${Math.round(computerWidth)} percent`}
        tabIndex={0} className="desktop-divider"
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          setResizing(true);
        }}
        onPointerMove={event => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const bounds = workspace.current?.getBoundingClientRect();
          if (bounds) setComputerWidth(clampWidth((bounds.right - event.clientX) / bounds.width * 100));
        }}
        onPointerUp={event => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          setResizing(false);
        }}
        onLostPointerCapture={() => setResizing(false)}
        onPointerCancel={() => setResizing(false)}
        onDoubleClick={() => setComputerWidth(55)}
        onKeyDown={event => {
          const step = event.shiftKey ? 10 : 2;
          if (event.key === 'ArrowLeft') setComputerWidth(value => clampWidth(value + step));
          else if (event.key === 'ArrowRight') setComputerWidth(value => clampWidth(value - step));
          else if (event.key === 'Home') setComputerWidth(30);
          else if (event.key === 'End') setComputerWidth(70);
          else return;
          event.preventDefault();
        }}
      />}
      {enabled && open && <DesktopPanel chatId={chatId} name={name} onClose={close} fullscreen={expanded} onExpand={() => setExpanded(v => !v)} />}
    </div>
  </DesktopContext.Provider>;
}
function DesktopPanel({ chatId, name, onClose, fullscreen, onExpand }: { chatId: string; name: string; onClose: () => void; fullscreen: boolean; onExpand: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const client = useRef<RFB | null>(null);
  const accessRequest = useRef<{ chatId: string; attempt: number; promise: ReturnType<typeof openDesktop> } | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [status, setStatus] = useState('Connecting to your computer…');
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [control, setControl] = useState(false);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let connection: RFB | undefined;
    void (async () => {
      try {
        // React Strict Mode replays the effect; reuse its in-flight request.
        if (!accessRequest.current || accessRequest.current.chatId !== chatId || accessRequest.current.attempt !== attempt) {
          accessRequest.current = { chatId, attempt, promise: openDesktop(chatId) };
        }
        const [access, module] = await Promise.all([accessRequest.current.promise, import('@novnc/novnc')]);
        if (disposed || !screen.current) return;
        connection = new module.default(screen.current, access.url);
        client.current = connection;
        connection.viewOnly = true;
        connection.scaleViewport = true;
        connection.resizeSession = false;
        connection.addEventListener('connect', () => { if (!disposed) { setConnecting(false); setConnected(true); setStatus('Connected · View only'); } });
        connection.addEventListener('disconnect', () => { if (!disposed) { setConnecting(false); setConnected(false); setStatus('Disconnected. Reconnect to continue.'); } });
        connection.addEventListener('securityfailure', () => { if (!disposed) { setConnecting(false); setConnected(false); setStatus('Desktop access expired. Reconnect to renew it.'); } });
        timer = setTimeout(() => { if (!disposed) setStatus('Access expires soon. Reconnect if the connection drops.'); }, Math.max(0, access.expiresAt - Date.now() - 60000));
      } catch { if (!disposed) { setConnecting(false); setStatus('Could not open the computer. Please try again.'); } }
    })();
    return () => { disposed = true; clearTimeout(timer); connection?.disconnect(); client.current = null; };
  }, [chatId, attempt]);
  useEffect(() => { if (client.current) { client.current.viewOnly = !control; if (control) client.current.focus(); } }, [control]);
  useEffect(() => {
    closeButton.current?.focus();
  }, []);
  useEffect(() => {
    function key(event: KeyboardEvent) {
      // Let Escape reach the remote machine while the user is controlling it.
      if (event.key !== 'Escape' || control) return;
      if (fullscreen) onExpand(); else onClose();
    }
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [fullscreen, control, onClose, onExpand]);
  function reconnect() { if (connecting) return; setConnecting(true); setConnected(false); setControl(false); setStatus('Reconnecting…'); setAttempt(v => v + 1); }
  return <div ref={panel} role="region" aria-label="Computer desktop" className="desktop-panel flex min-h-0 flex-col bg-[#151515] text-[#ededed]">
    <div className="flex h-16 shrink-0 items-center gap-1 border-b border-white/10 px-4 sm:px-6">
      <MonitorIcon className="mr-2 size-5 shrink-0 text-[#b9b9b9]" />
      <h2 className="mr-auto min-w-0 truncate text-base font-medium sm:text-lg">{name}’s computer</h2>
      <Button size="icon" variant="ghost" disabled={connecting} onClick={reconnect} aria-label="Reconnect desktop" title="Reconnect desktop" className="text-[#a1a1a1] hover:bg-white/10 hover:text-white"><RefreshCwIcon className="size-4" /></Button>
      <Button size="icon" variant="ghost" onClick={onExpand} aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} title={fullscreen ? 'Return to split view' : 'Expand computer'} className="text-[#a1a1a1] hover:bg-white/10 hover:text-white">{fullscreen ? <MinimizeIcon className="size-4" /> : <MaximizeIcon className="size-4" />}</Button>
      <Button ref={closeButton} size="icon" variant="ghost" onClick={onClose} aria-label="Close desktop" className="text-[#a1a1a1] hover:bg-white/10 hover:text-white"><XIcon className="size-5" /></Button>
    </div>
    <div className="desktop-stage flex min-h-0 flex-1 flex-col items-center justify-center gap-5 p-4 sm:gap-6 sm:p-6">
      <div className="desktop-frame relative w-full overflow-hidden rounded-2xl bg-[#242124] shadow-[0_0_0_1px_#ffffff12]">
        <div ref={screen} className="absolute inset-0 overflow-hidden" />
        {!connected && <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#201d20] px-6 text-center">
          <MonitorIcon className="size-9 text-[#f278b5]" />
          <p role="status" className="max-w-72 text-sm text-[#c3bfc2]">{status}</p>
          {!connecting && <Button variant="secondary" onClick={reconnect} className="rounded-full">Try again</Button>}
        </div>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-center gap-3">
        <p role="status" className="text-sm text-[#d4d4d4] sm:text-base">{connected ? control ? 'You have control' : `${name} has control` : 'Computer offline'}</p>
        <Button disabled={!connected} onClick={() => setControl(v => !v)} aria-pressed={control} className="h-10 rounded-full bg-[#eeeeee] px-5 text-sm font-semibold text-[#202020] hover:bg-white disabled:opacity-40">{control ? 'Release control' : 'Take over'}</Button>
      </div>
      <p className="sr-only" aria-live="polite">{connected ? status : ''}</p>
    </div>
  </div>;
}
