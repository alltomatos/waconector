import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitepress';

const docsRoot = fileURLToPath(new URL('..', import.meta.url));

/**
 * Lê o H1 de um Markdown para usar como label de sidebar — evita manter uma lista de títulos
 * separada da lista de arquivos (mesmo racional de scripts/adapter-subpaths.mjs: uma única fonte
 * de verdade). Cai no nome do arquivo se não achar H1.
 */
function titleFromMarkdown(absPath: string, fallback: string): string {
  const match = readFileSync(absPath, 'utf8').match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() ?? fallback;
}

/** Gera itens de sidebar a partir de todo .md em `dir` (não recursivo), na ordem do nome do arquivo. */
function sidebarFromDir(dir: string, linkPrefix: string) {
  return readdirSync(path.join(docsRoot, dir))
    .filter((file) => file.endsWith('.md') && file !== 'README.md')
    .sort()
    .map((file) => {
      const slug = file.replace(/\.md$/, '');
      return {
        text: titleFromMarkdown(path.join(docsRoot, dir, file), slug),
        link: `${linkPrefix}/${slug}`,
      };
    });
}

export default defineConfig({
  title: 'waconector',
  description:
    'Conector universal para APIs não-oficiais de WhatsApp — um contrato, um adapter por provider.',
  lang: 'pt-BR',
  // Pages de PROJETO (github.com/alltomatos/waconector) serve em
  // https://alltomatos.github.io/waconector/ — não é um site de usuário/organização.
  base: '/waconector/',
  cleanUrls: true,
  srcExclude: [
    // docs/agents/** é governança interna de agentes (skills, triage), não documentação pública.
    // Excluído do SITE, não movido/renomeado — outras ferramentas (skill waconector) referenciam
    // esses caminhos.
    'agents/**',
  ],
  ignoreDeadLinks: [
    // CONTEXT.md linka pro CONTRIBUTING.md na raiz do repo, fora do srcDir do site — o arquivo
    // existe no repositório, só não faz parte das páginas publicadas. VitePress normaliza o link
    // resolvido (remove extensão, mantém o prefixo "./../"), por isso o regex casa só pelo nome.
    /CONTRIBUTING(\.md)?$/,
  ],
  themeConfig: {
    nav: [
      { text: 'Guia', link: '/CONTEXT' },
      { text: 'Capabilities', link: '/capabilities' },
      { text: 'Providers', link: '/providers/README' },
      { text: 'ADRs', link: '/adr/0001-pacote-unico-subpath-exports' },
      { text: 'npm', link: 'https://www.npmjs.com/package/waconector' },
    ],
    sidebar: [
      {
        text: 'Guia',
        items: [
          { text: 'Visão geral', link: '/CONTEXT' },
          { text: 'Matriz de capabilities', link: '/capabilities' },
        ],
      },
      {
        text: 'Providers',
        items: [
          { text: 'Metodologia dos dossiês', link: '/providers/README' },
          ...sidebarFromDir('providers', '/providers'),
        ],
      },
      { text: 'ADRs', items: sidebarFromDir('adr', '/adr') },
    ],
    search: { provider: 'local' },
    socialLinks: [{ icon: 'github', link: 'https://github.com/alltomatos/waconector' }],
    editLink: {
      // develop é o branch de integração (docs-sync.yml também commita ali) — não main.
      pattern: 'https://github.com/alltomatos/waconector/edit/develop/docs/:path',
      text: 'Editar esta página no GitHub',
    },
    footer: {
      message: 'Client HTTP para APIs de terceiros — sem afiliação com Meta/WhatsApp.',
      copyright: 'MIT',
    },
  },
});
