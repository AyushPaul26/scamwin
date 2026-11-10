'use server';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { requireScamwinUser, publicError } from '@/lib/scamwin/server';
import { checkInputSchema } from '@/lib/scamwin/input';
import { ScamwinStoreError } from '@/lib/scamwin/store';
import { answerFromEvidence } from '@/lib/scamwin/ai';
import { scheduleScamwinPublication } from '@/lib/scamwin/schedule-publication';
import { investigationBackend } from '@/lib/scamwin/investigation-backend';
import { scheduleScamwinInvestigation } from '@/lib/scamwin/schedule-investigation';
import type { CheckInput } from '@/lib/scamwin/contracts';

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string; code: string };
const id = z.string().min(1).max(120), key = z.string().min(1).max(200);
async function result<T>(run: () => Promise<T>): Promise<ActionResult<T>> { try { return { ok: true, data: await run() }; } catch (error) { return { ok: false, ...publicError(error) }; } }
export async function listChecksAction(options: { page?: number; query?: string } = {}) { return result(async () => { const { subject, store } = await requireScamwinUser(); const page = await store.listChecks(subject, z.object({ page: z.number().int().min(1).max(10000).optional(), query: z.string().max(200).optional() }).strict().parse(options)); return { ...page, checks: page.checks.map(check => ({ ...check, input: { ...check.input, images: check.input.images.map(image => ({ ...image, dataUrl: '' })) } })) }; }); }
export async function createCheckAction(input: CheckInput, submissionKey: string) { return result(async () => { const { subject, store } = await requireScamwinUser(); const parsed = checkInputSchema.parse(input); if (!investigationBackend()) throw new ScamwinStoreError('worker_unavailable'); const check = await store.createCheck(subject, parsed, key.parse(submissionKey)); await scheduleScamwinInvestigation(store); return { checkId: check.id }; }); }
export async function cancelCheckAction(checkId: string) { return result(async () => { const { subject, store } = await requireScamwinUser(); const check = await store.requestCancel(subject, id.parse(checkId)); if (!check) throw new ScamwinStoreError('not_found'); return { checkId: check.id }; }); }
export async function deleteCheckAction(checkId: string) { return result(async () => { const { subject, store } = await requireScamwinUser(); if (!await store.deleteCheck(subject, id.parse(checkId))) throw new ScamwinStoreError('not_found'); return { deleted: true }; }); }
export async function recheckAction(checkId: string, submissionKey: string) { return result(async () => { const { subject, store } = await requireScamwinUser(); const old = await store.getCheck(subject, id.parse(checkId)); if (!old) throw new ScamwinStoreError('not_found'); if (!investigationBackend()) throw new ScamwinStoreError('worker_unavailable'); const c = await store.createCheck(subject, { ...old.input, images: old.input.images.filter(image => !!image.dataUrl) }, key.parse(submissionKey)); await scheduleScamwinInvestigation(store); return { checkId: c.id }; }); }
export async function followupAction(checkId: string, question: string, submissionKey: string) { return result(async () => {
  const { subject, store } = await requireScamwinUser(); const c = await store.getCheck(subject, id.parse(checkId));
  if (!c?.assessment || !['completed','partial'].includes(c.state)) throw new ScamwinStoreError('not_found');
  const text = z.string().trim().min(3).max(2000).parse(question), requestKey = key.parse(submissionKey);
  if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) throw new ScamwinStoreError('ai_unavailable');
  const sql = neon(process.env.DATABASE_URL!); const actor = createHash('sha256').update(subject).digest('hex'), reservation = createHash('sha256').update(`${subject}:${c.id}:${requestKey}`).digest('hex');
  const reserved = await sql.transaction([sql`SELECT pg_advisory_xact_lock(hashtext('scamwin-followups'))`, sql`INSERT INTO scamwin_audit_events(id,actor_class,action,object_id,code) SELECT ${reservation},${actor},'followup_reserved',${c.id},'reserved' WHERE (SELECT count(*) FROM scamwin_audit_events WHERE action='followup_reserved' AND created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')<20 AND (SELECT count(*) FROM scamwin_audit_events WHERE action='followup_reserved' AND actor_class=${actor} AND created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')<5 ON CONFLICT DO NOTHING RETURNING id`]);
  if (!reserved[1].length) throw new ScamwinStoreError('followup_quota');
  await store.appendMessage(subject, { checkId: c.id, role: 'user', content: text });
  try { const evidence = (await store.listObservations(subject, c.id)).filter(item => item.checkId === c.id && item.runId === c.runId); const answer = await answerFromEvidence(text, c.assessment, evidence); const message = await store.appendMessage(subject, { checkId: c.id, role: 'assistant', content: answer.answer, evidenceIds: answer.evidenceIds }); return { messageId: message.id }; }
  catch { throw new ScamwinStoreError('ai_unavailable'); }
}); }
export async function submitWarningAction(checkId: string, draft: { hostname: string; summary: string; category: string; evidenceIds: string[] }, consent: true) { return result(async () => { const { subject, store } = await requireScamwinUser(); const parsed = z.object({ hostname: z.string().max(253), summary: z.string().max(1500), category: z.string().max(80), evidenceIds: z.array(id).min(1).max(20) }).strict().parse(draft); if (consent !== true) throw new ScamwinStoreError('consent_required'); const warning = await store.submitWarning(subject, { ...parsed, checkId: id.parse(checkId), consent }); return { warningId: warning.id }; }); }
export async function reviewWarningAction(warningId: string, decision: 'approve' | 'reject' | 'request_information', reason: string, expectedRevision: number) { return result(async () => { const { subject, store } = await requireScamwinUser(); const warning = await store.reviewWarning(subject, id.parse(warningId), { decision, reason, expectedRevision }); await scheduleScamwinPublication(store); return { warningId: warning.id }; }); }
export async function retractWarningAction(warningId: string, reason: string) { return result(async () => { const { subject, store } = await requireScamwinUser(); const warning = await store.getWarning(id.parse(warningId)); if (!warning) throw new ScamwinStoreError('not_found'); await store.retractWarning(subject, warning.id, { reason, expectedRevision: warning.revision }); await scheduleScamwinPublication(store); return { warningId: warning.id }; }); }
export async function setOperationalPauseAction(scope:'investigation'|'publication',paused:boolean){return result(async()=>{const {subject,store}=await requireScamwinUser();await store.setOperationalPause(subject,z.enum(['investigation','publication']).parse(scope),z.boolean().parse(paused));return{state:await store.getOperationalState()};});}
