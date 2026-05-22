declare module "@vercel/node" {
  import type { IncomingMessage, ServerResponse } from "node:http";

  export interface VercelRequest extends IncomingMessage {
    method?: string;
    query: Record<string, string | string[] | undefined>;
    body: unknown;
    headers: IncomingMessage["headers"];
  }

  export interface VercelResponse extends ServerResponse {
    status(statusCode: number): VercelResponse;
    json(body: unknown): void;
    send(body: unknown): void;
    end(): void;
  }
}
