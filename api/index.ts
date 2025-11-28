import dotenv from 'dotenv';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { ExpressPeerServer } from 'peer';

dotenv.config();

const app = express();
const server = http.createServer(app);

app.use(cors({
  origin: process.env.ORIGIN?.split(',') || [
    "http://localhost:5173",
    "https://plataforma-de-video-conferencias.vercel.app"
  ],
  methods: ["GET", "POST"]
}));

const io = new Server(server, {
  cors: {
    origin: process.env.ORIGIN?.split(',') || [
      "http://localhost:5173",
      "https://plataforma-de-video-conferencias.vercel.app"
    ],
    methods: ["GET", "POST"],
  }
});
// PeerJS server (para conexiones WebRTC asistidas por peer.js)
const peerServer = ExpressPeerServer(server, {
  path: '/voice',
  proxied: true,
});
app.use('/peerjs', peerServer);

peerServer.on('connection', (client) => {
  console.log('🤝[peer] Cliente peer conectado:', client.getId?.() ?? '(sin id)');
});

peerServer.on('disconnect', (client) => {
  console.log('👋[peer] Cliente peer desconectado:', client.getId?.() ?? '(sin id)');
});

interface Room {
  [roomId: string]: {
    [socketId: string]: {
      userId: string;
      displayName: string;
      photoURL?: string;
    };
  };
}

const rooms: Room = {};

io.on('connection', (socket) => {
  console.log('🔊[voice] Usuario conectado:', socket.id);

  socket.on('join:room', (roomId: string, userInfo: any) => {
    console.log(`👤[voice] ${userInfo.displayName} (${socket.id}) se unió a sala ${roomId}`);
    const currentCount = rooms[roomId] ? Object.keys(rooms[roomId]).length : 0;
    if (currentCount >= 10) {
      socket.emit('room:full');
      console.log(`⚠️[voice] Sala ${roomId} llena (10). Rechazando ${socket.id}`);
      return;
    }

    socket.join(roomId);
    if (!rooms[roomId]) rooms[roomId] = {};
    rooms[roomId][socket.id] = userInfo;

    socket.to(roomId).emit('user:joined', {
      socketId: socket.id,
      userInfo,
    });

    const existingUsers = Object.keys(rooms[roomId])
      .filter((id) => id !== socket.id)
      .map((id) => ({
        socketId: id,
        userInfo: rooms[roomId][id],
      }));

    socket.emit('existing:users', existingUsers);
    console.log(`📊[voice] Usuarios en sala ${roomId}:`, Object.keys(rooms[roomId]).length);
  });

  socket.on('webrtc:offer', ({ to, offer, from }) => {
    console.log(`📤[voice] Offer de ${from} -> ${to}`);
    io.to(to).emit('webrtc:offer', { from, offer });
  });

  socket.on('webrtc:answer', ({ to, answer, from }) => {
    console.log(`📤[voice] Answer de ${from} -> ${to}`);
    io.to(to).emit('webrtc:answer', { from, answer });
  });

  socket.on('webrtc:ice-candidate', ({ to, candidate, from }) => {
    console.log(`🧊[voice] ICE de ${from} -> ${to}`);
    io.to(to).emit('webrtc:ice-candidate', { from, candidate });
  });

  socket.on('media:toggle', ({ roomId, type, enabled }) => {
    console.log(`🎚️[voice] ${socket.id} toggled ${type}=${enabled} en sala ${roomId}`);
    socket.to(roomId).emit('peer:media-toggle', {
      socketId: socket.id,
      type,
      enabled,
    });
  });

  socket.on('disconnect', () => {
    console.log('❌[voice] Usuario desconectado:', socket.id);
    for (const roomId in rooms) {
      if (rooms[roomId][socket.id]) {
        const userInfo = rooms[roomId][socket.id];
        delete rooms[roomId][socket.id];
        socket.to(roomId).emit('user:left', {
          socketId: socket.id,
          userInfo,
        });
        const remaining = Object.keys(rooms[roomId]).length;
        console.log(`👋[voice] ${userInfo.displayName} salió de sala ${roomId}. Quedan ${remaining}`);
        if (remaining === 0) {
          delete rooms[roomId];
          console.log(`🗑️[voice] Sala ${roomId} eliminada (vacía)`);
        }
        break;
      }
    }
  });
});

const PORT = Number(process.env.PORT) || 3002;

server.listen(PORT, () => {
  console.log(`🚀 Servidor de voz corriendo en puerto ${PORT}`);
});
