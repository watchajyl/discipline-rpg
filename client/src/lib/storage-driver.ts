// ============================================================
// 持久化驱动：IndexedDB（idb）+ 内存回退
// 预览沙箱 iframe 会禁用浏览器存储；此时自动退化为内存存储，
// 并由 UI 显示提示条，功能仍完整可用（仅本次会话内有效）。
// ============================================================
import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "discipline-rpg";
const STORE = "state";
const DOC_KEY = "doc";

export type StorageMode = "indexeddb" | "memory";

let mode: StorageMode = "memory";
let dbp: IDBPDatabase<any> | null = null;
let memoryDoc: string | null = null;
let initialized = false;

export function storageMode(): StorageMode {
  return mode;
}

export function storageAvailable(): boolean {
  return mode === "indexeddb";
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("storage timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** 探测并初始化存储；失败则回退内存 */
export async function initStorage(): Promise<StorageMode> {
  if (initialized) return mode;
  initialized = true;
  try {
    if (typeof indexedDB === "undefined") throw new Error("no indexedDB");
    const db = await withTimeout(
      openDB(DB_NAME, 1, {
        upgrade(d) {
          if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
        },
      }),
      2500,
    );
    // 真正写一次，确认不是被策略拦截的空壳实现
    await withTimeout(db.put(STORE, Date.now(), "__probe__"), 2500);
    dbp = db;
    mode = "indexeddb";
  } catch {
    dbp = null;
    mode = "memory";
  }
  return mode;
}

export async function readDoc(): Promise<string | null> {
  if (mode === "indexeddb" && dbp) {
    try {
      const v = await dbp.get(STORE, DOC_KEY);
      return typeof v === "string" ? v : null;
    } catch {
      mode = "memory";
      return memoryDoc;
    }
  }
  return memoryDoc;
}

export async function writeDoc(json: string): Promise<void> {
  memoryDoc = json;
  if (mode === "indexeddb" && dbp) {
    try {
      await dbp.put(STORE, json, DOC_KEY);
    } catch {
      mode = "memory";
    }
  }
}

export async function wipeDoc(): Promise<void> {
  memoryDoc = null;
  if (mode === "indexeddb" && dbp) {
    try {
      await dbp.delete(STORE, DOC_KEY);
    } catch {
      /* ignore */
    }
  }
}
