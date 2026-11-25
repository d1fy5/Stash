// Local-only IndexedDB database for Stash.
const DB_NAME = "stash-db";
const DB_VERSION = 2;
let dbPromise;

export function openStashDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = event => {
      const db = request.result;
      const tx = request.transaction;
      const oldVersion = event.oldVersion;

      if (!db.objectStoreNames.contains("tasks")) {
        const tasks = db.createObjectStore("tasks", { keyPath: "id" });
        tasks.createIndex("dueDate", "dueDate");
      }
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "id" });
      }

      if (oldVersion < 2) {
        // Keep every task and its existing fields, while removing only its old
        // account ownership so the local app can load all tasks together.
        const tasks = tx.objectStore("tasks");
        if (tasks.indexNames.contains("userId")) tasks.deleteIndex("userId");
        const taskCursor = tasks.openCursor();
        taskCursor.onsuccess = () => {
          const cursor = taskCursor.result;
          if (!cursor) return;
          const value = cursor.value;
          if (Object.hasOwn(value, "userId")) {
            delete value.userId;
            cursor.update(value);
          }
          cursor.continue();
        };

        // Merge settings from prior local profiles into one device-wide record.
        // The newest value for each preference wins; all task records remain.
        const settings = tx.objectStore("settings");
        if (settings.indexNames.contains("userId")) settings.deleteIndex("userId");
        const mergedPreferences = {};
        const preferenceTimes = {};
        const settingsCursor = settings.openCursor();
        settingsCursor.onsuccess = () => {
          const cursor = settingsCursor.result;
          if (cursor) {
            const record = cursor.value;
            const timestamp = Date.parse(record.updatedAt || "") || 0;
            for (const [key, value] of Object.entries(record.preferences || {})) {
              if (!(key in preferenceTimes) || timestamp >= preferenceTimes[key]) {
                mergedPreferences[key] = value;
                preferenceTimes[key] = timestamp;
              }
            }
            cursor.continue();
            return;
          }
          settings.clear();
          settings.put({
            id: "global",
            preferences: mergedPreferences,
            updatedAt: new Date().toISOString()
          });
        };

        // Profiles and password hashes are no longer used by this app.
        if (db.objectStoreNames.contains("users")) db.deleteObjectStore("users");
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Database upgrade is blocked by another open tab."));
  });

  return dbPromise;
}

export async function dbRequest(storeName, mode, action) {
  const db = await openStashDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    let request;
    try {
      request = action(tx.objectStore(storeName));
    } catch (error) {
      reject(error);
      return;
    }
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = tx.onabort = () => reject(tx.error || request?.error);
  });
}

export async function saveAllTasks(tasks) {
  const db = await openStashDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("tasks", "readwrite");
    const store = tx.objectStore("tasks");
    store.clear();
    tasks.forEach(task => store.put(task));
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}
