// Small encrypted chunks avoid SecureStore value limits. Publish the manifest last.
export type SecureDocumentStore = {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
};
type Manifest = { generation: string; count: number };
function manifest(value: string | null): Manifest | null {
  if (!value) return null;
  const parsed = JSON.parse(value) as Manifest;
  if (
    !parsed ||
    !/^[a-z0-9-]+$/.test(parsed.generation) ||
    !Number.isInteger(parsed.count) ||
    parsed.count < 0 ||
    parsed.count > 1024
  )
    throw new Error("Local secure data is invalid.");
  return parsed;
}
export async function readSecureDocument(
  store: SecureDocumentStore,
  key: string,
) {
  const head = manifest(await store.getItemAsync(key));
  if (!head) return null;
  const chunks = await Promise.all(
    Array.from({ length: head.count }, (_, index) =>
      store.getItemAsync(`${key}.${head.generation}.${index}`),
    ),
  );
  if (chunks.some((value) => value === null))
    throw new Error(
      "Local secure data is incomplete; it has not been replaced.",
    );
  return chunks.join("");
}
export async function writeSecureDocument(
  store: SecureDocumentStore,
  key: string,
  value: string,
) {
  const previous = manifest(await store.getItemAsync(key));
  const generation = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const points = Array.from(value);
  const chunks = Array.from(
    { length: Math.ceil(points.length / 400) },
    (_, index) => points.slice(index * 400, (index + 1) * 400).join(""),
  );
  if (chunks.length > 1024)
    throw new Error(
      "Local storage is full. Sync pending entries before adding more.",
    );
  await Promise.all(
    chunks.map((chunk, index) =>
      store.setItemAsync(`${key}.${generation}.${index}`, chunk),
    ),
  );
  await store.setItemAsync(
    key,
    JSON.stringify({ generation, count: chunks.length }),
  );
  // Cleanup failure must not turn a committed write into an apparent save failure.
  if (previous)
    await Promise.allSettled(
      Array.from({ length: previous.count }, (_, index) =>
        store.deleteItemAsync(`${key}.${previous.generation}.${index}`),
      ),
    );
}
export function quickSessionScope(
  token: string,
  baseUrl: string,
): string | null {
  try {
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let bits = 0,
      count = 0,
      decoded = "";
    for (const char of token
      .split(".")[1]
      .replaceAll("-", "+")
      .replaceAll("_", "/")) {
      if (char === "=") break;
      const n = alphabet.indexOf(char);
      if (n < 0) return null;
      bits = (bits << 6) | n;
      count += 6;
      if (count >= 8) {
        count -= 8;
        decoded += String.fromCharCode((bits >> count) & 255);
      }
    }
    const user = (JSON.parse(decoded) as { user_id?: unknown }).user_id;
    if (typeof user !== "number" && typeof user !== "string") return null;
    // Decoding scopes local files only. The API still verifies the JWT and ownership.
    return `${Array.from(baseUrl)
      .map((c) => c.charCodeAt(0).toString(16))
      .join("")}.${String(user).replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  } catch {
    return null;
  }
}
