import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Fixa a raiz de tracing NESTE diretório: sem isso, o Next.js sobe a árvore de diretórios e
  // acha o package-lock.json do waconector, inferindo (errado) uma raiz de workspace.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
