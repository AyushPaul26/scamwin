"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { listChecksAction, deleteCheckAction, recheckAction } from "@/app/scamwin/actions";
import type { CheckPage, CheckRecord } from "@/lib/scamwin/contracts";
import { Button } from "@/components/ui/button";
import { Badge, Confirm, Empty, Gate, Loading, Notice, PageHead, SearchBox, dateLabel, hostLabel } from "./core";

function checkLabel(check: CheckRecord) {
  return check.input.promisedBenefit || (check.input.url ? hostLabel(check.input.url) : check.input.claimedCompany || (check.input.offerReference ? `Public reference: ${check.input.offerReference}` : hostLabel(check.input.url)));
}
function checkSourceLabel(check: CheckRecord) {
  return check.input.url ? hostLabel(check.input.url) : check.input.offerReference ? `Public reference: ${check.input.offerReference}` : hostLabel(check.input.url);
}

export function History() { return <><PageHead eyebrow="Private by default" title="Your checks, together." description="Return to an offer, inspect the evidence or take another look with a new check." action={<Link href="/check" className="sw-btn sw-btn-primary">New check <ArrowRight size={16} /></Link>} /><Gate><HistoryList /></Gate></>; }
function HistoryList() {
  const router = useRouter();
  const [query, setQuery] = useState(""); const [page, setPage] = useState(1);
  const [data, setData] = useState<CheckPage | null>(null); const [error, setError] = useState(""); const [busy, setBusy] = useState(true); const [version, setVersion] = useState(0);
  const [deleting, setDeleting] = useState<CheckRecord | null>(null); const [mutationError, setMutationError] = useState(""); const [pending, start] = useTransition();
  const sequence = useRef(0);
  useEffect(() => {
    const current = ++sequence.current;
    const timer = setTimeout(() => {
      setBusy(true); setError("");
      listChecksAction({ page, query }).then(result => { if (current !== sequence.current) return; if (result.ok) { if (!result.data.checks.length && page > 1) setPage(p => p - 1); else setData(result.data); } else setError(result.error); }).catch(() => { if (current === sequence.current) setError("Your checks could not be loaded. Try again."); }).finally(() => { if (current === sequence.current) setBusy(false); });
    }, query ? 300 : 0);
    return () => { clearTimeout(timer); sequence.current = current + 1; };
  }, [query, page, version]);
  function remove() { if (!deleting) return; start(async () => { try { const result = await deleteCheckAction(deleting.id); if (result.ok) { setDeleting(null); setMutationError(""); setVersion(v => v + 1); } else setMutationError(result.error); } catch { setMutationError("The check could not be deleted. Try again."); } }); }
  function recheck(id: string) { start(async () => { setMutationError(""); try { const result = await recheckAction(id, crypto.randomUUID()); if (result.ok) router.push(`/checks/${result.data.checkId}`); else setMutationError(result.error); } catch { setMutationError("A new check could not be started. Try again."); } }); }
  return <><div className="sw-list-toolbar"><SearchBox value={query} onChange={value => { setQuery(value); setPage(1); }} label="Search domain or status" /><span>{busy ? "Updating…" : `${data?.total || 0} saved checks`} · newest first</span></div>
    {error && <Notice title="Your checks are temporarily unavailable" error>{error} <Button className="sw-btn sw-btn-outline" onClick={() => setVersion(v => v + 1)}>Try again</Button></Notice>}
    {mutationError && !deleting && <Notice title="Action could not be completed" error>{mutationError}</Notice>}
    <div className="sw-panel" aria-busy={busy}>{busy && !data ? <Loading /> : !data?.checks.length ? <Empty title={query ? "No matching checks" : "A clearer picture starts here"} action={query ? <Button className="sw-btn sw-btn-outline" onClick={() => setQuery("")}>Clear search</Button> : <Link href="/check" className="sw-btn sw-btn-primary">Check an offer <ArrowRight size={16} /></Link>}>{query ? "Try a different domain or check status. Your search stays private." : "Your saved checks and their evidence will appear here. Start with a link, a message or a screenshot."}</Empty> : <div className="sw-check-list">{data.checks.map(check => <article className="sw-check-row" key={check.id}><Link href={`/checks/${check.id}`} className="sw-check-main"><strong>{checkLabel(check)}</strong><p>{checkSourceLabel(check)} · {dateLabel(check.createdAt)}</p></Link><Badge value={check.assessment?.risk || check.state} /><div className="sw-row-actions"><Link href={`/checks/${check.id}`}>Open <ArrowRight size={12} className="inline" /></Link><button disabled={pending} onClick={() => recheck(check.id)}>Recheck</button><button disabled={pending} onClick={() => { setMutationError(""); setDeleting(check); }}>Delete</button></div></article>)}</div>}</div>
    {data && data.total > 0 && <nav className="sw-pagination" aria-label="Check history pages"><span>{Math.min((page - 1) * data.pageSize + 1, data.total)}–{Math.min(page * data.pageSize, data.total)} of {data.total} checks · 20 per page</span><div><Button className="sw-btn sw-btn-outline" disabled={page <= 1 || busy} onClick={() => setPage(p => p - 1)}><ChevronLeft size={13} /> Previous</Button><span aria-current="page">Page {page}</span><Button className="sw-btn sw-btn-outline" disabled={page * data.pageSize >= data.total || busy} onClick={() => setPage(p => p + 1)}>Next <ChevronRight size={13} /></Button></div></nav>}
    <Confirm open={!!deleting} onOpenChange={open => { if (!open) setDeleting(null); }} title="Delete this private check?" description={`“${deleting ? checkLabel(deleting) : "This check" }” and its private evidence will be hidden and queued for cleanup. A separately published warning stays public.`} label="Delete check" busy={pending} onConfirm={remove} error={mutationError} />
  </>;
}
