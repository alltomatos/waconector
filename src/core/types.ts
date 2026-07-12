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

/** Ver ADR-0012. */
export interface EditMessageInput {
  to: string;
  /** ID da mensagem original a ser editada. */
  messageId: string;
  /**
   * Novo texto da mensagem. Alguns providers também aceitam editar a legenda de uma mídia já
   * enviada — não confirmado de forma uniforme entre providers, então o contrato canônico só
   * assume texto; cada adapter documenta no próprio dossiê se aceita mais que isso.
   */
  text: string;
}

/**
 * Ver ADR-0012. Semântica é sempre revogação ("apagar para todos") — nenhum campo de escopo
 * (`onlyLocal`/`forEveryone`) nesta fase: só um provider pesquisado confirma essa distinção em
 * código, os demais não têm alternativa "local" confirmada.
 */
export interface DeleteMessageInput {
  to: string;
  /** ID da mensagem a ser apagada. */
  messageId: string;
}

/** Ver ADR-0013. */
export interface ForwardMessageInput {
  /** Chat de DESTINO do encaminhamento. */
  to: string;
  /** ID da mensagem a ser encaminhada. */
  messageId: string;
  /**
   * Chat de ORIGEM da mensagem — só necessário para providers que não conseguem resolver a
   * origem sozinhos a partir do `messageId` (a maioria resolve, já que o formato do id costuma
   * autoidentificar o chat de origem). Ausente = o adapter usa só `messageId`.
   */
  fromChatId?: string;
}

/** Ver ADR-0013. Usado por `MessagesApi.star`/`unstar` (mesma forma para as duas direções). */
export interface StarMessageInput {
  to: string;
  messageId: string;
}

/**
 * Ver ADR-0013. Usado por `MessagesApi.pin`/`unpin` (mesma forma para as duas direções). Sem
 * campo de duração — nenhum formato converge entre os providers pesquisados (mesmo critério já
 * usado para `chats.mute`, ADR-0012); cada adapter decide seu próprio default/sentinela.
 */
export interface PinMessageInput {
  to: string;
  messageId: string;
}

/** Ver ADR-0013. Nível de MENSAGEM — distinto de `chats.markRead` (nível de conversa, ADR-0012). */
export interface MarkMessageReadInput {
  to: string;
  messageId: string;
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

export interface UpdateGroupSubjectInput {
  /** ID opaco do grupo — ver `GroupInfo.id`. */
  groupId: string;
  subject: string;
}

export interface UpdateGroupDescriptionInput {
  /** ID opaco do grupo — ver `GroupInfo.id`. */
  groupId: string;
  /** String vazia limpa a descrição do grupo (suportado por todos os providers pesquisados). */
  description: string;
}

export interface UpdateGroupPictureInput {
  /** ID opaco do grupo — ver `GroupInfo.id`. */
  groupId: string;
  /** `media.kind` deve ser `'image'` — grupos só aceitam foto, não vídeo/áudio/documento/figurinha. */
  media: MediaRef;
}

/**
 * Link de convite de grupo. `link` é sempre o formato completo
 * (`https://chat.whatsapp.com/<código>`), normalizado pelo core mesmo quando o provider devolve só
 * o código bare (ver `normalizeInviteLink` em `chat-id.ts`) — diferente do `groupId` (opaco por
 * provider), o link de convite é um formato universal do próprio WhatsApp.
 */
export interface GroupInviteLink {
  link: string;
  raw: unknown;
}

export interface JoinGroupInviteInput {
  /** Código do convite OU link completo (`https://chat.whatsapp.com/<código>`) — ambos aceitos. */
  invite: string;
}

/**
 * Contato normalizado (ver ADR-0010). `id` é o MESMO chatId canônico usado por `messages.*`
 * (telefone E.164 ou JID explícito) — diferente de `GroupInfo.id`, não é opaco por provider.
 * Todos os campos de detalhe são opcionais: nenhum provider pesquisado confirma todos ao mesmo
 * tempo numa única chamada (ex.: Evolution GO/Wuzapi não devolvem nome de exibição no endpoint
 * mais próximo de "getContact"). O adapter NUNCA compõe múltiplas requisições para preencher os
 * campos ausentes — mapeia o melhor match de uma única chamada e deixa o resto `undefined`.
 */
export interface Contact {
  id: string;
  name?: string;
  about?: string;
  profilePictureUrl?: string;
  hasWhatsApp?: boolean;
  isBlocked?: boolean;
  raw: unknown;
}

export interface CheckExistsResult {
  exists: boolean;
  /** chatId canônico resolvido pelo provider — nem todos devolvem isso quando `exists` é `false`. */
  chatId?: string;
  raw: unknown;
}

export interface ContactProfilePicture {
  /** Ausente quando o contato não tem foto ou a privacidade dele não permite. */
  url?: string;
  raw: unknown;
}

export interface ContactAbout {
  /** Ausente quando o contato não tem recado definido ou a privacidade dele não permite. */
  about?: string;
  raw: unknown;
}
