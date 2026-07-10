# ADR-0005: Capabilities declaradas com erro tipado

- Status: aceito
- Data: 2026-07-10

## Contexto

Nem todo provider suporta tudo (enquetes, botões, pairing code, comunidades). As armadilhas
clássicas de um conector universal: nivelar a API pelo mínimo denominador comum (empobrece) ou
deixar cada adapter expor métodos próprios (quebra a portabilidade).

## Decisão

- O core define o enum `CAPABILITIES`; cada adapter declara exatamente o que suporta em
  `capabilities`.
- O conector bloqueia chamadas fora do conjunto com `UnsupportedCapabilityError` (código
  `UNSUPPORTED_CAPABILITY`).
- O consumidor consulta em runtime: `wa.supports('messages.sendMedia')`.

## Justificativa

- A superfície completa fica disponível e tipada; a incompatibilidade é um erro explícito e
  detectável, não um 404 misterioso do provider.
- A matriz de capabilities por provider pode ser gerada do código para a documentação.

## Consequências

- O enum `CAPABILITIES` cresce junto com a superfície pública (F1: grupos, contatos, reactions...).
- A suite de contrato valida que adapters só declaram capabilities conhecidas.
