import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

let globalSocket: Socket | null = null;

function getSocket(): Socket {
  if (!globalSocket) {
    globalSocket = io(window.location.origin, {
      path: "/api/socket.io",
      transports: ["websocket", "polling"],
    });
  }
  return globalSocket;
}

export function useSocket() {
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket>(getSocket());

  useEffect(() => {
    const socket = socketRef.current;

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

    if (socket.connected) setConnected(true);

    return () => {
      socket.off("connect");
      socket.off("disconnect");
    };
  }, []);

  return { socket: socketRef.current, connected };
}

export function useConversationSocket(conversationId: number | null) {
  const { socket, connected } = useSocket();

  useEffect(() => {
    if (!conversationId || !connected) return;

    socket.emit("join_conversation", conversationId);

    return () => {
      socket.emit("leave_conversation", conversationId);
    };
  }, [conversationId, connected, socket]);

  return { socket, connected };
}

export function useInboxSocket() {
  const { socket, connected } = useSocket();

  useEffect(() => {
    if (!connected) return;
    socket.emit("join_inbox");
  }, [connected, socket]);

  return { socket, connected };
}
