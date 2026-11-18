import { PROVIDERS } from "@/lib/engine/evaluation/provider";

export function GET() {
  return Response.json({
    ok: true,
    app: "all-in-capital",
    mode: "demo",
    providers: PROVIDERS.map((p) => p.status()),
    time: new Date().toISOString(),
  });
}
