"use client";
 
import dynamic from "next/dynamic";
 
const GameShell = dynamic(
  () => import("./game-shell").then((mod) => mod.GameShell),
  { ssr: false }
);
 
export default function GameClient() {
  return <GameShell />;
}
 