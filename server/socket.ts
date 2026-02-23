import { Server as HttpServer } from "http";
import { Server as SocketIOServer } from "socket.io";

let io: SocketIOServer | null = null;

export function initSocketIO(httpServer: HttpServer) {
  io = new SocketIOServer(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    path: "/api/socket.io",
    transports: ["websocket", "polling"],
  });

  io.on("connection", (socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    // Join a conversation room
    socket.on("join_conversation", (conversationId: number) => {
      socket.join(`conversation:${conversationId}`);
    });

    // Leave a conversation room
    socket.on("leave_conversation", (conversationId: number) => {
      socket.leave(`conversation:${conversationId}`);
    });

    // Join the inbox room (for all conversation updates)
    socket.on("join_inbox", () => {
      socket.join("inbox");
    });

    // Typing indicator
    socket.on("typing", (data: { conversationId: number; isTyping: boolean; senderName: string }) => {
      socket.to(`conversation:${data.conversationId}`).emit("typing", data);
    });

    socket.on("disconnect", () => {
      console.log(`[Socket] Client disconnected: ${socket.id}`);
    });
  });

  return io;
}

export function getIO(): SocketIOServer {
  if (!io) throw new Error("Socket.IO not initialized");
  return io;
}

// Emit events
export function emitNewMessage(conversationId: number, message: unknown) {
  if (!io) return;
  io.to(`conversation:${conversationId}`).emit("new_message", message);
  io.to("inbox").emit("conversation_updated", { conversationId, message });
}

export function emitConversationUpdate(conversationId: number, data: unknown) {
  if (!io) return;
  io.to(`conversation:${conversationId}`).emit("conversation_updated", data);
  io.to("inbox").emit("conversation_updated", { conversationId, ...data as object });
}

export function emitTypingIndicator(conversationId: number, isTyping: boolean, senderName: string) {
  if (!io) return;
  io.to(`conversation:${conversationId}`).emit("typing", { conversationId, isTyping, senderName });
}
