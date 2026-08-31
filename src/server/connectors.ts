import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { parse as parseCsv } from "csv-parse/sync";
import { z } from "zod";

import type { RemoteSourceInput } from "../shared/domain.js";

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const rowsSchema = z.array(z.record(z.string(), z.string()));
export type DataRow = z.infer<typeof rowsSchema>[number];

export type SourceSnapshot = {
  rows: DataRow[];
  columns: string[];
  fileName: string | null;
};

function validateRows(rows: DataRow[]): SourceSnapshot {
  if (rows.length === 0) throw new Error("The source must contain at least one data row");
  const columns = Object.keys(rows[0] ?? {});
  if (columns.length === 0 || columns.some((column) => column.trim() === "")) {
    throw new Error("Source columns must have non-empty names");
  }
  return { rows, columns, fileName: null };
}

export function parseCsvSnapshot(content: string, fileName: string | null = null): SourceSnapshot {
  const parsed = parseCsv(content, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: false,
  }) as unknown;
  const snapshot = validateRows(rowsSchema.parse(parsed));
  return { ...snapshot, fileName };
}

function privateAddress(address: string): boolean {
  if (address === "::1" || address === "0:0:0:0:0:0:0:1") return true;
  if (address.startsWith("fc") || address.startsWith("fd") || address.startsWith("fe80:")) return true;
  const octets = address.split(".").map(Number);
  if (octets.length !== 4) return false;
  const [first = 0, second = 0] = octets;
  return first === 10 || first === 127 || first === 0 || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

async function assertPublicUrl(value: string): Promise<URL> {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Remote sources must use HTTPS");
  if (url.username || url.password) throw new Error("Credentials cannot be embedded in a source URL");
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) throw new Error("Local network URLs are not allowed");
  if (isIP(hostname) && privateAddress(hostname)) throw new Error("Private network URLs are not allowed");
  const addresses = await lookup(hostname, { all: true });
  if (addresses.length === 0 || addresses.some(({ address }) => privateAddress(address))) {
    throw new Error("The source URL must resolve to a public address");
  }
  return url;
}

async function fetchPublicText(value: string): Promise<string> {
  let url = await assertPublicUrl(value);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15_000), headers: { Accept: "text/csv, application/json" } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("The source returned an invalid redirect");
      url = await assertPublicUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) throw new Error(`The source returned HTTP ${response.status}`);
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("The source response exceeds 5 MB");
    const body = await response.arrayBuffer();
    if (body.byteLength > MAX_RESPONSE_BYTES) throw new Error("The source response exceeds 5 MB");
    return new TextDecoder().decode(body);
  }
  throw new Error("The source redirected too many times");
}

function googleSheetsCsvUrl(value: string): string {
  const url = new URL(value);
  if (url.hostname !== "docs.google.com") throw new Error("Use a public Google Sheets URL from docs.google.com");
  if (url.pathname.includes("/d/e/") && url.pathname.endsWith("/pub")) {
    url.searchParams.set("output", "csv");
    return url.toString();
  }
  const match = url.pathname.match(/^\/spreadsheets\/d\/([^/]+)/);
  if (!match?.[1]) throw new Error("The Google Sheets URL is not recognized");
  const gid = url.searchParams.get("gid") ?? url.hash.match(/gid=(\d+)/)?.[1] ?? "0";
  return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${gid}`;
}

function valueAtPath(value: unknown, path: string | undefined): unknown {
  if (!path) return value;
  return path.split(".").filter(Boolean).reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, value);
}

function jsonRows(value: unknown, recordPath: string | undefined): DataRow[] {
  const selected = valueAtPath(value, recordPath);
  if (!Array.isArray(selected)) throw new Error("The JSON source must resolve to an array of records");
  return selected.map((record, index) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error(`JSON record ${index + 1} is not an object`);
    }
    return Object.fromEntries(Object.entries(record as Record<string, unknown>).map(([key, item]) => {
      if (item === null || item === undefined) return [key, ""];
      if (typeof item === "string") return [key, item];
      if (typeof item === "number" || typeof item === "boolean") return [key, String(item)];
      return [key, JSON.stringify(item)];
    }));
  });
}

export async function loadRemoteSource(input: RemoteSourceInput): Promise<SourceSnapshot> {
  if (input.kind === "google_sheets") {
    return parseCsvSnapshot(await fetchPublicText(googleSheetsCsvUrl(input.url)));
  }
  const text = await fetchPublicText(input.url);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error("The API response is not valid JSON");
  }
  return validateRows(jsonRows(parsed, input.recordPath));
}
