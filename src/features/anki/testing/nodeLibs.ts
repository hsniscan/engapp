// The importer's libraries under Node (vitest): sql.js gets its wasm from node_modules, zstd
// compression (fixtures only) comes from node:zlib. Not imported by app code.
import JSZip from 'jszip';
import { decompress } from 'fzstd';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import type { ApkgLibs } from '../readApkg';
import type { BuildLibs } from './buildApkg';

interface NodeFs {
  readFileSync(path: string): Uint8Array;
}
interface NodeZlib {
  zstdCompressSync(data: Uint8Array): Uint8Array;
}

let sql: Promise<SqlJsStatic> | null = null;

/** The repository root (vitest runs there). */
const cwd = (): string => (globalThis as unknown as { process: { cwd(): string } }).process.cwd();

export async function nodeLibs(): Promise<ApkgLibs & BuildLibs> {
  const fs = (await import('node:fs' as string)) as NodeFs;
  const zlib = (await import('node:zlib' as string)) as NodeZlib;
  sql ??= initSqlJs({
    wasmBinary: Uint8Array.from(fs.readFileSync(`${cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`)).buffer,
  });
  return {
    JSZip,
    SQL: await sql,
    zstd: (b) => decompress(b),
    zstdCompress: (b) => new Uint8Array(zlib.zstdCompressSync(b)),
  };
}
