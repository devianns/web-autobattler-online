import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Web Autobattler Online", description: "서버리스 결정론적 웹 오토배틀러 프로토타입" };
export default function RootLayout({ children }: LayoutProps<"/">) { return <html lang="ko"><body>{children}</body></html>; }
