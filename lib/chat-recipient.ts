export function resolveRecipientId(members: { id: string }[], selected: string) {
  return members.some(member => member.id === selected) ? selected : members[0]?.id ?? '';
}
