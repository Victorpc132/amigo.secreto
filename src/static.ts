import { extname, join, normalize, sep } from "node:path";

/**
 * Entrega os arquivos da pasta "public" de forma rápida:
 *  - guarda os arquivos na memória (e recarrega sozinho se você editar);
 *  - comprime com gzip os arquivos de texto;
 *  - usa ETag, então o navegador só baixa de novo se o arquivo mudou.
 */

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

export interface Asset {
  body: Uint8Array;
  gzip: Uint8Array | null;
  type: string;
  etag: string;
  mtime: number;
}

export class StaticFiles {
  private cache = new Map<string, Asset>();

  constructor(private root: string) {}

  async get(relativePath: string): Promise<Asset | null> {
    const ext = extname(relativePath);
    if (!relativePath || !(ext in TYPES)) return null;

    const abs = normalize(join(this.root, relativePath));
    if (!abs.startsWith(this.root + sep)) return null; // bloqueia "../"

    const file = Bun.file(abs);
    if (!(await file.exists())) return null;

    const mtime = file.lastModified;
    const cached = this.cache.get(abs);
    if (cached && cached.mtime === mtime) return cached;

    const body = new Uint8Array(await file.arrayBuffer());
    const type = TYPES[ext]!;
    const compressible = /^(text\/|application\/(json|manifest)|image\/svg)/.test(type) && body.length > 800;
    const asset: Asset = {
      body,
      gzip: compressible ? Bun.gzipSync(body) : null,
      type,
      etag: `"${new Bun.CryptoHasher("sha1").update(body).digest("hex").slice(0, 16)}"`,
      mtime,
    };
    this.cache.set(abs, asset);
    return asset;
  }

  respond(asset: Asset, req: Request): Response {
    const headers: Record<string, string> = {
      "content-type": asset.type,
      etag: asset.etag,
      vary: "Accept-Encoding",
      "cache-control": "no-cache", // "confira com o servidor", e o ETag responde 304 se nada mudou
    };
    if (req.headers.get("if-none-match") === asset.etag) {
      return new Response(null, { status: 304, headers });
    }
    const useGzip = asset.gzip !== null && (req.headers.get("accept-encoding") ?? "").includes("gzip");
    const body = useGzip ? asset.gzip! : asset.body;
    if (useGzip) headers["content-encoding"] = "gzip";
    return new Response(req.method === "HEAD" ? null : body, { headers });
  }
}
