'use server';
import { getDesktopAccess } from '@/lib/desktop-access';
export async function openDesktop(input: string) {
  return getDesktopAccess(input);
}
