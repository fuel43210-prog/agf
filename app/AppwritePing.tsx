"use client";

import { useEffect } from "react";
import { client } from "./lib/appwrite";

export default function AppwritePing() {
  useEffect(() => {
    client.ping().catch((err) => {
      console.error("Appwrite ping failed:", err);
    });
  }, []);

  return null;
}

