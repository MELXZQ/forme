"use client";
export function announceAdminChange() {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel("forme-admin");
  channel.postMessage("changed");
  channel.close();
}
