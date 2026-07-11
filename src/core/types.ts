/**
 * Tipos canônicos do domínio waconector.
 *
 * Regra de ouro: normalizar o comum, preservar o específico — todo objeto
 * normalizado carrega `raw` com o payload original do provider.
 */

export const INSTANCE_STATES = [
  'disconnected',
  'connecting',
  'qr',
  'connected',
  'unknown',
] as const;

/** Estado normalizado de uma instância/sessão de WhatsApp. */
export type InstanceState = (typeof INSTANCE_STATES)[number];

export interface InstanceStatus {
  state: InstanceState;
  raw: unknown;
}

export interface ConnectResult {
  /** Conteúdo do QR code (string/base64) quando o provider expõe. */
  qr?: string;
  /** Código de pareamento quando o provider suporta `instance.pairingCode`. */
  pairingCode?: string;
  raw: unknown;
}

export const MESSAGE_ACKS = ['pending', 'sent', 'delivered', 'read', 'played', 'error'] as const;

/** Status de entrega normalizado de uma mensagem. */
export type MessageAck = (typeof MESSAGE_ACKS)[number];

export type MessageKind =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'sticker'
  | 'location'
  | 'contact'
  | 'reaction'
  | 'poll'
  | 'unknown';

export type MediaKind = 'image' | 'video' | 'audio' | 'document' | 'sticker';

/** Referência de mídia: pelo menos um entre `url` e `base64` deve estar presente. */
export interface MediaRef {
  kind: MediaKind;
  url?: string;
  base64?: string;
  mimeType?: string;
  filename?: string;
}

/** Detalhe de uma reação (presente em `WaMessage` quando `kind === 'reaction'`). */
export interface ReactionInfo {
  /** Emoji da reação (ex.: `'👍'`). String vazia representa remoção de uma reação anterior. */
  emoji: string;
  /** ID da mensagem original que recebeu a reação. */
  targetMessageId: string;
}

/** Mensagem normalizada (recebida ou ecoada via webhook). */
export interface WaMessage {
  id: string;
  chatId: string;
  from?: string;
  fromMe: boolean;
  /** Epoch em milissegundos. */
  timestamp: number;
  kind: MessageKind;
  text?: string;
  media?: MediaRef;
  quotedId?: string;
  /** Presente quando `kind === 'reaction'`. Ver ADR-0008. */
  reaction?: ReactionInfo;
  raw: unknown;
}

/** Resultado normalizado de um envio. */
export interface SentMessage {
  id: string;
  chatId: string;
  /** Epoch em milissegundos, quando o provider informa. */
  timestamp?: number;
  raw: unknown;
}

export interface SendTextInput {
  /** Telefone E.164 (com ou sem `+`/pontuação) ou JID explícito (`...@g.us`, `...@s.whatsapp.net`). */
  to: string;
  text: string;
  quotedId?: string;
  mentions?: string[];
}

export interface SendMediaInput {
  to: string;
  media: MediaRef;
  caption?: string;
  quotedId?: string;
}

export interface SendReactionInput {
  to: string;
  /** ID da mensagem a reagir. */
  messageId: string;
  /** Emoji da reação (ex.: `'👍'`). String vazia remove uma reação já enviada. */
  emoji: string;
}

/** Participante de um grupo, normalizado. Ver ADR-0009. */
export interface GroupParticipant {
  /** Telefone E.164 sem `+` ou JID explícito — mesma convenção de chatId de mensagem. */
  id: string;
  isAdmin: boolean;
  isSuperAdmin: boolean;
}

/**
 * Grupo normalizado. `id` é um identificador OPACO do grupo (ver ADR-0009): a maioria dos
 * providers usa JID (`...@g.us`), mas a Z-API usa um ID sintético sem `@` — por isso `id` nunca
 * passa por `normalizeChatId` no conector, diferente do `to` de mensagens.
 */
export interface GroupInfo {
  id: string;
  subject: string;
  /** Nem todo provider retorna descrição/dono no payload de metadados do grupo. */
  description?: string;
  owner?: string;
  participants: GroupParticipant[];
  raw: unknown;
}

export interface CreateGroupInput {
  subject: string;
  /** Telefones E.164 (com ou sem `+`/pontuação) ou JIDs explícitos dos participantes iniciais. */
  participants: string[];
}

export interface GroupParticipantsInput {
  /** ID opaco do grupo — ver `GroupInfo.id`. */
  groupId: string;
  /** Telefones E.164 (com ou sem `+`/pontuação) ou JIDs explícitos dos participantes-alvo. */
  participants: string[];
}
