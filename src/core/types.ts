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

/**
 * Referência de mídia. Como entrada de `sendMedia`, pelo menos um entre `url` e `base64` deve
 * estar presente. Como saída em `WaMessage.media` (mensagem recebida), pode trazer só `id` quando
 * o provider não entrega `url`/`base64` prontos no webhook — nesse caso, `messages.download`
 * (ADR-0020) resolve o conteúdo real a partir do `messageId` (e de `WaMessage.raw`, para os
 * poucos providers stateless que precisam do descritor bruto original).
 */
export interface MediaRef {
  kind: MediaKind;
  url?: string;
  base64?: string;
  mimeType?: string;
  filename?: string;
  /** Identificador opaco do arquivo no provider — nunca usado como entrada de `sendMedia`. */
  id?: string;
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

/**
 * Ver ADR-0020. Baixa o arquivo de uma mensagem de mídia já recebida (`WaMessage.media.id`, sem
 * `url`/`base64` prontos). `messageId` é suficiente para providers com histórico server-side
 * (uazapi, Evolution GO, Whapi); `raw` (o `WaMessage.raw` da mensagem original) só é consumido por
 * providers stateless que não guardam histórico (ex.: izapia) e precisam do descritor bruto
 * original do webhook para resolver o download — os demais o ignoram.
 */
export interface DownloadMediaInput {
  messageId: string;
  raw?: unknown;
}

export interface DownloadedMedia {
  /** Conteúdo do arquivo, já em base64. */
  base64: string;
  mimeType?: string;
  filename?: string;
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

/**
 * Ver ADR-0014. Localização estática (não "ao vivo") — nenhum provider pesquisado confirma um
 * endpoint canônico de encerrar/atualizar uma live location já enviada, então esta fase cobre só o
 * envio simples.
 */
export interface SendLocationInput {
  to: string;
  latitude: number;
  longitude: number;
  /** Rótulo/título do pin (ex.: nome do local). Alguns providers exigem, outros ignoram. */
  name?: string;
  address?: string;
}

/**
 * Ver ADR-0014. Cartão de contato único (`vCard`). Campos simples e não o vCard bruto: providers
 * pesquisados ou já aceitam campos soltos (nome + telefone) ou exigem um vCard já montado — para os
 * últimos, o próprio adapter monta a string a partir destes dois campos (é trabalho de tradução,
 * não de validação — mesma responsabilidade que já cabe ao adapter para outras capabilities).
 */
export interface SendContactCardInput {
  to: string;
  contactName: string;
  contactPhone: string;
}

/**
 * Ver ADR-0014. `allowMultipleAnswers` ausente/`false` = escolha única (default mais restritivo e
 * mais amplamente suportado — pelo menos um provider pesquisado, Wuzapi, só aceita escolha única e
 * não tem como habilitar múltipla escolha nenhuma forma).
 */
export interface SendPollInput {
  to: string;
  question: string;
  /** Pelo menos 2 opções — todos os providers pesquisados rejeitam enquete com menos de 2. */
  options: string[];
  allowMultipleAnswers?: boolean;
}

/**
 * Ver ADR-0015. Vocabulário canônico do indicador de digitação/gravação por conversa
 * (`presence.setTyping`) — mapeia para o enum nativo do whatsmeow (`composing`/`recording`/
 * `paused`) que a maioria dos providers pesquisados já usa diretamente ou com pequenas variações
 * (ex.: Whapi usa `pause` no singular; Wuzapi expressa `recording` como `composing` + um campo
 * `Media: "audio"` separado). Sem estado "stop"/"idle" distinto — `paused` já é a convenção do
 * protocolo para "parar de mostrar o indicador".
 */
export type TypingState = 'composing' | 'recording' | 'paused';

/** Ver ADR-0015. */
export interface SetTypingInput {
  to: string;
  state: TypingState;
}

/**
 * Ver ADR-0015. Presença GLOBAL da conta (`presence.set`) — distinta do indicador por conversa
 * (`presence.setTyping`). Nenhum provider pesquisado usa vocabulário diferente de online/offline
 * para este conceito (alguns usam `available`/`unavailable` no wire, mas o significado é sempre
 * este par binário) — cada adapter traduz internamente.
 */
export type PresenceState = 'online' | 'offline';

/**
 * Etiqueta normalizada. Ver ADR-0016. `color` é uma string OPACA — cada provider usa um vocabulário
 * de cor diferente (índice numérico 0-19, nome de cor, hex, inteiro ARGB) e nenhum converge o
 * suficiente para justificar um vocabulário canônico; o valor é repassado como o adapter recebe,
 * documentado por provider no dossiê.
 */
export interface LabelInfo {
  id: string;
  name: string;
  color?: string;
  raw: unknown;
}

/** Ver ADR-0016. */
export interface CreateLabelInput {
  name: string;
  color?: string;
}

/**
 * Ver ADR-0016. Diferente de `CreateLabelInput`, `name` é sempre obrigatório aqui mesmo quando só
 * a cor muda — pelo menos um provider pesquisado (QuePasa) sobrescreve o campo com o que vier no
 * corpo da requisição (sem merge parcial no servidor), então enviar um `name` ausente/vazio
 * apagaria o nome atual. Exigir `name` sempre evita esse risco em todos os adapters, não só nesse.
 */
export interface UpdateLabelInput {
  labelId: string;
  name: string;
  color?: string;
}

/** Ver ADR-0016. Usado por `LabelsApi.addToChat`/`removeFromChat` (mesma forma para as duas direções). */
export interface LabelChatInput {
  chatId: string;
  labelId: string;
}

/**
 * Canal do WhatsApp ("WhatsApp Channels" — nome público do produto; a maioria dos providers chama
 * de "newsletter" internamente, herdado do protocolo reverso-projetado, ver ADR-0017). `id` é um
 * identificador OPACO (mesmo critério de `GroupInfo.id`, ADR-0009): normalmente um JID
 * `<dígitos>@newsletter`, repassado como o adapter recebe — nunca passa por `normalizeChatId`.
 */
export interface ChannelInfo {
  id: string;
  name: string;
  description?: string;
  subscribersCount?: number;
  raw: unknown;
}

/** Ver ADR-0017. */
export interface CreateChannelInput {
  name: string;
  description?: string;
}

/**
 * Post do feed de um canal (`channels.getMessages`, ver ADR-0021). `id` é o identificador opaco do
 * post no provider (ex.: `serverId`/`serverid`) — usado por `channels.markViewed`/`reactToPost`,
 * não é o `messageId` de uma mensagem de chat comum.
 */
export interface ChannelPost {
  id: string;
  /** Epoch em milissegundos. */
  timestamp: number;
  text?: string;
  viewsCount?: number;
  /** Mapa emoji -> contagem, quando o provider expõe. */
  reactionCounts?: Record<string, number>;
  raw: unknown;
}

/** Ver ADR-0021. */
export interface GetChannelMessagesInput {
  /** ID opaco do canal — ver `ChannelInfo.id`. */
  channelId: string;
  count?: number;
  /** Cursor de paginação (ID do post mais antigo já visto) — pede posts anteriores a ele. */
  before?: string;
}

/** Ver ADR-0021. */
export interface MarkChannelMessagesViewedInput {
  /** ID opaco do canal — ver `ChannelInfo.id`. */
  channelId: string;
  /** IDs opacos dos posts — ver `ChannelPost.id`. */
  messageIds: string[];
}

/** Ver ADR-0021. Emoji vazio remove uma reação já enviada (mesma convenção de `SendReactionInput`). */
export interface ReactToChannelMessageInput {
  /** ID opaco do canal — ver `ChannelInfo.id`. */
  channelId: string;
  /** ID opaco do post — ver `ChannelPost.id`. */
  messageId: string;
  emoji: string;
}

/**
 * Perfil comercial WhatsApp Business (ver ADR-0018) — distinto do perfil PESSOAL do WhatsApp
 * (nome/about/foto, fora de escopo aqui). `categories` é normalizado para uma lista de nomes
 * (o shape completo do objeto categoria diverge entre providers: uazapi usa
 * `{id, localized_display_name}`, Z-API usa `{id, label, displayName}` — o valor bruto por
 * categoria fica só em `raw`, mesmo critério já usado para `LabelInfo.color`/ADR-0016).
 */
export interface BusinessProfile {
  description?: string;
  address?: string;
  email?: string;
  websites?: string[];
  categories?: string[];
  raw: unknown;
}

/**
 * Ver ADR-0018. Ao menos 1 campo é obrigatório (o conector valida isso antes de chamar o
 * adapter) — nenhum provider confirmado aceita um update totalmente vazio.
 */
export interface UpdateBusinessProfileInput {
  description?: string;
  address?: string;
  email?: string;
}

/**
 * Ver ADR-0019. Origina uma chamada de voz — nuance real e universal entre os 2 providers
 * confirmados (uazapi/Z-API): NÃO estabelece áudio de fato ("chamada vazia"), só faz o telefone
 * tocar (usado tipicamente para notificar/"acordar" um contato ou testar liveness da conexão).
 */
export interface MakeCallInput {
  to: string;
  durationSeconds?: number;
}

/**
 * Ver ADR-0019. `callId`/`callerId` são obrigatórios em WAHA/Whapi/Wuzapi/Evolution GO
 * (identificam a chamada específica a rejeitar — só disponíveis inspecionando o payload bruto do
 * webhook recebido, já que este pacote não faz parsing de eventos de chamada nesta rodada);
 * WPPConnect exige só `callId`; uazapi não exige nenhum dos dois (corpo vazio rejeita a chamada
 * ativa no momento). `callerId` é normalizado como um chatId comum (não é opaco, ao contrário de
 * `callId`, que é um identificador de chamada específico do provider).
 */
export interface RejectCallInput {
  callId?: string;
  callerId?: string;
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
