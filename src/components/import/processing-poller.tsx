"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Enquanto o lote está sendo lido, recarrega a página a cada 1,5s. */
export function ProcessingPoller() {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 1500);
    return () => clearInterval(id);
  }, [router]);
  return null;
}
