/**
 * Sessão do usuário.
 *
 * Concentra as decisões de segurança do lado do cliente: onde cada token fica,
 * o que acontece quando a restauração falha, e o que sobra guardado depois do
 * logout. São afirmações que a suíte Playwright não alcança — ela vê a tela, não
 * o `localStorage`.
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import { SessionProvider, useSession } from "~/providers/SessionProvider";
import { AuthService } from "~/services/auth.service";
import { ApiError, getAccessToken, setAccessToken } from "~/services/instances";

const replace = jest.fn();
const push = jest.fn();

jest.mock("next/navigation", () => ({
	useRouter: () => ({ replace, push }),
}));

jest.mock("~/services/auth.service");

const authMock = AuthService as jest.Mocked<typeof AuthService>;

const CHAVE = "saude-bliss.refresh-token";

const USUARIO = {
	id: "161847b0-900d-4569-80a1-0fc6aac59e1a",
	email: "daniel@saudebliss.test",
	name: "Daniel Morais",
	roles: ["admin" as const],
};

const sessao = (refreshToken = "refresh-novo") => ({
	accessToken: "jwt-de-acesso",
	expiresIn: 900,
	tokenType: "Bearer" as const,
	refreshToken,
	user: USUARIO,
});

/**
 * Expõe o contexto para as asserções, sem depender de nenhuma tela real.
 *
 * `contexto` é capturado numa variável além dos botões porque os handlers
 * descartam a promise (`void login(...)`), como a tela real faz. Quem precisa
 * afirmar sobre a rejeição chama o método direto.
 */
let contexto: ReturnType<typeof useSession>;

function Sonda() {
	contexto = useSession();
	const { user, loading, login, logout } = contexto;

	return (
		<div>
			<span data-testid="loading">{String(loading)}</span>
			<span data-testid="user">{user?.email ?? "sem-sessao"}</span>
			<button onClick={() => void login("daniel@saudebliss.test", "saudebliss123")}>entrar</button>
			<button onClick={() => void logout()}>sair</button>
		</div>
	);
}

function montar() {
	return render(
		<SessionProvider>
			<Sonda />
		</SessionProvider>
	);
}

beforeEach(() => {
	localStorage.clear();
	setAccessToken(undefined);
	replace.mockClear();
	push.mockClear();
});

describe("restauração da sessão na carga", () => {
	it("não consulta a API quando não há refresh token guardado", async () => {
		montar();

		await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
		expect(authMock.refresh).not.toHaveBeenCalled();
		expect(screen.getByTestId("user")).toHaveTextContent("sem-sessao");
	});

	it("troca o refresh token guardado por uma sessão nova", async () => {
		localStorage.setItem(CHAVE, "refresh-guardado");
		authMock.refresh.mockResolvedValue(sessao());

		montar();

		await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("daniel@saudebliss.test"));
		expect(authMock.refresh).toHaveBeenCalledWith("refresh-guardado");
	});

	it("guarda o refresh token rotacionado", async () => {
		localStorage.setItem(CHAVE, "refresh-antigo");
		authMock.refresh.mockResolvedValue(sessao("refresh-rotacionado"));

		montar();

		// A API rotaciona a cada renovação. Manter o antigo faria a próxima
		// tentativa usar um token já revogado — e disparar a detecção de reuso,
		// derrubando todas as sessões do usuário.
		await waitFor(() => expect(localStorage.getItem(CHAVE)).toBe("refresh-rotacionado"));
	});

	it("limpa o token guardado quando a restauração falha", async () => {
		localStorage.setItem(CHAVE, "refresh-expirado");
		authMock.refresh.mockRejectedValue(new ApiError("INVALID_REFRESH_TOKEN", "Token inválido", 401));

		montar();

		await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

		// Falha aqui é esperada — token expirado, revogado ou ausente — e resulta
		// em sessão vazia, não em erro na tela.
		expect(localStorage.getItem(CHAVE)).toBeNull();
		expect(screen.getByTestId("user")).toHaveTextContent("sem-sessao");
	});

	it("limpa o access token em memória quando a restauração falha", async () => {
		localStorage.setItem(CHAVE, "refresh-expirado");
		setAccessToken("token-velho");
		authMock.refresh.mockRejectedValue(new Error("qualquer"));

		montar();

		await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
		expect(getAccessToken()).toBeUndefined();
	});

	it("sai do estado de carregamento mesmo quando falha", async () => {
		localStorage.setItem(CHAVE, "refresh-ruim");
		authMock.refresh.mockRejectedValue(new Error("falhou"));

		montar();

		// Sem isto a tela ficaria presa em "Carregando…" para sempre — o pior
		// desfecho, porque não há nada que o usuário possa fazer.
		await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
	});
});

