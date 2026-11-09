"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, Suspense, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, ChevronRight, CircleHelp, Fingerprint, LoaderCircle, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";

export type Bootstrap = { configured: boolean; user: null | { name?: string; email?: string; picture?: string; sub: string }; role: "user" | "reviewer" | "admin"; readiness: { id: string; label: string; status: "ready" | "missing" | "limited"; message: string }[]; loginHref?: string; limits?: Record<string, unknown> };
const Context = createContext<{ data: Bootstrap | null; error: string; reload: () => void }>({ data: null, error: "", reload: () => {} });
export const useBootstrap = () => useContext(Context);

export function Brand() { return <Link className="sw-brand" href="/" aria-label="Scamwin home"><span className="sw-brand-icon"><Fingerprint size={23} strokeWidth={1.7} /></span>scamwin<span className="sw-brand-dot">.</span></Link>; }
function Navigation({ marketing, path = "" }: { marketing: boolean; path?: string }) { return <>{(marketing ? [["/check", "Check an offer"], ["/demo", "Explore a sample"], ["/warnings", "Shared warnings"]] : [["/check", "New check"], ["/checks", "My checks"], ["/warnings", "Shared warnings"], ["/account", "Account"]]).map(([href, label]) => <Link key={href} href={href} aria-current={path === href || (href === "/checks" && path.startsWith("/checks/")) ? "page" : undefined}>{label}</Link>)}</>; }
function ActiveNavigation({ marketing }: { marketing: boolean }) { const path = usePathname(); return <Navigation marketing={marketing} path={path} />; }
export function Shell({ children, marketing = false }: { children: ReactNode; marketing?: boolean }) {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/scamwin/bootstrap", { signal: controller.signal, cache: "no-store" }).then(async r => { if (!r.ok) throw new Error(); return r.json(); }).then(setData).catch(e => { if (e.name !== "AbortError") setError("Account status could not be loaded."); });
    return () => controller.abort();
  }, [version]);
  return <Context.Provider value={{ data, error, reload: () => { setError(""); setVersion(v => v + 1); } }}><div className={`sw ${marketing ? "sw-marketing" : ""}`}>
    <a className="sw-skip" href="#main-content">Skip to content</a>
    <header className="sw-header"><div className="sw-header-inner"><Brand /><nav aria-label="Main navigation">
      <Suspense fallback={<Navigation marketing={marketing} />}><ActiveNavigation marketing={marketing} /></Suspense>
    </nav><div className="sw-header-account">{data?.user ? <Link className="sw-user" href="/account"><span>{(data.user.name || data.user.email || "A").charAt(0).toUpperCase()}</span><span className="sw-user-name">{data.user.name?.split(" ")[0] || "Account"}</span></Link> : <a className="sw-small-link" href={data?.loginHref || "/auth/login?returnTo=/check"}>Sign in <ArrowRight size={14} /></a>}</div></div></header>
    <main id="main-content" className={marketing ? "" : "sw-main"}>{children}</main>
    <footer className="sw-footer"><Brand /><p>A little distance. A clearer decision.</p><div><Link href="/account">Privacy & account</Link><span>Built for careful decisions</span></div></footer>
  </div></Context.Provider>;
}
export function PageHead({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) { return <div className="sw-page-head"><div>{eyebrow && <p className="sw-eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description && <p className="sw-description">{description}</p>}</div>{action}</div>; }
export function Notice({ title, children, error = false }: { title: string; children?: ReactNode; error?: boolean }) { return <Alert className={`sw-notice ${error ? "sw-notice-error" : ""}`} variant={error ? "destructive" : "default"}><CircleHelp /><AlertTitle>{title}</AlertTitle>{children && <AlertDescription>{children}</AlertDescription>}</Alert>; }
export function Loading({ label = "Loading your checks…" }: { label?: string }) { return <div className="sw-loading" role="status"><LoaderCircle className="sw-spin" size={21} /><span>{label}</span></div>; }
export function Empty({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) { return <div className="sw-empty"><span className="sw-empty-icon"><ShieldCheck size={30} strokeWidth={1.3} /></span><h2>{title}</h2><p>{children}</p>{action}</div>; }
export function Gate({ children, role }: { children: ReactNode; role?: "reviewer" | "admin" }) {
  const { data, error, reload } = useBootstrap();
  if (error) return <Notice title="Account status unavailable" error>{error} <Button className="sw-btn sw-btn-outline" onClick={reload}>Try again</Button></Notice>;
  if (!data) return <Loading label="Checking account access…" />;
  if (!data.configured) return <div className="sw-panel"><Empty title="Scamwin is getting ready" action={<Link className="sw-btn sw-btn-primary" href="/demo">Explore the sample <ArrowRight size={16} /></Link>}>Private checks need the online services to be configured. You can explore a clearly labeled sample while setup is completed.</Empty><Readiness data={data} /></div>;
  if (!data.user) return <Empty title="Your checks stay with you" action={<a className="sw-btn sw-btn-primary" href={data.loginHref || "/auth/login?returnTo=/check"}>Sign in to continue <ArrowRight size={16} /></a>}>Sign in to create a private check, keep the evidence together and return to it later. No wallet needed.</Empty>;
  if (role && data.role !== "admin" && data.role !== role) return <Empty title="This area needs additional access" action={<Link className="sw-btn sw-btn-outline" href="/check">Back to new check</Link>}>Your account does not have {role} access. Your own checks are still available.</Empty>;
  return children;
}
export function Readiness({ data }: { data: Bootstrap }) { return <div className="sw-readiness">{data.readiness.map(item => <div className="sw-readiness-row" key={item.id}><div><strong>{item.label}</strong><p>{item.message}</p></div><Badge value={item.status} /></div>)}</div>; }
export function Badge({ value }: { value: string }) { return <span className={`sw-badge sw-badge-${value.replaceAll("_", "-")}`}>{value.replaceAll("_", " ")}</span>; }
export function Journey({ promise, action, destination, compact = false }: { promise: string; action: string; destination: string; compact?: boolean }) { return <div className={`sw-journey ${compact ? "sw-journey-compact" : ""}`} aria-label="Promise, action and destination"><div><span className="sw-journey-label">The promise</span><p>{promise}</p></div><ChevronRight className="sw-journey-arrow" size={18} /><div><span className="sw-journey-label">The requested action</span><p>{action}</p></div><ChevronRight className="sw-journey-arrow" size={18} /><div><span className="sw-journey-label">The destination</span><p>{destination}</p></div></div>; }
export function Confirm({ open, onOpenChange, title, description, label, busy, onConfirm, error }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; label: string; busy: boolean; onConfirm: () => void; error?: string }) { const keep = useRef<HTMLButtonElement>(null); return <Dialog open={open} onOpenChange={v => { if (!busy) onOpenChange(v); }}><DialogContent className="sw sw-dialog" initialFocus={keep}><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription>{error && <Notice title="Action could not be completed" error>{error}</Notice>}<DialogFooter><DialogClose render={<Button ref={keep} className="sw-btn sw-btn-outline" disabled={busy} />}>Keep check</DialogClose><Button className="sw-btn sw-btn-danger" onClick={onConfirm} disabled={busy} aria-busy={busy}>{busy ? "Deleting…" : label}</Button></DialogFooter></DialogContent></Dialog>; }
export function SearchBox({ value, onChange, label = "Search checks" }: { value: string; onChange: (v: string) => void; label?: string }) {
  const composing = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const [compositionValue, setCompositionValue] = useState<string | null>(null);
  const display = compositionValue ?? value;
  return <div className="sw-search"><label className="sr-only" htmlFor="sw-search">{label}</label><input ref={input} id="sw-search" value={display} onCompositionStart={event => { composing.current = true; setCompositionValue(event.currentTarget.value); }} onCompositionEnd={event => { composing.current = false; setCompositionValue(null); onChange(event.currentTarget.value); }} onChange={event => { if (composing.current) setCompositionValue(event.target.value); else onChange(event.target.value); }} placeholder={label} type="search" autoComplete="off" />{display && <button type="button" aria-label="Clear search" onClick={() => { setCompositionValue(null); onChange(""); input.current?.focus(); }}><X size={16} /></button>}</div>;
}
export function dateLabel(value: string) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? "Time unavailable" : new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(date); }
export function hostLabel(value: string, fallback = "Message / screenshot check") { try { return new URL(value).hostname || fallback; } catch { return fallback; } }
export const intendedActionOptions = [{ value: "receive_money", label: "Receive money" }, { value: "pay_money", label: "Send or pay money" }, { value: "share_information", label: "Share information" }, { value: "read_information", label: "Read information" }, { value: "other", label: "Something else / unsure" }];
export function intendedActionLabel(value: string) { return intendedActionOptions.find(item => item.value === value)?.label || value.replaceAll("_", " "); }
