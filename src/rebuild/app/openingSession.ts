/** Claim the welcome once per tab, including when browser storage is blocked. */
export function createOpeningSession(getStorage: () => Pick<Storage, "getItem" | "setItem">) {
  let claimed = false;
  return {
    claim() {
      if (claimed) return false;
      claimed = true;
      try {
        const storage = getStorage();
        if (storage.getItem("sakura-ink-opening") === "1") return false;
        storage.setItem("sakura-ink-opening", "1");
      } catch {
        // The in-memory claim survives component remounts in restricted browsers.
      }
      return true;
    },
  };
}

export const openingSession = createOpeningSession(() => window.sessionStorage);