describe("login", () => {
	it("guarda o refresh token e publica o usuário", async () => {
		authMock.login.mockResolvedValue(sessao("refresh-do-login"));
		montar();
		await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

		await act(async () => {
			screen.getByText("entrar").click();
		});

		expect(localStorage.getItem(CHAVE)).toBe("refresh-do-login");
		expect(screen.getByTestId("user")).toHaveTextContent("daniel@saudebliss.test");
	});

	it("repassa as credenciais recebidas", async () => {
		authMock.login.mockResolvedValue(sessao());
		montar();
		await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

		await act(async () => {
			screen.getByText("entrar").click();
		});

		expect(authMock.login).toHaveBeenCalledWith({
			email: "daniel@saudebliss.test",
			password: "saudebliss123",
		});
	});

	it("propaga a falha para a tela decidir a mensagem", async () => {
		// A tela de login repete a mensagem da API em vez de adivinhar: o 401 é o
		// mesmo para e-mail inexistente e senha errada, de propósito.
		authMock.login.mockRejectedValue(new ApiError("INVALID_CREDENTIALS", "Credenciais inválidas", 401));
		montar();
		await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

		// Direto no contexto: pelo botão a promise é descartada, e a rejeição
		// viraria "unhandled" atribuída a outro teste.
		await expect(contexto.login("daniel@saudebliss.test", "errada")).rejects.toBeInstanceOf(ApiError);

		expect(localStorage.getItem(CHAVE)).toBeNull();
	});

	it("não publica usuário quando o login falha", async () => {
		authMock.login.mockRejectedValue(new ApiError("INVALID_CREDENTIALS", "Credenciais inválidas", 401));
		montar();
		await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

		await contexto.login("daniel@saudebliss.test", "errada").catch(() => undefined);

		expect(screen.getByTestId("user")).toHaveTextContent("sem-sessao");
	});
});

describe("logout", () => {
	it("revoga no servidor usando o token guardado", async () => {
		localStorage.setItem(CHAVE, "refresh-a-revogar");
		authMock.refresh.mockResolvedValue(sessao());
		authMock.logout.mockResolvedValue(undefined);
		montar();
		await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("daniel"));

		await act(async () => {
			screen.getByText("sair").click();
		});

		// Só apagar o token local deixaria a sessão viva no servidor até expirar.
		expect(authMock.logout).toHaveBeenCalled();
	});

	it("limpa o armazenamento e o usuário", async () => {
		localStorage.setItem(CHAVE, "refresh-x");
		authMock.refresh.mockResolvedValue(sessao());
		authMock.logout.mockResolvedValue(undefined);
		montar();
		await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("daniel"));

		await act(async () => {
			screen.getByText("sair").click();
		});

		expect(localStorage.getItem(CHAVE)).toBeNull();
		expect(screen.getByTestId("user")).toHaveTextContent("sem-sessao");
	});

	it("leva de volta para o login", async () => {
		localStorage.setItem(CHAVE, "refresh-x");
		authMock.refresh.mockResolvedValue(sessao());
		authMock.logout.mockResolvedValue(undefined);
		montar();
		await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("daniel"));

		await act(async () => {
			screen.getByText("sair").click();
		});

		expect(push).toHaveBeenCalledWith("/login");
	});

	it("não chama o servidor quando não há token guardado", async () => {
		montar();
		await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

		await act(async () => {
			screen.getByText("sair").click();
		});

		expect(authMock.logout).not.toHaveBeenCalled();
		expect(push).toHaveBeenCalledWith("/login");
	});
});

describe("useSession fora do provedor", () => {
	it("falha alto em vez de devolver contexto vazio", () => {
		// Um `undefined` silencioso viraria "usuário não logado" em toda tela que
		// esquecesse o provedor — bug difícil de rastrear até a origem.
		const silencioso = jest.spyOn(console, "error").mockImplementation(() => {});

		expect(() => render(<Sonda />)).toThrow(/SessionProvider/);

		silencioso.mockRestore();
	});
});
