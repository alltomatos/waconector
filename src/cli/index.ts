import { parseArgs } from 'node:util';
import { formatDoctorReport, PROVIDER_NAMES, runDoctor } from './doctor';

const HELP_TEXT = `waconector — CLI de diagnóstico

Uso:
  waconector doctor --provider <nome>   Testa a conexão com um provider configurado via env vars
  waconector --help                     Mostra esta ajuda

Providers suportados: ${PROVIDER_NAMES.join(', ')}

O provider pode vir de --provider (ou -p) ou da variável WACONECTOR_PROVIDER — --provider tem
precedência. As demais opções (URL base, token, sessão, etc.) vêm sempre de variáveis
WACONECTOR_* específicas do provider escolhido; rode "waconector doctor --provider <nome>" sem
essas variáveis definidas para ver exatamente quais são exigidas.

"doctor" só faz uma checagem de leitura (instance.status()) — nunca chama connect() nem altera
o estado da instância no provider.`;

function parseCliArgs(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      provider: { type: 'string', short: 'p' },
      help: { type: 'boolean', short: 'h' },
    },
  } as const);
}

async function run(): Promise<number> {
  let values: ReturnType<typeof parseCliArgs>['values'];
  let positionals: ReturnType<typeof parseCliArgs>['positionals'];
  try {
    ({ values, positionals } = parseCliArgs(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  if (values.help) {
    process.stdout.write(`${HELP_TEXT}\n`);
    return 0;
  }

  const [command] = positionals;
  if (command !== 'doctor') {
    process.stderr.write(
      `Comando desconhecido: "${command ?? ''}". Use "waconector --help" para ver o uso.\n`,
    );
    return 1;
  }

  const provider = values.provider ?? process.env.WACONECTOR_PROVIDER;
  if (!provider) {
    process.stderr.write(
      'Faltou --provider (ou defina WACONECTOR_PROVIDER). Use "waconector --help".\n',
    );
    return 1;
  }

  const color = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
  const report = await runDoctor(provider, process.env);
  process.stdout.write(`${formatDoctorReport(report, { color })}\n`);
  return report.ok ? 0 : 1;
}

const exitCode = await run();
process.exit(exitCode);
