// Local-only IndexedDB database for Stash.
const DB_NAME = "stash-db";
const DB_VERSION = 1;
let dbPromise;

export function openStashDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const users = db.createObjectStore("users", { keyPath: "id" });
      users.createIndex("username", "username", { unique: true });
      const tasks = db.createObjectStore("tasks", { keyPath: "id" });
      tasks.createIndex("userId", "userId");
      tasks.createIndex("dueDate", "dueDate");
      const settings = db.createObjectStore("settings", { keyPath: "id" });
      settings.createIndex("userId", "userId", { unique: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

export async function dbRequest(storeName, mode, action) {
  const db = await openStashDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    let request;
    try { request = action(tx.objectStore(storeName)); }
    catch (error) { reject(error); return; }
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = tx.onabort = () => reject(tx.error || request?.error);
  });
}

export async function saveUserTasks(userId, userTasks) {
  const db = await openStashDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("tasks", "readwrite");
    const store = tx.objectStore("tasks");
    const keysRequest = store.index("userId").getAllKeys(IDBKeyRange.only(userId));
    keysRequest.onsuccess = () => {
      keysRequest.result.forEach(key => store.delete(key));
      userTasks.forEach(task => store.put({ ...task, userId }));
    };
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error || keysRequest.error);
  });
}
