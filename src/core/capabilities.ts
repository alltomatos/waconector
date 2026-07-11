/**
 * Capabilities declaradas: cada adapter anuncia exatamente o que o provider
 * suporta. O conector bloqueia chamadas fora do conjunto declarado com
 * `UnsupportedCapabilityError`, em vez de nivelar a API pelo mínimo
 * denominador comum.
 *
 * Este enum cresce junto com a superfície pública (novos namespaces em F1+).
 */
export const CAPABILITIES = [
  'instance.connect',
  'instance.pairingCode',
  'instance.status',
  'instance.logout',
  'messages.sendText',
  'messages.sendMedia',
  'messages.sendReaction',
  'groups.create',
  'groups.getInfo',
  'groups.list',
  'groups.addParticipants',
  'groups.removeParticipants',
  'groups.promoteParticipants',
  'groups.demoteParticipants',
  'webhooks.parse',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export type CapabilitySet = readonly Capability[];

export function hasCapability(set: CapabilitySet, capability: Capability): boolean {
  return set.includes(capability);
}

export function isKnownCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}
