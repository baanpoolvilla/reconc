type Fetcher = { fetch(request: Request): Promise<Response> };
// Runtime bindings are supplied by Cloudflare; the application narrows them at use sites.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type D1Database = any;
type R2Bucket = {
  put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
};

declare module "cloudflare:workers" {
  export const env: {
    DB: D1Database;
    FILES: R2Bucket;
    [key: string]: unknown;
  };
}
