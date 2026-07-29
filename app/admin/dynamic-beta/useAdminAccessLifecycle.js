"use client";

import { useEffect, useRef } from "react";

/**
 * Observe the page-owned admin access coordinator without creating another
 * store. Delivery happens inside the coordinator subscription so a denied
 * transition cannot be lost if recovery is published before React renders.
 */
export function useAdminAccessLifecycle(adminAccess, handlers = {}) {
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    if (
      typeof adminAccess?.subscribeLifecycle !== "function"
      || typeof adminAccess?.getLifecycleSnapshot !== "function"
    ) return undefined;

    let deniedEpoch = null;
    const observe = () => {
      const snapshot = adminAccess.getLifecycleSnapshot();
      if (snapshot?.phase === "access-denied") {
        if (deniedEpoch === snapshot.accessEpoch) return;
        deniedEpoch = snapshot.accessEpoch;
        handlersRef.current.onAccessDenied?.(snapshot);
        return;
      }
      if (deniedEpoch === snapshot?.accessEpoch) {
        deniedEpoch = null;
        handlersRef.current.onAccessRecovered?.(snapshot);
      }
    };

    observe();
    return adminAccess.subscribeLifecycle(observe);
  }, [adminAccess]);
}
