import { redirect } from "next/navigation";

/** A raiz não tem conteúdo próprio — a tela inicial é a fila de conferência. */
export default function Home() {
	redirect("/solicitacoes");
}
