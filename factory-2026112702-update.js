// Web export bridge. The mounted save file reaches IndexedDB asynchronously.
(() => {
  const entryPattern = /^factory-[1-9]\d{0,9}\.html$/;

  function releaseUrl(entry) {
    if (!entryPattern.test(entry)) throw new Error("Invalid release entry");
    return new URL(entry, window.location.href);
  }

  function openSaveDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("/userfs");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      // Use only Godot's existing database.
      request.onupgradeneeded = () => request.transaction.abort();
    });
  }

  function readSave(database, path) {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("FILE_DATA", "readonly");
      const request = transaction.objectStore("FILE_DATA").get(path);
      request.onsuccess = () => resolve(request.result?.contents);
      request.onerror = () => reject(request.error);
    });
  }

  async function waitForSave(path, timestamp) {
    if (!path.startsWith("/userfs/") || !Number.isFinite(timestamp) || timestamp <= 0) {
      throw new Error("Invalid save location or timestamp");
    }
    const database = await openSaveDatabase();
    const decoder = new TextDecoder();
    try {
      for (let attempt = 0; attempt < 32; attempt++) {
        const contents = await readSave(database, path);
        if (contents != null) {
          const save = JSON.parse(decoder.decode(contents));
          if (Number(save.saved_at_unix) >= timestamp) return true;
        }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      return false;
    } finally {
      database.close();
    }
  }

  async function filesAvailable(entry) {
    const page = releaseUrl(entry);
    const stem = page.pathname.slice(0, -".html".length);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const responses = await Promise.all([page, ...[".js", ".wasm", ".pck", "-update.js"].map(suffix =>
        new URL(stem + suffix, page.origin)
      )].map(url => fetch(url, {
        method: "HEAD",
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      })));
      return responses.every(response => response.ok);
    } finally {
      clearTimeout(timeout);
    }
  }

  window.industrialGameUpdate = {
    manifestUrl() {
      const url = new URL("version.json", window.location.href);
      url.searchParams.set("check", String(Date.now()));
      return url.href;
    },
    checkFiles(entry, operation, callback) {
      filesAvailable(entry).then(
        available => callback(operation, "files", available),
        () => callback(operation, "files", false)
      );
    },
    confirmSave(path, timestamp, operation, callback) {
      waitForSave(path, timestamp).then(
        saved => callback(operation, "save", saved),
        () => callback(operation, "save", false)
      );
    },
    openRelease(entry, operation, callback) {
      try {
        window.location.replace(releaseUrl(entry).href);
      } catch (_) {
        callback(operation, "open", false);
      }
    },
  };
})();
