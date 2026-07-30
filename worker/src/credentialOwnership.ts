// credentialOwnership.ts — A8-H3 Slice H3-1b (W1) shared ownership predicate.
//
// Belt-and-suspenders with the DB composite FK (migration 021): the worker refuses to decrypt or
// trade on a credential whose owner (user_exchange_credentials.user_id) does not match the bot's
// user_id. One predicate, used at BOTH resolution sites (processMessage + reconciliation) so they
// cannot drift. Non-secret: compares two owner UUIDs only.

/** True iff the credential is owned by the bot's user. Both ids are non-secret owner UUIDs. */
export function credentialOwnershipOk(credentialUserId: string, botUserId: string): boolean {
  return credentialUserId === botUserId
}
