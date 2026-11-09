"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, Check, ImagePlus, Link2, LockKeyhole, X } from "lucide-react";
import { createCheckAction } from "@/app/scamwin/actions";
import { checkInputSchema, INPUT_LIMITS } from "@/lib/scamwin/input";
import type { CheckInput, PreparedImage } from "@/lib/scamwin/contracts";
import { CHAT_IMAGE_ACCEPT, prepareChatImages } from "@/lib/chat-images";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldLabel, FieldGroup, FieldError } from "@/components/ui/field";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Gate, Journey, Notice, PageHead, hostLabel, intendedActionOptions, intendedActionLabel } from "./core";

export function Intake() { return <><PageHead eyebrow="A little distance helps" title="Let’s look at the offer." description="Share what you received and what you’re thinking of doing. We’ll help you see the connection." /><Gate><IntakeForm /></Gate></>; }
function IntakeForm() {
  const router = useRouter();
  const key = useRef("");
  const picker = useRef<HTMLInputElement>(null);
  const leaveTrigger = useRef<HTMLAnchorElement>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState("");
  const [leaveHref, setLeaveHref] = useState("");
  const submitted = useRef(false);
  const form = useForm<CheckInput>({ resolver: zodResolver(checkInputSchema), defaultValues: { url: "", message: "", promisedBenefit: "", intendedAction: "", images: [] }, mode: "onBlur" });
  const values = useWatch({ control: form.control });
  const images = values.images || [];
  const [result, dispatch, pending] = useActionState(async (_: { error?: string; code?: string }, input: CheckInput) => {
    if (!key.current) key.current = crypto.randomUUID();
    try {
      const response = await createCheckAction(input, key.current);
      if (!response.ok) return { error: response.error, code: response.code };
      submitted.current = true;
      router.push(`/checks/${response.data.checkId}`);
      return {};
    } catch { return { error: "The check could not be saved. Your input is still here; try again." }; }
  }, {});
  const dirty = form.formState.isDirty;
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => { if (!submitted.current) event.preventDefault(); };
    const click = (event: MouseEvent) => {
      if (submitted.current || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element).closest("a");
      if (anchor && !anchor.target && anchor.origin === location.origin && anchor.pathname !== location.pathname && !anchor.getAttribute("href")?.startsWith("#")) { event.preventDefault(); event.stopPropagation(); leaveTrigger.current = anchor; setLeaveHref(anchor.href); }
    };
    window.addEventListener("beforeunload", unload); document.addEventListener("click", click, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", click, true); };
  }, [dirty]);
  async function addImages(files: FileList | null) {
    if (!files?.length) return;
    setImageError("");
    const selected = Array.from(files);
    if (selected.length + images.length > INPUT_LIMITS.images || selected.some(file => file.size > INPUT_LIMITS.sourceImageBytes || !CHAT_IMAGE_ACCEPT.split(",").includes(file.type))) { setImageError("Choose up to four PNG, JPEG, WebP or GIF images, no larger than 10 MB each."); if (picker.current) picker.current.value = ""; return; }
    setImageBusy(true);
    const urls = selected.map(file => URL.createObjectURL(file));
    try {
      const prepared = await prepareChatImages(selected.map((file, index) => ({ type: "file", filename: file.name, mediaType: file.type, url: urls[index] })));
      const next: PreparedImage[] = prepared.map(file => ({ name: (file.filename || "screenshot.jpg").slice(0, 200), mediaType: "image/jpeg", dataUrl: file.url }));
      form.setValue("images", [...images as PreparedImage[], ...next], { shouldDirty: true, shouldValidate: true });
    } catch (e) { setImageError(e instanceof Error ? e.message : "This image could not be prepared. Try a smaller image."); }
    finally { urls.forEach(URL.revokeObjectURL); setImageBusy(false); if (picker.current) picker.current.value = ""; }
  }
  return <div className="sw-intake-grid"><form className="sw-panel sw-intake-form" noValidate onSubmit={form.handleSubmit(input => startTransition(() => dispatch(input)))} aria-busy={pending}>
    <div className="sw-panel-heading"><span className="sw-step-symbol"><Link2 size={18} /></span><div><h2>The offer, in your words</h2><p>A link, message or screenshot is enough to start.</p></div><span className="sw-private-tag"><LockKeyhole size={12} /> Private</span></div>
    <FieldGroup><Controller name="url" control={form.control} render={({ field, fieldState }) => <Field data-invalid={fieldState.invalid}><FieldLabel htmlFor="offer-url">Offer link <span>Optional</span></FieldLabel><Input {...field} id="offer-url" type="url" autoComplete="off" spellCheck={false} placeholder="https://example.com/offer" maxLength={4096} disabled={pending} aria-invalid={fieldState.invalid} aria-describedby={fieldState.error ? "url-error" : "url-help"} /><p id="url-help" className="sw-field-help">One destination per check. We don’t visit unsupported websites.</p><FieldError id="url-error" errors={[fieldState.error]} /></Field>} />
    <Controller name="message" control={form.control} render={({ field, fieldState }) => <Field data-invalid={fieldState.invalid}><FieldLabel htmlFor="offer-message">What did you receive? <span>Optional</span></FieldLabel><Textarea {...field} id="offer-message" rows={5} placeholder="Paste the message, email or offer here…" maxLength={12000} disabled={pending} aria-invalid={fieldState.invalid} aria-describedby={fieldState.error ? "message-error" : "message-help"} /><p id="message-help" className="sw-field-help">Leave out passwords, full account numbers and other secrets.</p><FieldError id="message-error" errors={[fieldState.error]} /></Field>} />
    <div className="sw-field-pair"><Controller name="promisedBenefit" control={form.control} render={({ field, fieldState }) => <Field data-invalid={fieldState.invalid}><FieldLabel htmlFor="offer-promise">What are you promised? <span>Optional</span></FieldLabel><Input {...field} id="offer-promise" placeholder="e.g. A refund of ₹2,499" disabled={pending} aria-invalid={fieldState.invalid} aria-describedby={fieldState.error ? "promise-error" : undefined} /><FieldError id="promise-error" errors={[fieldState.error]} /></Field>} /><Controller name="intendedAction" control={form.control} render={({ field, fieldState }) => <Field data-invalid={fieldState.invalid}><FieldLabel htmlFor="offer-action">What might you do? <span>Optional</span></FieldLabel><select {...field} id="offer-action" className="sw-native-select" disabled={pending} aria-invalid={fieldState.invalid} aria-describedby={fieldState.error ? "action-error" : "action-help"}><option value="">Choose what you intend to do</option>{intendedActionOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><p id="action-help" className="sw-field-help">Choose your intended action, before following the offer.</p><FieldError id="action-error" errors={[fieldState.error]} /></Field>} /></div>
    <Field><FieldLabel htmlFor="offer-images">Screenshots <span>Up to 4</span></FieldLabel><input className="sr-only" ref={picker} id="offer-images" type="file" accept={CHAT_IMAGE_ACCEPT} multiple disabled={pending || imageBusy || images.length >= 4} onChange={event => void addImages(event.target.files)} /><Button type="button" className="sw-upload" variant="outline" disabled={pending || imageBusy || images.length >= 4} onClick={() => picker.current?.click()}><ImagePlus size={21} /><span>{imageBusy ? "Preparing images…" : "Add screenshots"}<small>PNG, JPG, WebP or GIF · 10 MB each</small></span><span className="sw-upload-count">{images.length}/4</span></Button><p className="sw-field-help">Images become compressed still JPEGs before upload. GIF animation is not analyzed.</p>{images.length > 0 && <ul className="sw-image-list">{images.map((file, index) => <li key={`${file.name}-${index}`}><span>{file.name}</span><button type="button" disabled={pending} aria-label={`Remove ${file.name}`} onClick={() => form.setValue("images", images.filter((_, i) => i !== index) as PreparedImage[], { shouldDirty: true, shouldValidate: true })}><X size={16} /></button></li>)}</ul>}{imageError && <FieldError>{imageError}</FieldError>}<FieldError errors={[form.formState.errors.images]} /></Field></FieldGroup>
    {result.error && <Notice title="Your check hasn’t started" error>{result.error}{result.code === "unauthenticated" && <> <a href="/auth/login?returnTo=/check" target="_blank" rel="noreferrer">Sign in in another tab</a>, then retry here.</>}</Notice>}
    <div className="sw-submit-row"><p><LockKeyhole size={13} /> Only you can see this check.</p><Button className="sw-btn sw-btn-primary" type="submit" disabled={pending || imageBusy} aria-busy={pending}>{pending ? "Saving your check…" : "Check this offer"}<ArrowRight size={16} /></Button></div>
  </form><aside className="sw-intake-aside"><div className="sw-panel sw-preview"><p className="sw-eyebrow">Your decision, clearly framed</p><h2>Here’s what we’ll look at.</h2><Journey compact promise={values.promisedBenefit || "What you expect to receive"} action={intendedActionLabel(values.intendedAction || "") || "What you’re considering doing"} destination={values.url ? hostLabel(values.url) : "The destination in your evidence"} /><p className="sw-field-help">This restatement comes from your fields. You can edit them before starting.</p></div><div className="sw-quiet-info"><h3>What happens next</h3><p><Check size={15} /> A private check is saved to your account.</p><p><Check size={15} /> Available evidence is checked and connected.</p><p><Check size={15} /> Findings and missing checks appear together.</p><p className="sw-small-copy">Website visits are restricted to controlled demonstration sites. Other links can receive message, URL and reviewed-warning analysis.</p></div><p className="sw-small-copy">Submitted content may be processed by our online AI provider. Private checks expire after 30 days; images after 7 days. Sharing a warning always needs a separate choice.</p></aside>
    <Dialog open={!!leaveHref} onOpenChange={open => { if (!open) setLeaveHref(""); }}><DialogContent className="sw sw-dialog" finalFocus={leaveTrigger}><DialogTitle>Leave this offer?</DialogTitle><DialogDescription>Your unsaved message and screenshots will be lost. Stay here to finish your check.</DialogDescription><DialogFooter><DialogClose render={<Button className="sw-btn sw-btn-primary" />}>Keep editing</DialogClose><Button className="sw-btn sw-btn-outline" onClick={() => { submitted.current = true; router.push(leaveHref); }}>Leave without saving</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
