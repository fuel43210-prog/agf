"use client";

import { useEffect } from "react";

export default function LocationPrompt() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const options: PositionOptions = {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    };

    sessionStorage.setItem(
      "userLocation",
      JSON.stringify({ lat: 12.141116665221949, lng: 75.25000625657133 })
    );
  }, []);

  return null;
}
