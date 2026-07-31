/**
 * Empacota o microserviço `bliss-reviews` para a Lambda.
 *
 * A lógica vive em `apps/api/scripts/build-service.js` — bundler é infraestrutura
 * compartilhada, e uma correção lá precisa valer para todos os serviços de uma vez.
 */

const { buildService } = require("../../scripts/build-service");

buildService({ serviceDir: __dirname, serviceName: "bliss-reviews" }).catch((error) => {
	console.error("falha no build:", error);
	process.exit(1);
});
