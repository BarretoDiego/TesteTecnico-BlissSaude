import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SessionProvider } from "~/providers/SessionProvider";
import "./globals.css";

export const metadata: Metadata = {
	title: "Saúde Bliss — Backoffice",
	description: "Gestão e conferência de solicitações",
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="pt-BR">
			<body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
				<SessionProvider>{children}</SessionProvider>
			</body>
		</html>
	);
}
