/**
 * Empacotador compartilhado dos microserviços.
 *
 * Cada `functions/<serviço>/build.js` chama esta função. O bundler fica fora dos
 * serviços pelo mesmo motivo que o runtime: uma correção na configuração do
 * esbuild — e há várias sutis aqui — precisa valer para todos de uma vez.
 *
 * Saída: `dist/app.js` (bundle) e `dist/function.zip` (artefato). O Terraform e o
 * `serverless package` consomem **o mesmo zip**, então não existe divergência
 * entre o que se testa localmente e o que sobe.
 */

const esbuild = require("esbuild");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

/**
 * `pg` referencia dois módulos que não existem em Node comum:
 *
 * - `pg-native`: binding nativo opcional. Sem `external`, o esbuild falha ao
 *   resolver e aborta o build.
 * - `cloudflare:sockets`: importado por `pg-cloudflare` para rodar em Workers.
 *   Não é resolvível por um bundler de Node, e um `external` simples não pega
 *   porque o esquema `cloudflare:` não casa com nome de pacote — daí o plugin.
 *
 * Falha aqui não aparece no build: aparece como crash de cold start dentro do
 * LocalStack, que é um péssimo lugar para descobrir o problema.
 */
const cloudflareSocketsPlugin = {
	name: "cloudflare-sockets-external",
	setup(build) {
		build.onResolve({ filter: /^cloudflare:sockets$/ }, () => ({ path: "cloudflare:sockets", external: true }));
	},
};

/**
 * Empacota um microserviço.
 *
 * @param {object} options
 * @param {string} options.serviceDir  Diretório do serviço (use `__dirname`).
 * @param {string} options.serviceName Nome, ex.: `bliss-requests`.
 */
async function buildService({ serviceDir, serviceName }) {
	const env = process.env.BLISS_ENV ?? "local";
	const distDir = path.join(serviceDir, "dist");
	const bundlePath = path.join(distDir, "app.js");
	const zipPath = path.join(distDir, "function.zip");

	fs.rmSync(distDir, { recursive: true, force: true });
	fs.mkdirSync(distDir, { recursive: true });

	console.log(`[${serviceName}] empacotando para ${env}...`);

	await esbuild.build({
		entryPoints: [path.join(serviceDir, "src/app.ts")],
		outfile: bundlePath,
		bundle: true,
		platform: "node",
		format: "cjs",
		/**
		 * `node20` e não `node22` de propósito: o bundle roda tanto em `nodejs20.x`
		 * — teto do LocalStack v3, que valida o runtime contra a lista da AWS da
		 * época dele — quanto em `nodejs22.x` da AWS real. Mirar node22 geraria
		 * sintaxe que o ambiente local rejeita, e a falha apareceria só em runtime.
		 */
		target: ["node20"],
		// Sem isso, o minifier renomeia classes e todo `module` dos logs vira uma
		// letra — inutilizando a consulta por módulo no Logs Insights.
		keepNames: true,
		minify: env === "prod",
		sourcemap: env !== "prod",
		treeShaking: true,
		external: ["pg-native"],
		plugins: [cloudflareSocketsPlugin],
		// O `SERVICE_NAME` fica no bundle para que métricas e logs saibam quem são
		// mesmo antes de qualquer variável de ambiente ser lida.
		define: { "process.env.SERVICE_NAME": JSON.stringify(serviceName) },
		loader: { ".json": "json" },
		logLevel: "info",
	});

	/**
	 * Verificação do bundle.
	 *
	 * Build bem-sucedido não garante bundle carregável — um `require` que o
	 * esbuild resolveu para o lugar errado só falha ao ser executado. Carregar o
	 * artefato aqui transforma um crash de cold start em erro de build.
	 */
	console.log(`[${serviceName}] verificando o bundle...`);
	execFileSync(
		process.execPath,
		[
			"-e",
			`const m = require(${JSON.stringify(bundlePath)});
		if (typeof m.lambdaHandler !== "function") {
			throw new Error("bundle não exporta lambdaHandler");
		}`,
		],
		{ stdio: "inherit" }
	);

	// `zip -j` achata a estrutura: a Lambda espera o handler na raiz do pacote.
	execFileSync("zip", ["-j", "-q", zipPath, bundlePath], { stdio: "inherit" });

	const sizeMb = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(2);
	console.log(`[${serviceName}] ok → dist/function.zip (${sizeMb} MB)`);
}

module.exports = { buildService };
