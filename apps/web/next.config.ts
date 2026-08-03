import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	/**
	 * `@saude-bliss/contracts` é exposto como TypeScript, sem etapa de build —
	 * sem isto o Next tenta carregar `.ts` de node_modules e falha. É o mesmo
	 * motivo pelo qual o esbuild dos microserviços o embute no bundle.
	 */
	transpilePackages: ["@saude-bliss/contracts"],

	typescript: {
		// A checagem fica desligada no build, confiando no `typecheck`
		// separado. Aqui ela fica ligada: o build é o último portão antes do
		// deploy, e desligá-la significa descobrir erro de tipo em produção.
		ignoreBuildErrors: false,
	},
};

export default nextConfig;
