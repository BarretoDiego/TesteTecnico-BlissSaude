/**
 * @module automation/reporters/CsvReporter
 *
 * Relatório operacional da conferência, em CSV.
 *
 * É um **reporter**, não uma escrita dentro do teste, por um motivo específico:
 * o arquivo precisa sair mesmo quando a suíte falha — que é exatamente o momento
 * em que a operação precisa saber o que foi conferido e o que divergiu.
 *
 * Os testes anexam cada linha via `testInfo.attach`; o reporter recolhe e grava
 * no encerramento.
 */

import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Uma linha do relatório — uma solicitação conferida. */
export interface ConferenciaRow {
	runId: string;
	requestId: string;
	solicitacaoId: string;
	title: string;
	createdBy: string;
	priority: string;
	statusUI: string;
	statusAPI: string;
	divergencia: boolean;
	acao: string;
	resultado: string;
}

const COLUMNS = [
	"runId",
	"timestamp",
	"requestId",
	"solicitacaoId",
	"title",
	"createdBy",
	"priority",
	"statusUI",
	"statusAPI",
	"divergencia",
	"acao",
	"resultado",
	"durationMs",
	"teste",
] as const;

/** Escapa um valor para CSV: aspas duplicadas e campo entre aspas. */
function escape(value: unknown): string {
	const text = String(value ?? "");
	return `"${text.replace(/"/g, '""')}"`;
}

export default class CsvReporter implements Reporter {
	private readonly rows: string[][] = [];
	private readonly outputFile: string;

	constructor(options: { outputFile?: string } = {}) {
		const date = new Date().toISOString().slice(0, 10);
		this.outputFile = options.outputFile ?? join("reports", `conferencia-${date}.csv`);
	}

	onTestEnd(test: TestCase, result: TestResult): void {
		for (const attachment of result.attachments) {
			if (attachment.name !== "conferencia-row") continue;

			/**
			 * O conteúdo vem em `body` **ou** em `path`: o Playwright grava anexos em
			 * disco em vez de mantê-los na memória a partir de certo tamanho, e a
			 * decisão não é controlada por quem anexa. Ler só `body` produz um CSV
			 * com cabeçalho e nenhuma linha — que passa despercebido justamente por
			 * o arquivo existir.
			 */
			const raw = attachment.body ?? (attachment.path ? readFileSync(attachment.path) : undefined);
			if (!raw) continue;

			try {
				const row = JSON.parse(raw.toString()) as ConferenciaRow;
				this.rows.push([
					row.runId,
					new Date().toISOString(),
					row.requestId,
					row.solicitacaoId,
					row.title,
					row.createdBy,
					row.priority,
					row.statusUI,
					row.statusAPI,
					row.divergencia ? "sim" : "não",
					row.acao,
					row.resultado,
					String(result.duration),
					test.title,
				]);
			} catch {
				// Anexo malformado não pode derrubar o relatório inteiro: uma linha
				// perdida é recuperável, um reporter que lança apaga tudo.
			}
		}
	}

	onEnd(result: FullResult): void {
		mkdirSync(dirname(this.outputFile), { recursive: true });

		const lines = [COLUMNS.join(","), ...this.rows.map((row) => row.map(escape).join(","))];
		// BOM para o Excel em português abrir com acentuação correta — quem consome
		// este arquivo é a operação, não um script.
		writeFileSync(this.outputFile, `﻿${lines.join("\n")}\n`, "utf8");

		console.log(
			`\n  relatório de conferência: ${this.outputFile} (${this.rows.length} linha(s), status ${result.status})`
		);
	}
}
